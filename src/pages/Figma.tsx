import { Maximize2, Minimize2, Minus, Square } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { colorToCSSCompact } from "../lib/figma-core";
import { FigmaDocumentStore } from "../lib/figma/documentStore";
import { extractJsonBlocks, normalizeGatewayMessage } from "../lib/chatMessageUtils";
import { createGatewayClient } from "../lib/gateway";
import { resolveGatewayAuth } from "../lib/gateway-auth";

import type { FigmaToolCall } from "../lib/figma/documentStore";
import type { GatewayClient } from "../lib/gateway";
import type { SceneNode } from "../lib/figma-core";

type ParsedPlan = {
  assistantResponse: string;
  toolCalls: FigmaToolCall[];
};

type DebugEntry = {
  id: string;
  ts: number;
  message: string;
};

type Props = {
  gatewayRunning: boolean;
};

function nodeBackground(node: SceneNode): string {
  const fill = node.fills.find((candidate) => candidate.visible);
  if (!fill) return "transparent";
  if (fill.type === "SOLID") return colorToCSSCompact(fill.color);
  if (fill.type === "GRADIENT_LINEAR" && fill.gradientStops && fill.gradientStops.length >= 2) {
    const start = colorToCSSCompact(fill.gradientStops[0].color);
    const end = colorToCSSCompact(fill.gradientStops[fill.gradientStops.length - 1].color);
    return `linear-gradient(180deg, ${start}, ${end})`;
  }
  return colorToCSSCompact(fill.color);
}

function nodeBorder(node: SceneNode): string | undefined {
  const stroke = node.strokes.find((candidate) => candidate.visible);
  if (!stroke) return undefined;
  return `${Math.max(1, stroke.weight)}px solid ${colorToCSSCompact(stroke.color)}`;
}

function nodeRadius(node: SceneNode): string {
  if (node.type === "ELLIPSE") return "999px";
  if (node.independentCorners) {
    return `${node.topLeftRadius}px ${node.topRightRadius}px ${node.bottomRightRadius}px ${node.bottomLeftRadius}px`;
  }
  return `${node.cornerRadius}px`;
}

function nodeTextColor(node: SceneNode): string {
  const fill = node.fills.find((candidate) => candidate.visible);
  return fill ? colorToCSSCompact(fill.color) : "var(--text-primary)";
}

function buildGatewayPlannerPrompt(
  userPrompt: string,
  context: ReturnType<FigmaDocumentStore["getPlanningContext"]>,
  requestId: string,
): string {
  return [
    "You are the design-planning agent for Entropic's Figma workspace.",
    "You do not directly edit the canvas. You must plan tool calls for the local Figma tool runtime.",
    "Work like an agent inside a design editor: inspect the existing document, make targeted edits, then stop.",
    "Return exactly one JSON object with this shape:",
    '{ "assistant_response": "short user-facing summary", "tool_calls": [{ "tool": "tool_name", "args": { "key": "value" } }] }',
    "Rules:",
    "- Only respond to the latest user prompt. Treat prior chat as document context, not as the instruction to follow.",
    "- Use only tool names from the provided catalog.",
    "- Args must be valid JSON.",
    "- Prefer editing existing nodes over creating new top-level structure when the request sounds incremental.",
    "- Use `find_nodes`, `get_node`, and `describe` to understand existing structure before large edits.",
    "- Use `calc` for layout arithmetic instead of mental math when positioning or sizing multiple elements.",
    "- Use `render_spec` when creating a new screen, card stack, section, form, dashboard block, or button row. Prefer one `render_spec` call over many primitive shape calls for new UI.",
    "- If the current document should be edited, plan incremental changes against existing nodes when possible.",
    "- Preserve existing layout, styling, colors, and component structure unless the latest user prompt explicitly asks you to change them.",
    "- If the user asks for copy, mock data, sample rows, sample cards, labels, counts, or text content, prefer editing text or duplicating existing content patterns. Do not restyle unrelated nodes.",
    "- If the user refers to an existing area like a card, feed, panel, table, hero, or nav, find the matching existing node by name and hierarchy before creating new top-level structure.",
    "- For app UI, prefer a clear containment hierarchy: app frame, content sections, then controls inside those sections.",
    "- `render_spec` expects a JSON tree with fields like type, name, text, width, height, fill, stroke, radius, direction, gap, padding, and children.",
    "- New shapes and text should be explicitly named so later edits can target them reliably.",
    "- If no edit is needed, return an empty tool_calls array.",
    "- Do not include markdown outside the JSON object.",
    "",
    `Planner request id: ${requestId}`,
    "",
    `User prompt: ${userPrompt}`,
    "",
    "Planning context JSON:",
    JSON.stringify(context),
  ].join("\n");
}

function parseGatewayToolPlan(raw: string): ParsedPlan | null {
  const candidates = extractJsonBlocks(raw)
    .map((block) => block.jsonText)
    .concat(raw.trim() ? [raw.trim()] : []);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        assistant_response?: unknown;
        tool_calls?: unknown;
      };
      const toolCalls = Array.isArray(parsed.tool_calls)
        ? parsed.tool_calls.filter(
            (entry): entry is FigmaToolCall =>
              Boolean(entry) &&
              typeof entry === "object" &&
              typeof (entry as { tool?: unknown }).tool === "string" &&
              typeof (entry as { args?: unknown }).args === "object" &&
              !Array.isArray((entry as { args?: unknown }).args),
          )
        : [];
      return {
        assistantResponse:
          typeof parsed.assistant_response === "string"
            ? parsed.assistant_response
            : toolCalls.length > 0
              ? `Planned ${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"}.`
              : raw,
        toolCalls,
      };
    } catch {
      // try next candidate
    }
  }
  return null;
}

function normalizeToolPlan(toolCalls: FigmaToolCall[], userPrompt: string): FigmaToolCall[] {
  const normalized: FigmaToolCall[] = [];
  const prompt = userPrompt.toLowerCase();
  const themeFill =
    prompt.includes("light green") || prompt.includes("green")
      ? "#dcfce7"
      : prompt.includes("light blue") || prompt.includes("blue")
        ? "#dbeafe"
        : "#f8fafc";
  const buttonFill =
    prompt.includes("light green") || prompt.includes("green")
      ? "#86efac"
      : prompt.includes("light blue") || prompt.includes("blue")
        ? "#93c5fd"
        : "#e2e8f0";
  const textFill = "#0f172a";
  const styledNodeIds = new Set<string>();
  const textNodeIds = new Set<string>();
  const shapeNodeIds = new Set<string>();

  for (const call of toolCalls) {
    if (call.tool === "set_fill" && typeof call.args?.id === "string") {
      styledNodeIds.add(call.args.id);
    }
    if (call.tool === "set_stroke" && typeof call.args?.id === "string") {
      styledNodeIds.add(call.args.id);
    }
    if (call.tool === "set_text" && typeof call.args?.id === "string") {
      textNodeIds.add(call.args.id);
    }
  }

  for (const call of toolCalls) {
    normalized.push(call);
    if (call.tool !== "create_shape") continue;
    const id = typeof call.args?.id === "string" ? call.args.id : null;
    const type = typeof call.args?.type === "string" ? call.args.type : "";
    const name = typeof call.args?.name === "string" ? call.args.name.toLowerCase() : "";
    if (!id) continue;

    if (type === "TEXT") {
      if (!textNodeIds.has(id)) {
        normalized.push({
          tool: "set_text",
          args: {
            id,
            text:
              typeof call.args?.name === "string" && call.args.name.trim().length > 0
                ? call.args.name
                : "Label",
          },
        });
      }
      if (!styledNodeIds.has(id)) {
        normalized.push({
          tool: "set_fill",
          args: {
            id,
            color: textFill,
          },
        });
      }
      continue;
    }

    shapeNodeIds.add(id);
    if (!styledNodeIds.has(id)) {
      const fill =
        name.includes("button") || name.includes("send") || name.includes("receive") || name.includes("buy")
          ? buttonFill
          : themeFill;
      normalized.push({
        tool: "set_fill",
        args: {
          id,
          color: fill,
        },
      });
      normalized.push({
        tool: "set_stroke",
        args: {
          id,
          color: "#94a3b8",
          weight: 1,
        },
      });
      normalized.push({
        tool: "set_radius",
        args: {
          id,
          radius: name.includes("screen") || name.includes("phone") ? 28 : 16,
        },
      });
    }
  }

  return normalized;
}

export function Figma({ gatewayRunning }: Props) {
  const [store] = useState(() => new FigmaDocumentStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [prompt, setPrompt] = useState("Create a dashboard layout with a left nav, KPI strip, and activity feed.");
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectPendingDelete, setProjectPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [gatewayConnected, setGatewayConnected] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [debugEntries, setDebugEntries] = useState<DebugEntry[]>([]);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const viewportAreaRef = useRef<HTMLDivElement | null>(null);
  const viewportDragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const viewportResizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [viewportRect, setViewportRect] = useState({ left: 28, top: 28, width: 920, height: 560 });
  const [viewportMinimized, setViewportMinimized] = useState(false);
  const [viewportMaximized, setViewportMaximized] = useState(false);
  const viewportRestoreRef = useRef(viewportRect);
  const clientRef = useRef<GatewayClient | null>(null);
  const activeRunIdRef = useRef<string | null>(null);
  const activeSessionKeyRef = useRef<string | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const activeRunTimeoutRef = useRef<number | null>(null);
  const busyRef = useRef(snapshot.busy);

  const nodes = store.getRenderableNodes();
  const selectedSet = new Set(snapshot.selectedIds);
  const activeProject = snapshot.projects.find((project) => project.id === snapshot.activeProjectId) ?? null;

  useEffect(() => {
    setProjectNameDraft(activeProject?.name ?? "");
  }, [activeProject?.id, activeProject?.name]);

  useEffect(() => {
    busyRef.current = snapshot.busy;
  }, [snapshot.busy]);

  function pushDebug(message: string) {
    const entry = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      message,
    };
    console.log("[FigmaDebug]", message);
    setDebugEntries((current) => [entry, ...current].slice(0, 80));
  }

  function clearActiveRun(reason?: string) {
    pushDebug(
      `clearActiveRun reason=${reason || "none"} runId=${activeRunIdRef.current || "none"} session=${activeSessionKeyRef.current || "none"}`,
    );
    activeRunIdRef.current = null;
    activeRequestIdRef.current = null;
    if (activeRunTimeoutRef.current !== null) {
      window.clearTimeout(activeRunTimeoutRef.current);
      activeRunTimeoutRef.current = null;
    }
    store.setBusy(false);
    if (reason && activeAssistantMessageIdRef.current) {
      store.upsertAssistantMessage(activeAssistantMessageIdRef.current, reason, "error");
    }
  }

  async function recoverRunFromHistory(sessionKey: string, assistantMessageId: string, requestId: string | null) {
    const client = clientRef.current;
    if (!client) {
      pushDebug("recoverRunFromHistory skipped: no client");
      return false;
    }
    pushDebug(`recoverRunFromHistory start session=${sessionKey}`);
    try {
      const history = await client.getChatHistory(sessionKey, 50);
      pushDebug(`recoverRunFromHistory historyCount=${history.length}`);
      const normalizedHistory = history
        .map((message, index) => normalizeGatewayMessage(message, `history-${index}`))
        .filter((message): message is Exclude<ReturnType<typeof normalizeGatewayMessage>, null> => message !== null);

      let assistantText = "";
      if (requestId) {
        const marker = `Planner request id: ${requestId}`;
        const requestIndex = normalizedHistory.findIndex(
          (message) => message.role === "user" && message.content.includes(marker),
        );
        pushDebug(`recoverRunFromHistory requestId=${requestId} requestIndex=${requestIndex}`);
        if (requestIndex >= 0) {
          const matchedAssistant = normalizedHistory
            .slice(requestIndex + 1)
            .find((message) => message.role === "assistant" && message.content.trim().length > 0);
          assistantText = matchedAssistant?.content ?? "";
        }
      }

      if (!assistantText) {
        const fallbackAssistant = [...normalizedHistory]
          .reverse()
          .find((message) => message.role === "assistant" && message.content.trim().length > 0);
        if (!fallbackAssistant) {
          pushDebug("recoverRunFromHistory no assistant messages found");
          return false;
        }
        pushDebug("recoverRunFromHistory falling back to latest assistant message");
        assistantText = fallbackAssistant.content;
      }

      if (!assistantText) {
        pushDebug("recoverRunFromHistory matched assistant was empty");
        return false;
      }

      pushDebug(`recoverRunFromHistory latestAssistant textLen=${assistantText.length}`);
      const parsedPlan = parseGatewayToolPlan(assistantText);
      if (!parsedPlan) {
        pushDebug("recoverRunFromHistory parse failed");
        store.upsertAssistantMessage(
          assistantMessageId,
          assistantText || "Recovered assistant output from history, but it did not contain a valid tool plan.",
          "error",
        );
        return false;
      }

      pushDebug(`recoverRunFromHistory parse ok toolCalls=${parsedPlan.toolCalls.length}`);
      store.upsertAssistantMessage(assistantMessageId, parsedPlan.assistantResponse, "done");
      if (parsedPlan.toolCalls.length > 0) {
        await store.executeToolPlan(parsedPlan.toolCalls);
        store.addSystemMessage(
          `Recovered and executed ${parsedPlan.toolCalls.length} tool call${parsedPlan.toolCalls.length === 1 ? "" : "s"} from session history.`,
        );
      } else {
        store.addSystemMessage("Recovered assistant response from history, but it contained no tool calls.");
      }
      return true;
    } catch (error) {
      pushDebug(`recoverRunFromHistory failed error=${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function waitForRunHistory(runId: string, sessionKey: string) {
    const client = clientRef.current;
    if (!client) {
      pushDebug("waitForRunHistory skipped: no client");
      return false;
    }
    try {
      pushDebug(`waitForRunHistory start runId=${runId} session=${sessionKey}`);
      const status = await client.rpc<{ status?: string }>("agent.wait", {
        runId,
        timeoutMs: 20_000,
      });
      pushDebug(`waitForRunHistory status=${status?.status || "unknown"}`);
      return status?.status !== "timeout";
    } catch (error) {
      pushDebug(`waitForRunHistory failed error=${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async function settleRunFromHistory(
    runId: string,
    sessionKey: string,
    assistantMessageId: string,
    requestId: string | null,
    source: "background" | "watchdog" | "final-empty",
    failOnMiss: boolean,
  ) {
    pushDebug(`settleRunFromHistory start source=${source} runId=${runId}`);
    await waitForRunHistory(runId, sessionKey);
    if (activeRunIdRef.current !== runId) {
      pushDebug(`settleRunFromHistory exit source=${source} runId=${runId} reason=inactive`);
      return false;
    }

    const recovered = await recoverRunFromHistory(sessionKey, assistantMessageId, requestId);
    if (activeRunIdRef.current !== runId) {
      pushDebug(`settleRunFromHistory exit source=${source} runId=${runId} reason=cleared-after-recovery`);
      return recovered;
    }

    if (recovered) {
      clearActiveRun();
      store.addSystemMessage(
        source === "background"
          ? "Recovered and completed the run from gateway history after stream delivery stalled."
          : source === "watchdog"
            ? "Run watchdog triggered, but the assistant response was recovered from gateway history."
            : "Gateway completed without a final chat payload, but the assistant response was recovered from session history.",
      );
      return true;
    }

    if (failOnMiss) {
      clearActiveRun(
        source === "watchdog"
          ? "Gateway accepted the run but never completed it. Retry once. If it keeps happening, the planner response format is likely off."
          : "The model finished, but no assistant payload was attached to the final gateway event and history recovery failed.",
      );
      store.addSystemMessage(
        source === "watchdog"
          ? "Run watchdog triggered after waiting 45s for a gateway completion event."
          : "Gateway completed the run without a usable final payload, and no recoverable assistant plan was found in history.",
      );
    } else {
      pushDebug(`settleRunFromHistory source=${source} runId=${runId} no recoverable history yet`);
    }

    return false;
  }

  useEffect(() => {
    let cancelled = false;

    async function ensureConnected() {
      if (!gatewayRunning) {
        pushDebug("ensureConnected skipped: gatewayRunning=false");
        setGatewayConnected(false);
        clientRef.current?.disconnect();
        clientRef.current = null;
        return;
      }
      if (clientRef.current?.isConnected()) {
        pushDebug("ensureConnected skipped: existing client already connected");
        setGatewayConnected(true);
        return;
      }
      try {
        pushDebug("resolveGatewayAuth start");
        const auth = await resolveGatewayAuth();
        pushDebug(`resolveGatewayAuth ok wsUrl=${auth.wsUrl}`);
        if (cancelled) return;
        const client = createGatewayClient(auth.wsUrl, auth.token);
        client.on("connected", () => {
          if (!cancelled) {
            pushDebug("gateway event: connected");
            setGatewayConnected(true);
            setGatewayError(null);
          }
        });
        client.on("disconnected", () => {
          if (!cancelled) {
            pushDebug("gateway event: disconnected");
            setGatewayConnected(false);
            if (busyRef.current) {
              clearActiveRun("Gateway disconnected before the design run completed.");
            }
          }
        });
        client.on("error", (error) => {
          if (!cancelled) {
            pushDebug(`gateway event: error message=${error}`);
            setGatewayError(error);
          }
        });
        client.on("agent", (event) => {
          pushDebug(
            `gateway agent event stream=${event.stream} runId=${event.runId} session=${event.sessionKey || "none"}`,
          );
        });
        client.on("chat", async (event) => {
          pushDebug(
            `gateway chat event state=${event.state} runId=${event.runId} session=${event.sessionKey} activeRun=${activeRunIdRef.current || "none"} activeSession=${activeSessionKeyRef.current || "none"}`,
          );
          if (!activeRunIdRef.current || !activeSessionKeyRef.current || !activeAssistantMessageIdRef.current) {
            pushDebug("gateway chat event ignored: no active run/session/message refs");
            return;
          }
          if (event.runId !== activeRunIdRef.current || event.sessionKey !== activeSessionKeyRef.current) {
            pushDebug("gateway chat event ignored: runId/sessionKey mismatch");
            return;
          }

          const normalized = event.message
            ? normalizeGatewayMessage(event.message, event.runId)
            : null;
          const text = normalized?.content ?? "";
          pushDebug(
            `gateway chat normalized hasMessage=${Boolean(event.message)} normalized=${Boolean(normalized)} textLen=${text.length}`,
          );

          if (event.state === "delta" || event.state === "final") {
            store.upsertAssistantMessage(
              activeAssistantMessageIdRef.current,
              text || "Planning design changes...",
              event.state === "final" ? "done" : "streaming",
            );
          }

          if (event.state === "final") {
            if (!text.trim()) {
              pushDebug("gateway final had no text payload; attempting settlement from history");
              await settleRunFromHistory(
                event.runId,
                activeSessionKeyRef.current,
                activeAssistantMessageIdRef.current,
                activeRequestIdRef.current,
                "final-empty",
                true,
              );
              return;
            }

            clearActiveRun();
            const parsedPlan = parseGatewayToolPlan(text);
            pushDebug(
              `gateway final received parsePlan=${parsedPlan ? "ok" : "failed"} toolCalls=${parsedPlan?.toolCalls.length ?? 0}`,
            );
            if (!parsedPlan) {
              store.upsertAssistantMessage(
                activeAssistantMessageIdRef.current,
                text || "The model finished, but did not return a valid tool plan.",
                "error",
              );
              store.addSystemMessage("Gateway response did not contain valid JSON tool calls. No edits were applied.");
              return;
            }

            store.upsertAssistantMessage(
              activeAssistantMessageIdRef.current,
              parsedPlan.assistantResponse,
              "done",
            );

            if (parsedPlan.toolCalls.length === 0) {
              store.addSystemMessage("No tool calls were planned, so the canvas was left unchanged.");
              return;
            }

            try {
              pushDebug(`executing tool plan count=${parsedPlan.toolCalls.length}`);
              await store.executeToolPlan(parsedPlan.toolCalls);
              store.addSystemMessage(
                `Executed ${parsedPlan.toolCalls.length} tool call${parsedPlan.toolCalls.length === 1 ? "" : "s"} from the gateway plan.`,
              );
              pushDebug("tool plan execution completed");
            } catch (error) {
              pushDebug(`tool plan execution failed error=${error instanceof Error ? error.message : String(error)}`);
              store.addSystemMessage(
                `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }

          if (event.state === "error" || event.state === "aborted") {
            clearActiveRun();
            const message = event.errorMessage || "Gateway run failed.";
            pushDebug(`gateway terminal error state=${event.state} message=${message}`);
            store.upsertAssistantMessage(
              activeAssistantMessageIdRef.current,
              message,
              "error",
            );
          }
        });
        pushDebug("gateway connect start");
        await client.connect();
        if (cancelled) {
          client.disconnect();
          return;
        }
        clientRef.current = client;
        setGatewayConnected(true);
        setGatewayError(null);
        pushDebug("gateway connect ok");
      } catch (error) {
        if (!cancelled) {
          pushDebug(`gateway connect failed error=${error instanceof Error ? error.message : String(error)}`);
          setGatewayConnected(false);
          setGatewayError(error instanceof Error ? error.message : String(error));
        }
      }
    }

    void ensureConnected();

    return () => {
      cancelled = true;
      if (activeRunTimeoutRef.current !== null) {
        window.clearTimeout(activeRunTimeoutRef.current);
        activeRunTimeoutRef.current = null;
      }
      pushDebug("gateway effect cleanup");
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, [gatewayRunning, store]);

  function handleCanvasPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (event.target !== event.currentTarget) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    store.setSelection([]);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCanvasPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    const dx = event.clientX - dragRef.current.x;
    const dy = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    store.panBy(dx, dy);
  }

  function handleCanvasPointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const direction = event.deltaY > 0 ? -0.08 : 0.08;
      store.zoomAt(snapshot.zoom + direction);
    }
  }

  function handleViewportDragStart(event: React.PointerEvent<HTMLDivElement>) {
    if (viewportMaximized || viewportMinimized) return;
    viewportDragRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewportRect.left,
      top: viewportRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleViewportDragMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!viewportDragRef.current || viewportMaximized || viewportMinimized) return;
    const container = viewportAreaRef.current;
    const bounds = container?.getBoundingClientRect();
    const dx = event.clientX - viewportDragRef.current.x;
    const dy = event.clientY - viewportDragRef.current.y;
    let left = viewportDragRef.current.left + dx;
    let top = viewportDragRef.current.top + dy;
    if (bounds) {
      left = Math.max(12, Math.min(left, bounds.width - viewportRect.width - 12));
      top = Math.max(12, Math.min(top, bounds.height - viewportRect.height - 12));
    }
    setViewportRect((current) => ({ ...current, left, top }));
  }

  function handleViewportDragEnd(event: React.PointerEvent<HTMLDivElement>) {
    viewportDragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleViewportResizeStart(event: React.PointerEvent<HTMLButtonElement>) {
    if (viewportMaximized || viewportMinimized) return;
    viewportResizeRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: viewportRect.width,
      height: viewportRect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }

  function handleViewportResizeMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!viewportResizeRef.current || viewportMaximized || viewportMinimized) return;
    const container = viewportAreaRef.current;
    const bounds = container?.getBoundingClientRect();
    const dx = event.clientX - viewportResizeRef.current.x;
    const dy = event.clientY - viewportResizeRef.current.y;
    let width = Math.max(420, viewportResizeRef.current.width + dx);
    let height = Math.max(240, viewportResizeRef.current.height + dy);
    if (bounds) {
      width = Math.min(width, bounds.width - viewportRect.left - 12);
      height = Math.min(height, bounds.height - viewportRect.top - 12);
    }
    setViewportRect((current) => ({ ...current, width, height }));
  }

  function handleViewportResizeEnd(event: React.PointerEvent<HTMLButtonElement>) {
    viewportResizeRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function toggleViewportMaximized() {
    const container = viewportAreaRef.current?.getBoundingClientRect();
    if (!container) return;
    if (viewportMaximized) {
      setViewportRect(viewportRestoreRef.current);
      setViewportMaximized(false);
      return;
    }
    viewportRestoreRef.current = viewportRect;
    setViewportRect({
      left: 12,
      top: 12,
      width: Math.max(420, container.width - 24),
      height: Math.max(260, container.height - 24),
    });
    setViewportMinimized(false);
    setViewportMaximized(true);
  }

  function toggleViewportMinimized() {
    if (viewportMinimized) {
      setViewportMinimized(false);
      return;
    }
    setViewportMaximized(false);
    setViewportMinimized(true);
  }

  async function handlePromptSubmit() {
    if (!prompt.trim() || snapshot.busy) return;
    if (!gatewayRunning) {
      pushDebug("handlePromptSubmit blocked: gatewayRunning=false");
      store.addSystemMessage("Start the gateway first. The Figma tab now uses the real gateway transport.");
      return;
    }
    const client = clientRef.current;
    if (!client || !client.isConnected()) {
      pushDebug(`handlePromptSubmit blocked: client connected=${client?.isConnected() ?? false} error=${gatewayError || "none"}`);
      store.addSystemMessage(gatewayError || "Gateway is not connected yet. Retry in a moment.");
      return;
    }

    const sessionKey = store.ensureGatewaySessionKey();
    const assistantMessageId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    activeSessionKeyRef.current = sessionKey;
    activeAssistantMessageIdRef.current = assistantMessageId;
    activeRequestIdRef.current = requestId;
    activeRunIdRef.current = null;
    pushDebug(
      `handlePromptSubmit start session=${sessionKey} assistantMessageId=${assistantMessageId} requestId=${requestId}`,
    );

    store.setPrompt(prompt);
    store.addUserPrompt(prompt);
    store.upsertAssistantMessage(assistantMessageId, "Planning with gateway model...", "streaming");
    store.setBusy(true);

    try {
      const outbound = buildGatewayPlannerPrompt(prompt, store.getPlanningContext(), requestId);
      pushDebug(`sendMessage start session=${sessionKey} promptLen=${prompt.length} outboundLen=${outbound.length}`);
      const runId = await client.sendMessage(sessionKey, outbound);
      activeRunIdRef.current = runId;
      pushDebug(`sendMessage ok runId=${runId}`);
      void settleRunFromHistory(runId, sessionKey, assistantMessageId, requestId, "background", false);
      if (activeRunTimeoutRef.current !== null) {
        window.clearTimeout(activeRunTimeoutRef.current);
      }
      activeRunTimeoutRef.current = window.setTimeout(() => {
        if (activeRunIdRef.current !== runId) return;
        pushDebug(`run watchdog fired runId=${runId}; attempting settlement from history`);
        void (async () => {
          await settleRunFromHistory(runId, sessionKey, assistantMessageId, requestId, "watchdog", true);
        })();
      }, 45_000);
    } catch (error) {
      pushDebug(`sendMessage failed error=${error instanceof Error ? error.message : String(error)}`);
      clearActiveRun();
      store.upsertAssistantMessage(
        assistantMessageId,
        error instanceof Error ? error.message : "Failed to start gateway run.",
        "error",
      );
    }
  }

  return (
    <div className="h-full min-h-0 p-4 md:p-5">
      <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.7fr)_430px]">
        <section className="min-h-[420px] min-w-0 overflow-hidden rounded-[28px] border border-[var(--border-subtle)] bg-[var(--bg-card)] shadow-[0_24px_80px_rgba(0,0,0,0.18)]">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                Design View
              </div>
              <h1 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                OpenPencil Graph Running Inside Entropic
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-1 text-[11px] text-[var(--text-secondary)]">
                {nodes.length} nodes
              </span>
              <span className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-1 text-[11px] text-[var(--text-secondary)]">
                {gatewayRunning ? (gatewayConnected ? "Gateway connected" : "Gateway connecting") : "Gateway offline"}
              </span>
            </div>
          </div>

          <div
            ref={viewportAreaRef}
            className="relative h-[calc(100%-81px)] min-h-[340px] overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(99,102,241,0.12),_transparent_32%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]"
            onWheel={handleWheel}
          >
            <div className="absolute inset-0 opacity-30">
              <div className="h-full w-full bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:32px_32px]" />
            </div>

            <div
              className="absolute overflow-hidden rounded-[24px] border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_92%,transparent)] shadow-[0_28px_90px_rgba(0,0,0,0.16)] backdrop-blur"
              style={{
                left: viewportRect.left,
                top: viewportRect.top,
                width: viewportRect.width,
                height: viewportMinimized ? 54 : viewportRect.height,
              }}
            >
              <div
                className="flex h-[54px] items-center justify-between border-b border-[var(--border-subtle)] px-4"
                onPointerDown={handleViewportDragStart}
                onPointerMove={handleViewportDragMove}
                onPointerUp={handleViewportDragEnd}
              >
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-[#fb7185]" />
                    <span className="h-3 w-3 rounded-full bg-[#fbbf24]" />
                    <span className="h-3 w-3 rounded-full bg-[#34d399]" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                      Display View
                    </div>
                    <div className="text-sm text-[var(--text-primary)]">Drag, resize, or expand this viewport</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleViewportMinimized}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-app)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
                    aria-label={viewportMinimized ? "Restore viewport" : "Minimize viewport"}
                  >
                    {viewportMinimized ? <Square className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={toggleViewportMaximized}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--bg-app)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
                    aria-label={viewportMaximized ? "Restore viewport size" : "Maximize viewport"}
                  >
                    {viewportMaximized ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              {!viewportMinimized && (
                <div
                  className="relative h-[calc(100%-54px)] cursor-grab active:cursor-grabbing"
                  onPointerDown={handleCanvasPointerDown}
                  onPointerMove={handleCanvasPointerMove}
                  onPointerUp={handleCanvasPointerUp}
                >
                  <div
                    className="absolute left-0 top-0 origin-top-left"
                    style={{
                      transform: `translate(${snapshot.panX}px, ${snapshot.panY}px) scale(${snapshot.zoom})`,
                      width: 1800,
                      height: 1400,
                    }}
                  >
                    {nodes.length === 0 && (
                      <div className="absolute left-24 top-24 max-w-md rounded-[28px] border border-dashed border-[var(--border-default)] bg-[color-mix(in_srgb,var(--bg-card)_94%,transparent)] p-6 text-sm leading-6 text-[var(--text-secondary)] backdrop-blur">
                        Enter a prompt or choose a starter recipe. The right-hand panel will plan a design and execute OpenPencil-derived tool calls against this document graph.
                      </div>
                    )}

                    {nodes.map((node) => {
                      const pos = store.getAbsoluteNodePosition(node.id);
                      const isSelected = selectedSet.has(node.id);
                      const isText = node.type === "TEXT";
                      return (
                        <button
                          key={node.id}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            store.setSelection([node.id]);
                          }}
                          className="absolute text-left"
                          style={{
                            left: pos.x,
                            top: pos.y,
                            width: Math.max(node.width, isText ? 80 : 1),
                            height: Math.max(node.height, isText ? 24 : 1),
                            background: isText ? "transparent" : nodeBackground(node),
                            border: nodeBorder(node) ?? (isText ? "none" : "1px solid rgba(255,255,255,0.08)"),
                            borderRadius: nodeRadius(node),
                            boxShadow: isSelected
                              ? "0 0 0 3px rgba(99, 102, 241, 0.55)"
                              : node.effects.length > 0
                                ? "0 18px 40px rgba(15, 23, 42, 0.12)"
                                : undefined,
                            color: nodeTextColor(node),
                            padding: isText ? 0 : 0,
                            overflow: "hidden",
                          }}
                        >
                          {isText ? (
                            <span
                              style={{
                                display: "block",
                                fontSize: node.fontSize,
                                fontWeight: node.fontWeight,
                                lineHeight: node.lineHeight ?? node.fontSize * 1.25,
                              }}
                            >
                              {node.text || node.name}
                            </span>
                          ) : (
                            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-[color-mix(in_srgb,var(--bg-card)_78%,transparent)] px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[var(--text-primary)]">
                              {node.name}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {!viewportMaximized && (
                    <button
                      type="button"
                      className="absolute bottom-2 right-2 h-6 w-6 cursor-se-resize rounded-md bg-[var(--bg-app)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-muted)] hover:text-[var(--text-primary)]"
                      onPointerDown={handleViewportResizeStart}
                      onPointerMove={handleViewportResizeMove}
                      onPointerUp={handleViewportResizeEnd}
                      aria-label="Resize viewport"
                    >
                      <span className="absolute bottom-1.5 right-1.5 h-2.5 w-2.5 border-b-2 border-r-2 border-current" />
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-card)_92%,transparent)] px-3 py-2 text-[11px] text-[var(--text-secondary)] backdrop-blur">
              <span>Zoom {Math.round(snapshot.zoom * 100)}%</span>
              <span className="opacity-40">•</span>
              <span>Drag canvas to pan</span>
              <span className="opacity-40">•</span>
              <span>Pinch / Ctrl+wheel to zoom</span>
            </div>
          </div>
        </section>

        <aside className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-[28px] border border-[var(--border-subtle)] bg-[var(--bg-card)]">
          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
                  Projects
                </div>
                <div className="mt-1 text-sm font-semibold text-[var(--text-primary)]">
                  {snapshot.projects.length} saved under Figma
                </div>
              </div>
              <button
                type="button"
                onClick={() => store.createProject()}
                className="rounded-full bg-[#111827] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
              >
                New Project
              </button>
            </div>

            {activeProject && (
              <div className="mt-4 flex gap-2">
                <input
                  value={projectNameDraft}
                  onChange={(event) => setProjectNameDraft(event.target.value)}
                  className="min-w-0 flex-1 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-default)]"
                  placeholder="Project name"
                />
                <button
                  type="button"
                  onClick={() => store.renameProject(activeProject.id, projectNameDraft)}
                  className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-2 text-xs text-[var(--text-primary)] transition-colors hover:border-[var(--border-default)]"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => setProjectPendingDelete({ id: activeProject.id, name: activeProject.name })}
                  className="rounded-full border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400 transition-colors hover:bg-red-500/15"
                >
                  Delete
                </button>
              </div>
            )}

            <div className="mt-4 max-h-44 space-y-2 overflow-y-auto">
              {snapshot.projects.map((project) => {
                const isActive = project.id === snapshot.activeProjectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => store.loadProjectById(project.id)}
                    className="w-full rounded-2xl border px-3 py-3 text-left transition-colors"
                    style={{
                      borderColor: isActive ? "rgba(99,102,241,0.45)" : "var(--border-subtle)",
                      background: isActive ? "rgba(99,102,241,0.08)" : "var(--bg-app)",
                    }}
                  >
                    <div className="text-sm font-medium text-[var(--text-primary)]">{project.name}</div>
                    <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                      Updated {new Date(project.updatedAt).toLocaleString()}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
              Agent Panel
            </div>
            <div className="mt-1 text-base font-semibold text-[var(--text-primary)]">
              Prompt {"->"} gateway model {"->"} tool planning {"->"} OpenPencil tool execution
            </div>
            {gatewayError && (
              <div className="mt-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                {gatewayError}
              </div>
            )}
          </div>

          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-3 text-sm text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--border-default)]"
              placeholder="Describe the design outcome you want."
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void handlePromptSubmit()}
                disabled={snapshot.busy || !gatewayRunning}
                className="rounded-full bg-[#111827] px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {snapshot.busy ? "Running..." : "Run Agent"}
              </button>
              <button
                type="button"
                onClick={() => store.resetDocument()}
                disabled={snapshot.busy}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--border-default)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reset
              </button>
              {snapshot.busy && (
                <button
                  type="button"
                  onClick={() => clearActiveRun("Run stopped locally before a terminal gateway event arrived.")}
                  className="rounded-full border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-300 transition-colors hover:bg-red-500/15"
                >
                  Stop
                </button>
              )}
            </div>
          </div>

          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-medium text-[var(--text-primary)]">Chat stream</div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                Session {snapshot.gatewaySessionKey ? snapshot.gatewaySessionKey.slice(0, 8) : "not started"}
              </div>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
              {snapshot.chatMessages.map((message) => (
                <div
                  key={message.id}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                      {message.role}
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)]">
                      {message.status ?? "done"}
                    </div>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">
                    {message.content}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-medium text-[var(--text-primary)]">Gateway Debug</div>
              <button
                type="button"
                onClick={() => setDebugEntries([])}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-app)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-default)]"
              >
                Clear
              </button>
            </div>
            <div className="mb-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-3 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
              <div>gatewayRunning={String(gatewayRunning)}</div>
              <div>gatewayConnected={String(gatewayConnected)}</div>
              <div>busy={String(snapshot.busy)}</div>
              <div>activeRunId={activeRunIdRef.current || "none"}</div>
              <div>activeSession={activeSessionKeyRef.current || "none"}</div>
              <div>projectSession={snapshot.gatewaySessionKey || "none"}</div>
            </div>
            <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
              {debugEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-3 font-mono text-[11px] leading-5 text-[var(--text-secondary)]"
                >
                  <div className="text-[10px] text-[var(--text-tertiary)]">
                    {new Date(entry.ts).toLocaleTimeString()}
                  </div>
                  <div className="mt-1 break-words">{entry.message}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-xs font-medium text-[var(--text-primary)]">Execution log</div>
              <div className="text-[11px] text-[var(--text-secondary)]">
                {snapshot.selectedIds.length > 0 ? `Selected ${snapshot.selectedIds[0]}` : "No selection"}
              </div>
            </div>
            <div className="space-y-2">
              {snapshot.activities.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-[var(--text-primary)]">{entry.title}</div>
                    <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
                      {entry.kind}
                    </div>
                  </div>
                  <div className="mt-1 break-words font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
                    {entry.detail}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
      {projectPendingDelete && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[28px] border border-[var(--border-subtle)] bg-[var(--bg-card)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.25)]">
            <div className="text-lg font-semibold text-[var(--text-primary)]">Delete project?</div>
            <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              This will permanently remove <span className="font-medium text-[var(--text-primary)]">{projectPendingDelete.name}</span> and its saved canvas, session, and activity log.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setProjectPendingDelete(null)}
                className="rounded-full border border-[var(--border-subtle)] bg-[var(--bg-app)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--border-default)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  store.deleteProject(projectPendingDelete.id);
                  setProjectPendingDelete(null);
                }}
                className="rounded-full border border-red-500/20 bg-red-500 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { Maximize2, Minimize2, Minus, Square } from "lucide-react";
import { useRef, useState, useSyncExternalStore } from "react";

import { colorToCSSCompact } from "../lib/figma-core";
import { FigmaDocumentStore } from "../lib/figma/documentStore";
import { FIGMA_RECIPES } from "../lib/figma/recipes";

import type { SceneNode } from "../lib/figma-core";

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

export function Figma({ gatewayRunning }: Props) {
  const [store] = useState(() => new FigmaDocumentStore());
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [prompt, setPrompt] = useState("Create a dashboard layout with a left nav, KPI strip, and activity feed.");
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const viewportAreaRef = useRef<HTMLDivElement | null>(null);
  const viewportDragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const viewportResizeRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const [viewportRect, setViewportRect] = useState({ left: 28, top: 28, width: 920, height: 560 });
  const [viewportMinimized, setViewportMinimized] = useState(false);
  const [viewportMaximized, setViewportMaximized] = useState(false);
  const viewportRestoreRef = useRef(viewportRect);

  const nodes = store.getRenderableNodes();
  const selectedSet = new Set(snapshot.selectedIds);

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
    await store.runPrompt(prompt);
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
                {gatewayRunning ? "Gateway connected" : "Gateway optional"}
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
              className="absolute overflow-hidden rounded-[24px] border border-white/10 bg-[rgba(8,12,20,0.78)] shadow-[0_28px_90px_rgba(0,0,0,0.36)] backdrop-blur"
              style={{
                left: viewportRect.left,
                top: viewportRect.top,
                width: viewportRect.width,
                height: viewportMinimized ? 54 : viewportRect.height,
              }}
            >
              <div
                className="flex h-[54px] items-center justify-between border-b border-white/10 px-4"
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
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-white/50">
                      Display View
                    </div>
                    <div className="text-sm text-white/85">Drag, resize, or expand this viewport</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={toggleViewportMinimized}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/80 transition-colors hover:bg-white/14"
                    aria-label={viewportMinimized ? "Restore viewport" : "Minimize viewport"}
                  >
                    {viewportMinimized ? <Square className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={toggleViewportMaximized}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-white/8 text-white/80 transition-colors hover:bg-white/14"
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
                      <div className="absolute left-24 top-24 max-w-md rounded-[28px] border border-dashed border-white/20 bg-[rgba(8,12,20,0.7)] p-6 text-sm leading-6 text-white/75 backdrop-blur">
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
                            <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-black/10 px-2 py-1 text-[10px] uppercase tracking-[0.16em] text-[color:var(--text-primary)]">
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
                      className="absolute bottom-2 right-2 h-6 w-6 cursor-se-resize rounded-md bg-white/10 text-white/60 transition-colors hover:bg-white/15"
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

            <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[rgba(10,14,23,0.74)] px-3 py-2 text-[11px] text-white/80 backdrop-blur">
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
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--text-tertiary)]">
              Agent Panel
            </div>
            <div className="mt-1 text-base font-semibold text-[var(--text-primary)]">
              Prompt {"->"} recipe selection {"->"} OpenPencil tool execution
            </div>
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
                disabled={snapshot.busy}
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
            </div>
          </div>

          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <div className="text-xs font-medium text-[var(--text-primary)]">Starter recipes</div>
            <div className="mt-3 grid gap-2">
              {FIGMA_RECIPES.map((recipe) => (
                <button
                  key={recipe.id}
                  type="button"
                  onClick={() => setPrompt(recipe.summary)}
                  className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-app)] px-3 py-3 text-left transition-colors hover:border-[var(--border-default)]"
                >
                  <div className="text-sm font-medium text-[var(--text-primary)]">{recipe.label}</div>
                  <div className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">{recipe.summary}</div>
                </button>
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
    </div>
  );
}

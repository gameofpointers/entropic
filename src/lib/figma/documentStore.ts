import { CORE_TOOLS, FigmaAPI, SceneGraph, TOOL_MAP } from "../figma-core";
import { pickRecipe } from "./recipes";

import type { SceneNode, ToolDef } from "../figma-core";
import type { FigmaRecipeStep } from "./recipes";

export type FigmaActivityEntry = {
  id: string;
  kind: "planner" | "tool" | "result" | "error";
  title: string;
  detail: string;
  timestamp: number;
};

export type FigmaDocumentSnapshot = {
  version: number;
  currentPageId: string;
  selectedIds: string[];
  panX: number;
  panY: number;
  zoom: number;
  busy: boolean;
  prompt: string;
  activities: FigmaActivityEntry[];
};

function activity(kind: FigmaActivityEntry["kind"], title: string, detail: string): FigmaActivityEntry {
  return {
    id: crypto.randomUUID(),
    kind,
    title,
    detail,
    timestamp: Date.now(),
  };
}

export class FigmaDocumentStore {
  graph: SceneGraph;
  private listeners = new Set<() => void>();
  private detachGraphListeners: Array<() => void> = [];
  private snapshotState: FigmaDocumentSnapshot;

  constructor() {
    this.graph = new SceneGraph();
    const firstPage = this.graph.getPages()[0];
    this.snapshotState = {
      version: 0,
      currentPageId: firstPage?.id ?? this.graph.rootId,
      selectedIds: [],
      panX: 120,
      panY: 80,
      zoom: 1,
      busy: false,
      prompt: "",
      activities: [
        activity(
          "planner",
          "Workspace ready",
          `Loaded ${CORE_TOOLS.length} OpenPencil-derived tools into the Entropic design workspace.`,
        ),
      ],
    };
    this.attachGraphListeners();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FigmaDocumentSnapshot => this.snapshotState;

  getCurrentPage(): SceneNode | null {
    return this.graph.getNode(this.snapshotState.currentPageId) ?? null;
  }

  getRenderableNodes(): SceneNode[] {
    const page = this.getCurrentPage();
    if (!page) return [];
    const nodes: SceneNode[] = [];
    const visit = (nodeId: string) => {
      const node = this.graph.getNode(nodeId);
      if (!node || !node.visible) return;
      nodes.push(node);
      for (const childId of node.childIds) {
        visit(childId);
      }
    };
    for (const childId of page.childIds) {
      visit(childId);
    }
    return nodes;
  }

  getAbsoluteNodePosition(nodeId: string) {
    return this.graph.getAbsolutePosition(nodeId);
  }

  setSelection(ids: string[]) {
    this.snapshotState = {
      ...this.snapshotState,
      selectedIds: ids,
      version: this.snapshotState.version + 1,
    };
    this.emit();
  }

  panBy(dx: number, dy: number) {
    this.snapshotState = {
      ...this.snapshotState,
      panX: this.snapshotState.panX + dx,
      panY: this.snapshotState.panY + dy,
      version: this.snapshotState.version + 1,
    };
    this.emit();
  }

  zoomAt(nextZoom: number) {
    this.snapshotState = {
      ...this.snapshotState,
      zoom: Math.max(0.3, Math.min(2.5, nextZoom)),
      version: this.snapshotState.version + 1,
    };
    this.emit();
  }

  resetDocument() {
    this.detachGraph();
    this.graph = new SceneGraph();
    const firstPage = this.graph.getPages()[0];
    this.snapshotState = {
      ...this.snapshotState,
      currentPageId: firstPage?.id ?? this.graph.rootId,
      selectedIds: [],
      activities: [
        activity("planner", "Document reset", "Started a fresh design document."),
      ],
      version: this.snapshotState.version + 1,
    };
    this.attachGraphListeners();
    this.emit();
  }

  async runPrompt(prompt: string) {
    const recipe = pickRecipe(prompt);
    const ctx: Record<string, string> = {};
    this.resetDocument();
    this.appendActivity("planner", "Plan selected", `${recipe.label}: ${recipe.summary}`);
    this.snapshotState = {
      ...this.snapshotState,
      busy: true,
      prompt,
      version: this.snapshotState.version + 1,
    };
    this.emit();

    try {
      for (const step of recipe.steps) {
        const args = typeof step.args === "function" ? step.args(ctx) : step.args;
        const result = await this.runTool(step.tool, args);
        if (step.saveAs && result && typeof result === "object" && "id" in result && typeof result.id === "string") {
          ctx[step.saveAs] = result.id;
        }
      }
      this.appendActivity("result", "Recipe complete", `Executed ${recipe.steps.length} tool calls.`);
    } catch (error) {
      this.appendActivity("error", "Execution failed", error instanceof Error ? error.message : String(error));
    } finally {
      this.snapshotState = {
        ...this.snapshotState,
        busy: false,
        version: this.snapshotState.version + 1,
      };
      this.emit();
    }
  }

  async runTool(name: string, args: Record<string, unknown>) {
    const tool = TOOL_MAP.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    this.appendActivity("tool", tool.name, JSON.stringify(args));
    const figma = this.makeFigma();
    const result = await Promise.resolve(tool.execute(figma, args));
    this.syncFromFigma(figma);
    const detail = typeof result === "object" ? JSON.stringify(result) : String(result);
    this.appendActivity("result", `${tool.name} result`, detail);
    return result as Record<string, unknown>;
  }

  private appendActivity(kind: FigmaActivityEntry["kind"], title: string, detail: string) {
    this.snapshotState = {
      ...this.snapshotState,
      activities: [activity(kind, title, detail), ...this.snapshotState.activities].slice(0, 32),
      version: this.snapshotState.version + 1,
    };
    this.emit();
  }

  private makeFigma(): FigmaAPI {
    const figma = new FigmaAPI(this.graph);
    figma.currentPage = figma.wrapNode(this.snapshotState.currentPageId);
    figma.currentPage.selection = this.snapshotState.selectedIds
      .map((id) => figma.getNodeById(id))
      .filter((node): node is NonNullable<typeof node> => node !== null);
    return figma;
  }

  private syncFromFigma(figma: FigmaAPI) {
    this.snapshotState = {
      ...this.snapshotState,
      currentPageId: figma.currentPageId,
      selectedIds: figma.currentPage.selection.map((node) => node.id),
      version: this.snapshotState.version + 1,
    };
    this.emit();
  }

  private attachGraphListeners() {
    const emitter = this.graph.emitter;
    this.detachGraphListeners = [
      emitter.on("node:created", () => this.bump()),
      emitter.on("node:updated", () => this.bump()),
      emitter.on("node:deleted", () => this.bump()),
      emitter.on("node:reparented", () => this.bump()),
      emitter.on("node:reordered", () => this.bump()),
    ];
  }

  private detachGraph() {
    for (const detach of this.detachGraphListeners) {
      detach();
    }
    this.detachGraphListeners = [];
  }

  private bump() {
    this.snapshotState = {
      ...this.snapshotState,
      version: this.snapshotState.version + 1,
    };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

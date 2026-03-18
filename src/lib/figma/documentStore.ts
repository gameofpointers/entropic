import { CORE_TOOLS, FigmaAPI, SceneGraph, TOOL_MAP, syncGeneratedIdCounter } from "../figma-core";

import type { SceneNode, ToolDef, Variable, VariableCollection } from "../figma-core";

const STORAGE_KEY = "entropic.figma.projects.v1";

export type FigmaChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sentAt: number;
  status?: "streaming" | "done" | "error";
};

export type FigmaActivityEntry = {
  id: string;
  kind: "planner" | "tool" | "result" | "error";
  title: string;
  detail: string;
  timestamp: number;
};

export type FigmaProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

type SerializedGraph = {
  rootId: string;
  nodes: SceneNode[];
  variables: Variable[];
  variableCollections: VariableCollection[];
  activeMode: Array<[string, string]>;
};

type SerializedProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  gatewaySessionKey: string | null;
  currentPageId: string;
  selectedIds: string[];
  panX: number;
  panY: number;
  zoom: number;
  prompt: string;
  chatMessages: FigmaChatMessage[];
  activities: FigmaActivityEntry[];
  graph: SerializedGraph;
};

type PersistedWorkspace = {
  activeProjectId: string;
  projects: SerializedProject[];
};

export type FigmaDocumentSnapshot = {
  version: number;
  activeProjectId: string;
  projects: FigmaProjectMeta[];
  gatewaySessionKey: string | null;
  currentPageId: string;
  selectedIds: string[];
  panX: number;
  panY: number;
  zoom: number;
  busy: boolean;
  prompt: string;
  chatMessages: FigmaChatMessage[];
  activities: FigmaActivityEntry[];
};

export type FigmaToolCall = {
  tool: string;
  args: Record<string, unknown>;
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

function emptyGraph(): SceneGraph {
  return new SceneGraph();
}

function createDefaultProject(name = "Untitled Project"): SerializedProject {
  const graph = emptyGraph();
  const firstPage = graph.getPages()[0];
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    gatewaySessionKey: null,
    currentPageId: firstPage?.id ?? graph.rootId,
    selectedIds: [],
    panX: 120,
    panY: 80,
    zoom: 1,
    prompt: "",
    chatMessages: [
      {
        id: crypto.randomUUID(),
        role: "system",
        content: "Gateway-backed Figma agent ready. Prompts will stream here and tool execution will update the canvas.",
        sentAt: now,
        status: "done",
      },
    ],
    activities: [
      activity(
        "planner",
        "Workspace ready",
        `Loaded ${CORE_TOOLS.length} OpenPencil-derived tools into the Entropic design workspace.`,
      ),
    ],
    graph: serializeGraph(graph),
  };
}

function serializeGraph(graph: SceneGraph): SerializedGraph {
  return {
    rootId: graph.rootId,
    nodes: Array.from(graph.nodes.values()).map((node) => structuredClone(node)),
    variables: Array.from(graph.variables.values()).map((variable) => structuredClone(variable)),
    variableCollections: Array.from(graph.variableCollections.values()).map((collection) => structuredClone(collection)),
    activeMode: Array.from(graph.activeMode.entries()),
  };
}

function deserializeGraph(data: SerializedGraph): SceneGraph {
  const graph = emptyGraph();
  graph.nodes = new Map(data.nodes.map((node) => [node.id, structuredClone(node)]));
  graph.variables = new Map(data.variables.map((variable) => [variable.id, structuredClone(variable)]));
  graph.variableCollections = new Map(
    data.variableCollections.map((collection) => [collection.id, structuredClone(collection)]),
  );
  graph.activeMode = new Map(data.activeMode);
  graph.rootId = data.rootId;
  graph.instanceIndex = new Map();

  for (const node of graph.nodes.values()) {
    if (node.componentId && node.type === "INSTANCE") {
      const set = graph.instanceIndex.get(node.componentId) ?? new Set<string>();
      set.add(node.id);
      graph.instanceIndex.set(node.componentId, set);
    }
  }

  syncGeneratedIdCounter(graph.nodes.keys());
  syncGeneratedIdCounter(graph.variables.keys());
  syncGeneratedIdCounter(graph.variableCollections.keys());
  for (const collection of graph.variableCollections.values()) {
    syncGeneratedIdCounter(collection.modes.map((mode) => mode.modeId));
  }

  return graph;
}

function readWorkspace(): PersistedWorkspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const project = createDefaultProject();
      return { activeProjectId: project.id, projects: [project] };
    }
    const parsed = JSON.parse(raw) as PersistedWorkspace;
    if (!parsed.projects || parsed.projects.length === 0) {
      const project = createDefaultProject();
      return { activeProjectId: project.id, projects: [project] };
    }
    return parsed;
  } catch {
    const project = createDefaultProject();
    return { activeProjectId: project.id, projects: [project] };
  }
}

function writeWorkspace(workspace: PersistedWorkspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    // ignore storage failures
  }
}

export class FigmaDocumentStore {
  graph: SceneGraph;
  private listeners = new Set<() => void>();
  private detachGraphListeners: Array<() => void> = [];
  private snapshotState: FigmaDocumentSnapshot;
  private workspace: PersistedWorkspace;

  constructor() {
    this.workspace = readWorkspace();
    const activeProject = this.getStoredActiveProject();
    this.graph = deserializeGraph(activeProject.graph);
    this.snapshotState = this.projectToSnapshot(activeProject, 0, false);
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
      for (const childId of node.childIds) visit(childId);
    };
    for (const childId of page.childIds) visit(childId);
    return nodes;
  }

  getAbsoluteNodePosition(nodeId: string) {
    return this.graph.getAbsolutePosition(nodeId);
  }

  getGatewaySessionKey() {
    return this.snapshotState.gatewaySessionKey;
  }

  ensureGatewaySessionKey() {
    if (this.snapshotState.gatewaySessionKey) return this.snapshotState.gatewaySessionKey;
    const next = crypto.randomUUID();
    this.snapshotState = {
      ...this.snapshotState,
      gatewaySessionKey: next,
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
    return next;
  }

  createProject(name?: string) {
    const projectName = name?.trim() || this.generateProjectName();
    const project = createDefaultProject(projectName);
    this.workspace = {
      activeProjectId: project.id,
      projects: [project, ...this.workspace.projects],
    };
    this.loadProjectById(project.id);
    this.persistWorkspace();
  }

  renameProject(projectId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.workspace = {
      ...this.workspace,
      projects: this.workspace.projects.map((project) =>
        project.id === projectId ? { ...project, name: trimmed, updatedAt: Date.now() } : project,
      ),
    };
    if (projectId === this.snapshotState.activeProjectId) {
      this.snapshotState = {
        ...this.snapshotState,
        projects: this.workspace.projects.map(this.toMeta),
        version: this.snapshotState.version + 1,
      };
      this.emit();
    }
    this.persistWorkspace();
  }

  deleteProject(projectId: string) {
    if (this.workspace.projects.length <= 1) {
      this.createProject("Untitled Project");
    }
    const remaining = this.workspace.projects.filter((project) => project.id !== projectId);
    if (remaining.length === 0) {
      const project = createDefaultProject();
      this.workspace = { activeProjectId: project.id, projects: [project] };
      this.loadProjectById(project.id);
      this.persistWorkspace();
      return;
    }
    const nextActiveId =
      this.workspace.activeProjectId === projectId ? remaining[0].id : this.workspace.activeProjectId;
    this.workspace = {
      activeProjectId: nextActiveId,
      projects: remaining,
    };
    this.loadProjectById(nextActiveId);
    this.persistWorkspace();
  }

  loadProjectById(projectId: string) {
    const project = this.workspace.projects.find((candidate) => candidate.id === projectId);
    if (!project) return;
    this.detachGraph();
    this.graph = deserializeGraph(project.graph);
    this.snapshotState = this.projectToSnapshot(project, this.snapshotState.version + 1, false);
    this.workspace.activeProjectId = project.id;
    this.attachGraphListeners();
    this.emit();
  }

  setSelection(ids: string[]) {
    this.snapshotState = {
      ...this.snapshotState,
      selectedIds: ids,
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  panBy(dx: number, dy: number) {
    this.snapshotState = {
      ...this.snapshotState,
      panX: this.snapshotState.panX + dx,
      panY: this.snapshotState.panY + dy,
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  zoomAt(nextZoom: number) {
    this.snapshotState = {
      ...this.snapshotState,
      zoom: Math.max(0.3, Math.min(2.5, nextZoom)),
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  setBusy(busy: boolean) {
    this.snapshotState = {
      ...this.snapshotState,
      busy,
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  setPrompt(prompt: string) {
    this.snapshotState = {
      ...this.snapshotState,
      prompt,
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  addUserPrompt(prompt: string) {
    this.snapshotState = {
      ...this.snapshotState,
      prompt,
      chatMessages: [
        ...this.snapshotState.chatMessages,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: prompt,
          sentAt: Date.now(),
          status: "done",
        },
      ],
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  upsertAssistantMessage(messageId: string, content: string, status: "streaming" | "done" | "error") {
    const existingIndex = this.snapshotState.chatMessages.findIndex((message) => message.id === messageId);
    const nextMessage: FigmaChatMessage = {
      id: messageId,
      role: "assistant",
      content,
      sentAt: Date.now(),
      status,
    };
    const chatMessages =
      existingIndex >= 0
        ? this.snapshotState.chatMessages.map((message, index) =>
            index === existingIndex ? { ...message, ...nextMessage, sentAt: message.sentAt } : message,
          )
        : [...this.snapshotState.chatMessages, nextMessage];
    this.snapshotState = {
      ...this.snapshotState,
      chatMessages,
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  addSystemMessage(content: string) {
    this.snapshotState = {
      ...this.snapshotState,
      chatMessages: [
        ...this.snapshotState.chatMessages,
        {
          id: crypto.randomUUID(),
          role: "system",
          content,
          sentAt: Date.now(),
          status: "done",
        },
      ],
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  clearChatForActiveProject() {
    this.snapshotState = {
      ...this.snapshotState,
      chatMessages: [],
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  resetDocument(preserveChat = true) {
    const project = this.getStoredActiveProject();
    const fresh = createDefaultProject(project.name);
    fresh.id = project.id;
    fresh.createdAt = project.createdAt;
    fresh.gatewaySessionKey = project.gatewaySessionKey;
    if (preserveChat) {
      fresh.chatMessages = project.chatMessages;
      fresh.prompt = project.prompt;
    }
    this.replaceProject(fresh);
    this.loadProjectById(fresh.id);
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

  async executeToolPlan(calls: FigmaToolCall[]) {
    for (const call of calls) {
      await this.runTool(call.tool, call.args || {});
    }
  }

  getPlanningContext() {
    const page = this.getCurrentPage();
    const summarizeNode = (node: SceneNode, depth: number): Record<string, unknown> => {
      const summary: Record<string, unknown> = {
        id: node.id,
        name: node.name,
        type: node.type,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        childCount: node.childIds.length,
      };
      if (node.text.trim()) {
        summary.text = node.text.length > 120 ? `${node.text.slice(0, 117)}...` : node.text;
      }
      if (depth > 0 && node.childIds.length > 0) {
        summary.children = node.childIds
          .slice(0, 8)
          .map((id) => this.graph.getNode(id))
          .filter((child): child is SceneNode => Boolean(child))
          .map((child) => summarizeNode(child, depth - 1));
      }
      return summary;
    };

    const topLevel =
      page?.childIds
        .map((id) => this.graph.getNode(id))
        .filter((node): node is SceneNode => Boolean(node))
        .map((node) => summarizeNode(node, 2)) ?? [];
    const selectedNodes = this.snapshotState.selectedIds
      .map((id) => this.graph.getNode(id))
      .filter((node): node is SceneNode => Boolean(node))
      .map((node) => summarizeNode(node, 2));
    const recentChat = this.snapshotState.chatMessages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
      status: message.status ?? "done",
    }));
    const recentActivities = this.snapshotState.activities.slice(0, 8).map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      detail: entry.detail,
    }));

    return {
      currentPageId: this.snapshotState.currentPageId,
      selectedIds: this.snapshotState.selectedIds,
      selectedNodes,
      topLevelNodes: topLevel,
      recentChat,
      recentActivities,
      toolCatalog: CORE_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        params: tool.params,
      })),
    };
  }

  getToolCatalog(): ToolDef[] {
    return CORE_TOOLS;
  }

  private appendActivity(kind: FigmaActivityEntry["kind"], title: string, detail: string) {
    this.snapshotState = {
      ...this.snapshotState,
      activities: [activity(kind, title, detail), ...this.snapshotState.activities].slice(0, 40),
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
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
      projects: this.workspace.projects.map(this.toMeta),
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
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
    for (const detach of this.detachGraphListeners) detach();
    this.detachGraphListeners = [];
  }

  private bump() {
    this.snapshotState = {
      ...this.snapshotState,
      version: this.snapshotState.version + 1,
    };
    this.persistActiveProject();
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  private getStoredActiveProject(): SerializedProject {
    return (
      this.workspace.projects.find((project) => project.id === this.workspace.activeProjectId) ??
      this.workspace.projects[0]
    );
  }

  private projectToSnapshot(project: SerializedProject, version: number, busy: boolean): FigmaDocumentSnapshot {
    return {
      version,
      activeProjectId: project.id,
      projects: this.workspace.projects.map(this.toMeta),
      gatewaySessionKey: project.gatewaySessionKey,
      currentPageId: project.currentPageId,
      selectedIds: project.selectedIds,
      panX: project.panX,
      panY: project.panY,
      zoom: project.zoom,
      busy,
      prompt: project.prompt,
      chatMessages: project.chatMessages ?? [],
      activities: project.activities,
    };
  }

  private toMeta(project: SerializedProject): FigmaProjectMeta {
    return {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  private replaceProject(nextProject: SerializedProject) {
    this.workspace = {
      activeProjectId: nextProject.id,
      projects: this.workspace.projects.map((project) => (project.id === nextProject.id ? nextProject : project)),
    };
    this.persistWorkspace();
  }

  private persistActiveProject() {
    const updatedAt = Date.now();
    this.workspace = {
      activeProjectId: this.snapshotState.activeProjectId,
      projects: this.workspace.projects.map((project) =>
        project.id === this.snapshotState.activeProjectId
          ? {
              ...project,
              updatedAt,
              gatewaySessionKey: this.snapshotState.gatewaySessionKey,
              currentPageId: this.snapshotState.currentPageId,
              selectedIds: this.snapshotState.selectedIds,
              panX: this.snapshotState.panX,
              panY: this.snapshotState.panY,
              zoom: this.snapshotState.zoom,
              prompt: this.snapshotState.prompt,
              chatMessages: this.snapshotState.chatMessages,
              activities: this.snapshotState.activities,
              graph: serializeGraph(this.graph),
            }
          : project,
      ),
    };
    this.persistWorkspace();
  }

  private persistWorkspace() {
    writeWorkspace(this.workspace);
  }

  private generateProjectName() {
    const base = "Untitled Project";
    const names = new Set(this.workspace.projects.map((project) => project.name));
    if (!names.has(base)) return base;
    let index = 2;
    while (names.has(`${base} ${index}`)) index += 1;
    return `${base} ${index}`;
  }
}

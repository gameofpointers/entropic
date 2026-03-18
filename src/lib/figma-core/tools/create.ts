import { parseColor } from "../color";

import { defineTool, nodeSummary } from "./schema";

import type { FigmaNodeProxy } from "../figma-api";
import type { VectorNetwork } from "../scene-graph";

type RenderSpecNode = {
  type: "FRAME" | "RECTANGLE" | "ELLIPSE" | "TEXT" | "LINE" | "STAR" | "POLYGON" | "SECTION";
  name?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  stroke_width?: number;
  radius?: number;
  font_size?: number;
  font_weight?: number;
  text_color?: string;
  direction?: "row" | "column";
  gap?: number;
  padding?: number;
  children?: RenderSpecNode[];
};

function parseRenderSpecInput(input: unknown): RenderSpecNode {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as RenderSpecNode;
  }
  if (typeof input !== "string") {
    throw new Error("render_spec requires `spec` as a JSON string or object.");
  }

  try {
    return JSON.parse(input) as RenderSpecNode;
  } catch (jsonError) {
    try {
      return new Function(`"use strict"; return (${input});`)() as RenderSpecNode;
    } catch {
      throw jsonError;
    }
  }
}

function createNodeByType(figma: Parameters<typeof createShape.execute>[0], type: RenderSpecNode["type"]): FigmaNodeProxy {
  const createMap: Record<RenderSpecNode["type"], () => FigmaNodeProxy> = {
    FRAME: () => figma.createFrame(),
    RECTANGLE: () => figma.createRectangle(),
    ELLIPSE: () => figma.createEllipse(),
    TEXT: () => figma.createText(),
    LINE: () => figma.createLine(),
    STAR: () => figma.createStar(),
    POLYGON: () => figma.createPolygon(),
    SECTION: () => figma.createSection(),
  };
  return createMap[type]();
}

function applyNodeStyles(node: FigmaNodeProxy, spec: RenderSpecNode) {
  if (spec.name) node.name = spec.name;
  if (spec.type === "TEXT") {
    node.characters = spec.text || spec.name || "Text";
    node.fontSize = spec.font_size ?? Math.max(14, Math.min(spec.height ?? 24, 28));
    node.fontWeight = spec.font_weight ?? 500;
    node.fills = [
      {
        type: "SOLID",
        color: parseColor(spec.text_color || "#0f172a"),
        opacity: 1,
        visible: true,
      },
    ];
    return;
  }
  if (spec.fill) {
    node.fills = [{ type: "SOLID", color: parseColor(spec.fill), opacity: 1, visible: true }];
  }
  if (spec.stroke) {
    node.strokes = [
      {
        color: parseColor(spec.stroke),
        weight: spec.stroke_width ?? 1,
        opacity: 1,
        visible: true,
        align: "INSIDE",
      },
    ];
  }
  if (spec.radius !== undefined) {
    node.cornerRadius = spec.radius;
  }
}

function measureSpecNode(spec: RenderSpecNode): { width: number; height: number } {
  const padding = spec.padding ?? 0;
  const gap = spec.gap ?? 0;
  if (spec.type === "TEXT") {
    const fontSize = spec.font_size ?? 16;
    const text = spec.text || spec.name || "Text";
    return {
      width: spec.width ?? Math.max(40, Math.ceil(text.length * fontSize * 0.58)),
      height: spec.height ?? Math.ceil(fontSize * 1.4),
    };
  }
  if (!spec.children || spec.children.length === 0) {
    return {
      width: spec.width ?? 120,
      height: spec.height ?? 48,
    };
  }
  const childSizes = spec.children.map(measureSpecNode);
  if (spec.direction === "row") {
    const contentWidth = childSizes.reduce((sum, child) => sum + child.width, 0) + gap * Math.max(0, childSizes.length - 1);
    const contentHeight = childSizes.reduce((max, child) => Math.max(max, child.height), 0);
    return {
      width: spec.width ?? contentWidth + padding * 2,
      height: spec.height ?? contentHeight + padding * 2,
    };
  }
  const contentWidth = childSizes.reduce((max, child) => Math.max(max, child.width), 0);
  const contentHeight = childSizes.reduce((sum, child) => sum + child.height, 0) + gap * Math.max(0, childSizes.length - 1);
  return {
    width: spec.width ?? contentWidth + padding * 2,
    height: spec.height ?? contentHeight + padding * 2,
  };
}

function renderSpecTree(
  figma: Parameters<typeof createShape.execute>[0],
  spec: RenderSpecNode,
  parent: FigmaNodeProxy | null,
  originX: number,
  originY: number,
): FigmaNodeProxy {
  const node = createNodeByType(figma, spec.type);
  const size = measureSpecNode(spec);
  node.x = originX + (spec.x ?? 0);
  node.y = originY + (spec.y ?? 0);
  node.resize(size.width, size.height);
  applyNodeStyles(node, spec);
  if (!spec.fill && spec.type !== "TEXT" && spec.type !== "LINE") {
    node.fills = [{ type: "SOLID", color: parseColor("#f8fafc"), opacity: 1, visible: true }];
  }
  if (!spec.stroke && spec.type !== "TEXT") {
    node.strokes = [
      {
        color: parseColor("#cbd5e1"),
        weight: 1,
        opacity: 1,
        visible: true,
        align: "INSIDE",
      },
    ];
  }
  if (spec.radius === undefined && spec.type !== "TEXT" && spec.type !== "LINE") {
    node.cornerRadius = spec.type === "FRAME" || spec.type === "SECTION" ? 24 : 16;
  }
  if (parent) {
    parent.appendChild(node);
  }

  if (spec.children && spec.children.length > 0) {
    const padding = spec.padding ?? 0;
    const gap = spec.gap ?? 0;
    let cursorX = padding;
    let cursorY = padding;
    for (const child of spec.children) {
      const childSize = measureSpecNode(child);
      renderSpecTree(figma, child, node, cursorX, cursorY);
      if (spec.direction === "row") {
        cursorX += childSize.width + gap;
      } else {
        cursorY += childSize.height + gap;
      }
    }
  }

  return node;
}

export const createShape = defineTool({
  name: "create_shape",
  mutates: true,
  description:
    "Create a shape on the canvas. Use FRAME for containers/cards, RECTANGLE for blocks, ELLIPSE for circles, TEXT for labels, SECTION for larger grouped areas.",
  params: {
    type: {
      type: "string",
      description: "Node type",
      required: true,
      enum: ["FRAME", "RECTANGLE", "ELLIPSE", "TEXT", "LINE", "STAR", "POLYGON", "SECTION"],
    },
    x: { type: "number", description: "X position", required: true },
    y: { type: "number", description: "Y position", required: true },
    width: { type: "number", description: "Width in pixels", required: true, min: 1 },
    height: { type: "number", description: "Height in pixels", required: true, min: 1 },
    name: { type: "string", description: "Node name shown in layers panel" },
    parent_id: { type: "string", description: "Parent node ID to nest inside" },
  },
  execute: (figma, args) => {
    const parentId = args.parent_id;
    const parent = parentId ? figma.getNodeById(parentId) : null;
    const createMap: Record<string, () => FigmaNodeProxy> = {
      FRAME: () => figma.createFrame(),
      RECTANGLE: () => figma.createRectangle(),
      ELLIPSE: () => figma.createEllipse(),
      TEXT: () => figma.createText(),
      LINE: () => figma.createLine(),
      STAR: () => figma.createStar(),
      POLYGON: () => figma.createPolygon(),
      SECTION: () => figma.createSection(),
    };
    const node = createMap[args.type]();
    node.x = args.x;
    node.y = args.y;
    node.resize(args.width, args.height);
    if (args.name) node.name = args.name;
    if (args.type === "TEXT") {
      node.characters = args.name || "Text";
      node.fontSize = Math.max(14, Math.min(args.height, 28));
      node.fills = [{ type: "SOLID", color: parseColor("#0f172a"), opacity: 1, visible: true }];
    } else if (args.type === "LINE") {
      node.strokes = [
        {
          color: parseColor("#94a3b8"),
          weight: 1.5,
          opacity: 1,
          visible: true,
          align: "CENTER",
        },
      ];
    } else {
      node.fills = [{ type: "SOLID", color: parseColor("#f8fafc"), opacity: 1, visible: true }];
      node.strokes = [
        {
          color: parseColor("#cbd5e1"),
          weight: 1,
          opacity: 1,
          visible: true,
          align: "INSIDE",
        },
      ];
      node.cornerRadius = args.type === "FRAME" || args.type === "SECTION" ? 24 : 16;
    }
    if (parent) parent.appendChild(node);
    return nodeSummary(node);
  },
});

export const createComponent = defineTool({
  name: "create_component",
  mutates: true,
  description: "Convert a frame/group into a component.",
  params: {
    id: { type: "string", description: "Node ID to convert", required: true },
  },
  execute: (figma, { id }) => {
    const node = figma.getNodeById(id);
    if (!node) return { error: `Node "${id}" not found` };
    const comp = figma.createComponentFromNode(node);
    return nodeSummary(comp);
  },
});

export const renderSpec = defineTool({
  name: "render_spec",
  mutates: true,
  description:
    "Render a nested UI spec from JSON in one tool call. Best for screens, cards, button rows, and simple app layouts. Example spec: {\"type\":\"FRAME\",\"name\":\"Wallet Screen\",\"width\":360,\"height\":720,\"fill\":\"#dcfce7\",\"direction\":\"column\",\"gap\":16,\"padding\":20,\"children\":[...]}",
  params: {
    spec: {
      type: "string",
      description: "JSON object describing a nested UI tree",
      required: true,
    },
    parent_id: { type: "string", description: "Parent node ID to nest inside" },
    replace_id: { type: "string", description: "Existing node ID to replace" },
    x: { type: "number", description: "Override root X position" },
    y: { type: "number", description: "Override root Y position" },
  },
  execute: (figma, args) => {
    const spec = parseRenderSpecInput(args.spec);
    let parentId = args.parent_id;
    let replaceIndex = -1;

    if (args.replace_id) {
      const target = figma.graph.getNode(args.replace_id);
      if (target?.parentId) {
        parentId = target.parentId;
        const parentNode = figma.graph.getNode(parentId);
        if (parentNode) {
          replaceIndex = parentNode.childIds.indexOf(args.replace_id);
        }
      }
    }

    const parent = parentId ? figma.getNodeById(parentId) : null;
    const root = renderSpecTree(figma, spec, parent, args.x ?? 0, args.y ?? 0);

    if (args.replace_id && parentId && replaceIndex >= 0) {
      figma.graph.reorderChild(root.id, parentId, replaceIndex);
      figma.graph.deleteNode(args.replace_id);
    }

    return {
      id: root.id,
      name: root.name,
      type: root.type,
      childCount: root.children.length,
    };
  },
});

export const createInstance = defineTool({
  name: "create_instance",
  mutates: true,
  description: "Create an instance of a component.",
  params: {
    component_id: { type: "string", description: "Component node ID", required: true },
    x: { type: "number", description: "X position" },
    y: { type: "number", description: "Y position" },
  },
  execute: (figma, args) => {
    const comp = figma.getNodeById(args.component_id);
    if (!comp) return { error: `Component "${args.component_id}" not found` };
    const instance = comp.createInstance();
    if (args.x !== undefined) instance.x = args.x;
    if (args.y !== undefined) instance.y = args.y;
    return nodeSummary(instance);
  },
});

export const createPage = defineTool({
  name: "create_page",
  mutates: true,
  description: "Create a new page.",
  params: {
    name: { type: "string", description: "Page name", required: true },
  },
  execute: (figma, { name }) => {
    const page = figma.createPage();
    page.name = name;
    return { id: page.id, name };
  },
});

export const createVector = defineTool({
  name: "create_vector",
  mutates: true,
  description: "Create a vector node with optional path data.",
  params: {
    x: { type: "number", description: "X position", required: true },
    y: { type: "number", description: "Y position", required: true },
    name: { type: "string", description: "Node name" },
    path: { type: "string", description: "VectorNetwork JSON" },
    fill: { type: "color", description: "Fill color (hex)" },
    stroke: { type: "color", description: "Stroke color (hex)" },
    stroke_weight: { type: "number", description: "Stroke weight" },
    parent_id: { type: "string", description: "Parent node ID" },
  },
  execute: (figma, args) => {
    const node = figma.createVector();
    node.x = args.x;
    node.y = args.y;
    if (args.name) node.name = args.name;
    if (args.path) {
      figma.graph.updateNode(node.id, { vectorNetwork: JSON.parse(args.path) as VectorNetwork });
    }
    if (args.fill) {
      node.fills = [{ type: "SOLID", color: parseColor(args.fill), opacity: 1, visible: true }];
    }
    if (args.stroke) {
      node.strokes = [
        {
          color: parseColor(args.stroke),
          weight: args.stroke_weight ?? 1,
          opacity: 1,
          visible: true,
          align: "CENTER",
        },
      ];
    }
    if (args.parent_id) {
      const parent = figma.getNodeById(args.parent_id);
      if (parent) parent.appendChild(node);
    }
    return nodeSummary(node);
  },
});

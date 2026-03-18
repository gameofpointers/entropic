import { defineTool, nodeSummary, nodeToResult } from "./schema";

import type { FigmaNodeProxy } from "../figma-api";

export const getSelection = defineTool({
  name: "get_selection",
  description: "Get details about currently selected nodes.",
  params: {},
  execute: (figma) => {
    const selection = figma.currentPage.selection;
    return { selection: selection.map(nodeToResult) };
  },
});

type TreeEntry = {
  id: string;
  type: string;
  name: string;
  w: number;
  h: number;
  children?: TreeEntry[];
};

function nodeToTreeEntry(node: FigmaNodeProxy): TreeEntry {
  const entry: TreeEntry = {
    id: node.id,
    type: node.type,
    name: node.name,
    w: node.width,
    h: node.height,
  };
  if (node.children.length > 0) {
    entry.children = node.children.map(nodeToTreeEntry);
  }
  return entry;
}

export const getPageTree = defineTool({
  name: "get_page_tree",
  description:
    "Get the node tree of the current page. Returns lightweight hierarchy: id, type, name, size.",
  params: {},
  execute: (figma) => ({
    page: figma.currentPage.name,
    children: figma.currentPage.children.map(nodeToTreeEntry),
  }),
});

export const getNode = defineTool({
  name: "get_node",
  description:
    "Get detailed properties of a node by ID. Use depth to limit child recursion (0 = node only).",
  params: {
    id: { type: "string", description: "Node ID", required: true },
    depth: { type: "number", description: "Max child depth" },
  },
  execute: (figma, { id, depth }) => {
    const node = figma.getNodeById(id);
    if (!node) return { error: `Node "${id}" not found` };
    return nodeToResult(node, depth);
  },
});

export const findNodes = defineTool({
  name: "find_nodes",
  description: "Find nodes by name pattern and/or type.",
  params: {
    name: { type: "string", description: "Name substring to match" },
    type: {
      type: "string",
      description: "Node type filter",
      enum: [
        "FRAME",
        "RECTANGLE",
        "ELLIPSE",
        "TEXT",
        "LINE",
        "STAR",
        "POLYGON",
        "SECTION",
        "GROUP",
        "COMPONENT",
        "INSTANCE",
        "VECTOR",
      ],
    },
  },
  execute: (figma, args) => {
    const matches = figma.currentPage.findAll((node) => {
      if (args.type && node.type !== args.type) return false;
      if (args.name && !node.name.toLowerCase().includes(args.name.toLowerCase())) return false;
      return true;
    });
    return { count: matches.length, nodes: matches.map(nodeSummary) };
  },
});

export const listPages = defineTool({
  name: "list_pages",
  description: "List all pages in the document.",
  params: {},
  execute: (figma) => ({
    current: figma.currentPage.name,
    pages: figma.root.children.map((page) => ({ id: page.id, name: page.name })),
  }),
});

export const switchPage = defineTool({
  name: "switch_page",
  mutates: true,
  description: "Switch to a different page by name or ID.",
  params: {
    page: { type: "string", description: "Page name or ID", required: true },
  },
  execute: (figma, { page }) => {
    const target = figma.root.children.find((candidate) => candidate.name === page) ?? figma.getNodeById(page);
    if (!target) return { error: `Page "${page}" not found` };
    figma.currentPage = target;
    return { page: target.name, id: target.id };
  },
});

export const getCurrentPage = defineTool({
  name: "get_current_page",
  description: "Get the current page name and ID.",
  params: {},
  execute: (figma) => ({ id: figma.currentPage.id, name: figma.currentPage.name }),
});

export const pageBounds = defineTool({
  name: "page_bounds",
  description: "Get the bounding box of all objects on the current page.",
  params: {},
  execute: (figma) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const child of figma.currentPage.children) {
      const bounds = child.absoluteBoundingBox;
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
    if (minX === Infinity) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  },
});

export const selectNodes = defineTool({
  name: "select_nodes",
  mutates: true,
  description: "Select one or more nodes by ID.",
  params: {
    ids: { type: "string[]", description: "Node IDs to select", required: true },
  },
  execute: (figma, { ids }) => {
    figma.currentPage.selection = ids
      .map((id) => figma.getNodeById(id))
      .filter((node): node is FigmaNodeProxy => node !== null);
    return { selected: ids };
  },
});

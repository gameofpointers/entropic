import { colorToHex } from "../color";

import { defineTool } from "./schema";

import type { SceneNode } from "../scene-graph";

type GraphReader = {
  getNode(id: string): SceneNode | undefined;
};

type DescribeChild = {
  id: string;
  name: string;
  type: string;
  role: string;
  summary: string;
  children?: DescribeChild[];
};

function detectRole(node: SceneNode): string {
  const name = node.name.toLowerCase();
  if (node.type === "TEXT") {
    if (node.fontSize >= 28) return "heading";
    if (node.fontSize >= 18) return "subheading";
    return "text";
  }
  if (name.includes("button") || name === "cta" || name.startsWith("btn")) return "button";
  if (name.includes("icon")) return "icon";
  if (name.includes("card")) return "card";
  if (name.includes("balance")) return "balance";
  if (name.includes("wallet")) return "wallet";
  if (name.includes("nav")) return "navigation";
  return "container";
}

function describeFill(node: SceneNode): string | null {
  const fill = node.fills.find((candidate) => candidate.visible && candidate.type === "SOLID");
  return fill ? colorToHex(fill.color) : null;
}

function describeLayout(node: SceneNode): string | null {
  if (node.layoutMode === "NONE") return null;
  const direction = node.layoutMode === "HORIZONTAL" ? "row" : "column";
  const parts = [`auto-layout ${direction}`];
  if (node.itemSpacing > 0) parts.push(`gap ${node.itemSpacing}`);
  if (node.paddingTop || node.paddingRight || node.paddingBottom || node.paddingLeft) {
    parts.push(
      `padding ${node.paddingTop}/${node.paddingRight}/${node.paddingBottom}/${node.paddingLeft}`,
    );
  }
  return parts.join(", ");
}

function summarizeNode(node: SceneNode): string {
  const parts = [`${node.width}x${node.height}`];
  if (node.type === "TEXT") {
    parts.push(`text "${node.text.slice(0, 48)}"`);
    parts.push(`${node.fontSize}px`);
  }
  const fill = describeFill(node);
  if (fill) parts.push(fill);
  if (node.strokes.some((stroke) => stroke.visible)) parts.push("stroked");
  if (node.cornerRadius > 0) parts.push(`rounded ${node.cornerRadius}`);
  const layout = describeLayout(node);
  if (layout) parts.push(layout);
  return parts.join(", ");
}

function buildChild(node: SceneNode, graph: GraphReader, depth: number): DescribeChild {
  const result: DescribeChild = {
    id: node.id,
    name: node.name,
    type: node.type,
    role: detectRole(node),
    summary: summarizeNode(node),
  };
  if (depth > 0 && node.childIds.length > 0) {
    const children = node.childIds
      .map((id) => graph.getNode(id))
      .filter((child): child is SceneNode => child !== undefined && child.visible)
      .map((child) => buildChild(child, graph, depth - 1));
    if (children.length > 0) {
      result.children = children;
    }
  }
  return result;
}

function countDescendants(graph: GraphReader, nodeId: string): number {
  const node = graph.getNode(nodeId);
  if (!node) return 0;
  let count = 0;
  for (const childId of node.childIds) {
    count += 1 + countDescendants(graph, childId);
  }
  return count;
}

function autoDepth(graph: GraphReader, nodeId: string): number {
  const size = countDescendants(graph, nodeId);
  if (size <= 12) return 4;
  if (size <= 32) return 3;
  if (size <= 72) return 2;
  return 1;
}

export const describe = defineTool({
  name: "describe",
  description:
    "Describe one node or multiple nodes semantically. Good for understanding existing structure before editing. Use `id` for one node or `ids` for many.",
  params: {
    id: { type: "string", description: "Single node ID" },
    ids: { type: "string[]", description: "Multiple node IDs" },
    depth: { type: "number", description: "Child depth override" },
  },
  execute: (figma, args) => {
    const describeOne = (nodeId: string) => {
      const node = figma.graph.getNode(nodeId);
      if (!node) return { id: nodeId, error: `Node "${nodeId}" not found` };
      const depth = Math.min(args.depth ?? autoDepth(figma.graph, nodeId), 5);
      return {
        id: node.id,
        name: node.name,
        type: node.type,
        role: detectRole(node),
        summary: summarizeNode(node),
        children: node.childIds
          .map((id) => figma.graph.getNode(id))
          .filter((child): child is SceneNode => Boolean(child?.visible))
          .map((child) => buildChild(child, figma.graph, depth - 1)),
      };
    };

    if (Array.isArray(args.ids) && args.ids.length > 0) {
      return { nodes: args.ids.map(describeOne) };
    }
    if (!args.id) {
      return { error: "Provide id or ids." };
    }
    return describeOne(args.id);
  },
});

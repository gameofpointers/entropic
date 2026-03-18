import { defineTool } from "./schema";

const MATH_SCOPE = {
  min: Math.min,
  max: Math.max,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  abs: Math.abs,
  sqrt: Math.sqrt,
  pow: Math.pow,
};

function evaluateExpression(expr: string): { expr: string; result: number } | { expr: string; error: string } {
  try {
    const fn = new Function(
      ...Object.keys(MATH_SCOPE),
      `"use strict"; return (${expr});`,
    ) as (...args: Array<(...values: number[]) => number>) => unknown;
    const result = fn(...Object.values(MATH_SCOPE));
    if (typeof result !== "number" || !Number.isFinite(result)) {
      return { expr, error: `Produced ${String(result)}` };
    }
    return { expr, result };
  } catch (error) {
    return { expr, error: error instanceof Error ? error.message : String(error) };
  }
}

export const calc = defineTool({
  name: "calc",
  description:
    "Arithmetic calculator for layout math. Pass one expression or a JSON array of expressions. Supports + - * / % ** ( ) min max floor ceil round abs sqrt pow.",
  params: {
    expr: {
      type: "string",
      description: "Single expression or JSON array of expressions",
      required: true,
    },
  },
  execute: (_figma, { expr }) => {
    let expressions: string[] = [expr];
    try {
      const parsed = JSON.parse(expr);
      if (Array.isArray(parsed)) {
        expressions = parsed.filter((value): value is string => typeof value === "string");
      }
    } catch {
      // Use the raw string as a single expression.
    }

    if (expressions.length === 1) {
      return evaluateExpression(expressions[0]);
    }

    return { results: expressions.map(evaluateExpression) };
  },
});

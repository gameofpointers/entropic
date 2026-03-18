import { BLACK } from "./constants";

import type { Color } from "./types";

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function parseHexColor(input: string): Color | null {
  const hex = input.replace("#", "").trim();
  if (![3, 4, 6, 8].includes(hex.length) || /[^0-9a-f]/i.test(hex)) {
    return null;
  }

  const normalized =
    hex.length === 3 || hex.length === 4
      ? hex.split("").map((part) => `${part}${part}`).join("")
      : hex;
  const hasAlpha = normalized.length === 8;
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const a = hasAlpha ? parseInt(normalized.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
}

function parseRgbColor(input: string): Color | null {
  const match = input
    .trim()
    .match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (!match) return null;
  const [, r, g, b, a] = match;
  return {
    r: clamp01(Number(r) / 255),
    g: clamp01(Number(g) / 255),
    b: clamp01(Number(b) / 255),
    a: clamp01(a === undefined ? 1 : Number(a)),
  };
}

export function parseColor(input: string): Color {
  const trimmed = input.trim();
  return parseHexColor(trimmed) ?? parseRgbColor(trimmed) ?? { ...BLACK };
}

export function normalizeColor(color?: Partial<Color>): Color {
  if (!color) return { ...BLACK };
  return {
    r: clamp01(color.r ?? 0),
    g: clamp01(color.g ?? 0),
    b: clamp01(color.b ?? 0),
    a: clamp01(color.a ?? 1),
  };
}

function toHexByte(value: number): string {
  return Math.round(clamp01(value) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
}

export function colorToHex(color: Color): string {
  return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
}

export function colorToHex8(color: Color, alpha?: number): string {
  const value = alpha ?? color.a;
  if (value >= 1) return colorToHex(color);
  return `${colorToHex(color)}${toHexByte(value)}`;
}

export function colorToHexRaw(color: Color): string {
  return colorToHex(color).slice(1);
}

export function colorToRgba255(color: Color) {
  return {
    r: Math.round(clamp01(color.r) * 255),
    g: Math.round(clamp01(color.g) * 255),
    b: Math.round(clamp01(color.b) * 255),
    a: clamp01(color.a),
  };
}

export function colorToCSS(color: Color): string {
  const { r, g, b, a } = colorToRgba255(color);
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function colorToCSSCompact(color: Color): string {
  const { r, g, b, a } = colorToRgba255(color);
  const alpha = Number(a.toFixed(3));
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

export function rgba255ToColor(r: number, g: number, b: number, a = 1): Color {
  return {
    r: clamp01(r / 255),
    g: clamp01(g / 255),
    b: clamp01(b / 255),
    a: clamp01(a),
  };
}

export function colorToFill(color: string | Color) {
  const rgba = typeof color === "string" ? parseColor(color) : color;
  return {
    type: "SOLID" as const,
    color: { r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a },
    opacity: rgba.a,
    visible: true,
  };
}

export function colorDistance(c1: Color, c2: Color): number {
  const dr = (c1.r - c2.r) * 255;
  const dg = (c1.g - c2.g) * 255;
  const db = (c1.b - c2.b) * 255;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

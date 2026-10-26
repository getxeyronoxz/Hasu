/**
 * Accent colour primitives shared by the server (settings validation) and the
 * renderer (src/lib/accent.ts). Pure: no DOM, no Node APIs.
 */

/** Tailwind cyan-400: the accent the UI shipped with, so the default look never changes. */
export const DEFAULT_ACCENT = "#22d3ee";

/**
 * Returns a lower-case `#rrggbb` for a `#rgb` / `#rrggbb` string, or the
 * fallback for anything else (non-strings, named colours, alpha forms…).
 */
export function normalizeAccent(value: unknown, fallback: string = DEFAULT_ACCENT): string {
  if (typeof value !== "string") return fallback;
  const text = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(text)) return text;
  if (/^#[0-9a-f]{3}$/.test(text)) return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  return fallback;
}

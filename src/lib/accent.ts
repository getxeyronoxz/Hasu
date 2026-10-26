/**
 * User accent colour.
 *
 * The UI is written with Tailwind's `cyan-*` utilities. Tailwind v4 compiles
 * those to `var(--color-cyan-<step>)` (also inside `color-mix`, so opacity
 * modifiers like `bg-cyan-400/20` work), so overriding the 11 theme variables
 * on `<html>` recolours every cyan utility at once without touching a
 * component. The default accent removes the overrides, leaving Tailwind's own
 * stylesheet values and so the exact original look.
 *
 * This is the persistent, user-chosen accent (settings `appearance.accent`).
 * It is unrelated to the transient `themeColor` mood the voice tool sets.
 */
import { DEFAULT_ACCENT, normalizeAccent } from "../../shared/accent";

export { DEFAULT_ACCENT, normalizeAccent };

export const ACCENT_STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
export type AccentStep = (typeof ACCENT_STEPS)[number];
export type AccentScale = Record<AccentStep, string>;

export const PRESET_ACCENTS: ReadonlyArray<{ name: string; hex: string }> = [
  { name: "Cyan", hex: DEFAULT_ACCENT },
  { name: "Hasu lotus", hex: "#ec4899" },
  { name: "Violet", hex: "#8b5cf6" },
  { name: "Emerald", hex: "#10b981" },
  { name: "Amber", hex: "#f59e0b" },
  { name: "Rose", hex: "#f43f5e" },
  { name: "Sky", hex: "#0ea5e9" },
  { name: "Orange", hex: "#f97316" },
];

// ---- colour maths (sRGB <-> OKLab, Björn Ottosson) --------------------------------------

type Rgb = [number, number, number];

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function linearRgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinearRgb(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** `#rrggbb` -> OKLCH (L 0..1, C >= 0, h degrees). */
export function hexToOklch(hex: string): { L: number; C: number; h: number } {
  const [r, g, b] = hexToRgb(normalizeAccent(hex)).map((v) => srgbToLinear(v / 255));
  const [L, a, ab] = linearRgbToOklab(r, g, b);
  return { L, C: Math.hypot(a, ab), h: (Math.atan2(ab, a) * 180) / Math.PI };
}

/** OKLCH -> `#rrggbb`, reducing chroma (keeping lightness and hue) until it fits sRGB. */
function oklchToHex(L: number, C: number, h: number): string {
  const rad = (h * Math.PI) / 180;
  const at = (chroma: number) => oklabToLinearRgb(L, chroma * Math.cos(rad), chroma * Math.sin(rad));
  let chroma = C;
  if (!at(chroma).every((v) => v >= -0.0005 && v <= 1.0005)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (at(mid).every((v) => v >= -0.0005 && v <= 1.0005)) lo = mid;
      else hi = mid;
    }
    chroma = lo;
  }
  const bytes = at(chroma).map((v) => Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255).toString(16).padStart(2, "0"));
  return `#${bytes.join("")}`;
}

// ---- scale ------------------------------------------------------------------------------

/**
 * Shape of Tailwind's own cyan scale (OKLCH lightness and chroma per step),
 * used as the template for every accent so a custom accent keeps the same
 * contrast steps. Chroma is stored relative to step 400.
 */
const TEMPLATE: Record<AccentStep, { L: number; chroma: number }> = {
  "50": { L: 0.984, chroma: 0.019 / 0.154 },
  "100": { L: 0.956, chroma: 0.045 / 0.154 },
  "200": { L: 0.917, chroma: 0.08 / 0.154 },
  "300": { L: 0.865, chroma: 0.127 / 0.154 },
  "400": { L: 0.789, chroma: 1 },
  "500": { L: 0.715, chroma: 0.143 / 0.154 },
  "600": { L: 0.609, chroma: 0.126 / 0.154 },
  "700": { L: 0.52, chroma: 0.105 / 0.154 },
  "800": { L: 0.45, chroma: 0.085 / 0.154 },
  "900": { L: 0.398, chroma: 0.07 / 0.154 },
  "950": { L: 0.302, chroma: 0.056 / 0.154 },
};

/**
 * Builds a 50..950 scale from one base colour. The base is step 400 exactly;
 * lighter steps move toward white and darker steps toward black by the same
 * fractions Tailwind's cyan scale uses, so lightness is monotonic for any
 * input. Invalid input yields the default accent's scale.
 */
export function accentScale(hex: string): AccentScale {
  const base = normalizeAccent(hex);
  const { L: baseL, C: baseC, h } = hexToOklch(base);
  const top = TEMPLATE["400"].L;
  const scale = {} as AccentScale;
  for (const step of ACCENT_STEPS) {
    if (step === "400") {
      scale[step] = base;
      continue;
    }
    const t = TEMPLATE[step];
    const L = t.L > top ? baseL + ((t.L - top) / (1 - top)) * (1 - baseL) : baseL * (1 - (top - t.L) / top);
    scale[step] = oklchToHex(L, baseC * t.chroma, h);
  }
  return scale;
}

// ---- applying to the document -------------------------------------------------------------

const STORAGE_KEY = "hasu.accent.v1";
let currentAccent = DEFAULT_ACCENT;

/** The accent currently applied, for canvas code that cannot read CSS variables. */
export function getCurrentAccent(): string {
  return currentAccent;
}

/** `r, g, b` of the current accent, for building `rgba(...)` strings in canvas drawing. */
export function getCurrentAccentRgb(): string {
  return hexToRgb(currentAccent).join(", ");
}

/**
 * Applies an accent to the page. The default accent clears the overrides so
 * Tailwind's stylesheet values (the original look) apply untouched. The value
 * is mirrored to localStorage so the next launch paints the right colour
 * before the server settings arrive.
 */
export function applyAccent(hex: string, root: HTMLElement = document.documentElement): void {
  const accent = normalizeAccent(hex);
  currentAccent = accent;
  if (accent === DEFAULT_ACCENT) {
    for (const step of ACCENT_STEPS) root.style.removeProperty(`--color-cyan-${step}`);
  } else {
    const scale = accentScale(accent);
    for (const step of ACCENT_STEPS) root.style.setProperty(`--color-cyan-${step}`, scale[step]);
  }
  try {
    localStorage.setItem(STORAGE_KEY, accent);
  } catch {
    /* storage unavailable (private mode): the server setting still applies on load */
  }
}

/** Applies the accent remembered from the last run, if any. */
export function applyStoredAccent(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) applyAccent(stored);
  } catch {
    /* storage unavailable */
  }
}

import { clearLut, hasColorGrade, loadLut, setColorGrade } from "@/modules/framevane-broadcaster";

import { loadPreferences, savePreferences } from "./settings";

/**
 * Filmic's colour tabs as data: the tone curves, the looks, and the operator's
 * LUTs. The native grade does the pixels (ColorGrade.kt); this holds what was
 * chosen, keeps it across launches, and sends it down.
 */

export const CURVES = [
  { id: 0, label: "Native" },
  { id: 1, label: "Natural" },
  { id: 2, label: "Dynamic" },
  { id: 3, label: "Flat" },
  { id: 4, label: "Log" },
] as const;

export type LookParams = {
  contrast: number;
  saturation: number;
  warmth: number;
  tint: number;
  shadowTone: [number, number, number];
  highlightTone: [number, number, number];
};

const NEUTRAL: LookParams = {
  contrast: 1,
  saturation: 1,
  warmth: 0,
  tint: 0,
  shadowTone: [0, 0, 0],
  highlightTone: [0, 0, 0],
};

export const LOOKS: { id: string; name: string; tagline: string; params: LookParams }[] = [
  { id: "none", name: "None", tagline: "The camera as it comes", params: NEUTRAL },
  {
    id: "adamant",
    name: "Adamant",
    tagline: "Teal shadows, warm skin - the modern blockbuster",
    params: { ...NEUTRAL, contrast: 1.12, saturation: 1.05, warmth: 0.12, shadowTone: [-0.6, 0.1, 0.7], highlightTone: [0.7, 0.3, -0.5] },
  },
  {
    id: "novus",
    name: "Novus",
    tagline: "Clean and bright, a touch of punch",
    params: { ...NEUTRAL, contrast: 1.05, saturation: 1.14, warmth: 0.06 },
  },
  {
    id: "golden",
    name: "Golden",
    tagline: "Late-afternoon warmth",
    params: { ...NEUTRAL, saturation: 1.08, warmth: 0.45, highlightTone: [0.5, 0.3, -0.3] },
  },
  {
    id: "arctic",
    name: "Arctic",
    tagline: "Cold, clean, quiet",
    params: { ...NEUTRAL, saturation: 0.88, warmth: -0.45, shadowTone: [-0.2, 0, 0.5] },
  },
  {
    id: "faded",
    name: "Faded",
    tagline: "Lifted blacks, soft colour",
    params: { ...NEUTRAL, contrast: 0.84, saturation: 0.75, shadowTone: [0.25, 0.18, 0.12] },
  },
  {
    id: "verdant",
    name: "Verdant",
    tagline: "Lush greens and outdoor colour",
    params: { ...NEUTRAL, saturation: 1.15, tint: -0.22, highlightTone: [0.1, 0.25, -0.1] },
  },
  {
    id: "bleach",
    name: "Bleach",
    tagline: "Bleach bypass: hard and desaturated",
    params: { ...NEUTRAL, contrast: 1.3, saturation: 0.45 },
  },
  {
    id: "noir",
    name: "Noir",
    tagline: "Black and white, high contrast",
    params: { ...NEUTRAL, contrast: 1.25, saturation: 0 },
  },
];

export type LutSlot = { name: string; path: string } | null;

export type GradeState = {
  curve: number;
  black: number;
  white: number;
  shadow: number;
  highlight: number;
  look: string;
  luts: LutSlot[];
  /** Index of the LUT in use, or null. */
  lut: number | null;
  lutStrength: number;
};

export const GRADE_DEFAULTS: GradeState = {
  curve: 0,
  black: 0,
  white: 1,
  shadow: 0,
  highlight: 0,
  look: "none",
  luts: [null, null, null, null, null],
  lut: null,
  lutStrength: 1,
};

export function loadGrade(): GradeState {
  return { ...GRADE_DEFAULTS, ...(loadPreferences().grade ?? {}) };
}

export function lookParams(id: string): LookParams {
  return LOOKS.find((l) => l.id === id)?.params ?? NEUTRAL;
}

/** Sends the whole grade down: on launch, and after each change. */
export async function applyGrade(state: GradeState, previous?: GradeState): Promise<void> {
  if (!hasColorGrade()) return;
  setColorGrade({
    curve: state.curve,
    black: state.black,
    white: state.white,
    shadow: state.shadow,
    highlight: state.highlight,
    ...lookParams(state.look),
    lutStrength: state.lutStrength,
  });
  const path = state.lut !== null ? state.luts[state.lut]?.path : undefined;
  const before = previous && previous.lut !== null ? previous.luts[previous.lut]?.path : undefined;
  if (!previous || path !== before) {
    if (path) await loadLut(path).catch(() => clearLut());
    else clearLut();
  }
}

export function saveGrade(next: GradeState, previous?: GradeState): GradeState {
  savePreferences({ grade: next });
  void applyGrade(next, previous);
  return next;
}

/**
 * A swatch of what a look does, worked out the way the shader works it out,
 * on a fixed palette - sky, skin, foliage, shadow - so the tiles show the
 * look itself rather than a stock photo.
 */
export const SWATCH = [
  [0.45, 0.65, 0.88],
  [0.87, 0.66, 0.55],
  [0.36, 0.56, 0.3],
  [0.16, 0.15, 0.18],
] as const;

export function previewLook(rgb: readonly number[], p: LookParams): string {
  let [r, g, b] = rgb;
  r = (r - 0.5) * p.contrast + 0.5;
  g = (g - 0.5) * p.contrast + 0.5;
  b = (b - 0.5) * p.contrast + 0.5;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  r = l + (r - l) * p.saturation;
  g = l + (g - l) * p.saturation;
  b = l + (b - l) * p.saturation;
  r += p.warmth * 0.12 + p.tint * 0.05 + p.shadowTone[0] * (1 - l) * 0.15 + p.highlightTone[0] * l * 0.15;
  g += -p.tint * 0.1 + p.shadowTone[1] * (1 - l) * 0.15 + p.highlightTone[1] * l * 0.15;
  b += -p.warmth * 0.12 + p.tint * 0.05 + p.shadowTone[2] * (1 - l) * 0.15 + p.highlightTone[2] * l * 0.15;
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${to(r)},${to(g)},${to(b)})`;
}

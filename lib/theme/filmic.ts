/**
 * Filmic design tokens - the single source of truth for the camera chrome.
 *
 * The viewfinder draws with inline/StyleSheet values (a reticle, a slider knob,
 * a translucent pill), which Tailwind classes cannot supply, so the literal
 * values live here. The same palette is mirrored into tailwind.config.ts as
 * `filmic.*` colour classes for the className consumers, and the dark semantic
 * variables in global.css are tuned to match so the settings screens shift in
 * lockstep. Author once here; change here to change everywhere.
 *
 * The look: a near-black, slightly cool chrome; dense, hairline-separated
 * controls; off-white ink; one amber accent for "held/active"; one red for the
 * air. No colour on the picture itself unless it is telling the operator
 * something.
 */

export const filmic = {
  color: {
    /** The deepest surface - the app root behind everything. */
    base: "#0C0D11",
    /** Solid panels: the landscape control column, sheets, settings cards. */
    surface: "#121318",
    /** A row or control raised off a panel. */
    elevated: "#1C1E25",
    /** Translucent pill/disc over the picture - reads on bright and dark. */
    panel: "rgba(18,19,24,0.78)",
    /** A dimmer translucent fill for secondary chrome. */
    panelSoft: "rgba(12,13,17,0.62)",

    /** Off-white text and glyphs. */
    ink: "#F4F5F7",
    /** Secondary text - labels, inactive. */
    inkMuted: "#9BA0AC",

    /** Hairline strokes. */
    line: "rgba(255,255,255,0.12)",
    lineStrong: "rgba(255,255,255,0.20)",

    /** The one accent: held focus, locked exposure, active control. */
    accent: "#F5B531",
    /** Ink on an amber fill. */
    accentInk: "#141414",

    /** The air: record and live. */
    alert: "#FF3B30",
    /** Healthy / connected. */
    good: "#34C759",
  },

  radius: {
    sm: 8,
    md: 12,
    lg: 16,
    pill: 999,
  },

  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },

  /** Type scale. Families fall back to system until the condensed/mono
   *  packages are wired; sizes/weights carry the Filmic density in the meantime. */
  type: {
    label: 10,
    body: 13,
    readout: 14,
    title: 17,
  },
} as const;

export type FilmicColor = keyof typeof filmic.color;

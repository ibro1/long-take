import { useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { Text } from "@/components/ui/text";
import { filmic } from "@/lib/theme/filmic";

import { Mono } from "./mono";

/**
 * A persistent Filmic-style vertical control slider for the viewfinder.
 *
 * The edge rails open one at a time on a tap, which is right for the controls
 * you reach for occasionally. These sliders are the opposite case: the operator
 * wants zoom, focus and exposure *always on the glass* while framing, the way
 * Filmic Pro keeps them down the side - no tap to reveal, no guessing which one
 * is live. So this control is drawn to stand on the picture indefinitely rather
 * than to appear and vanish: a translucent panel that holds over a bright sky
 * and a dark hall alike, a tick-marked track that reads as a scale at a glance,
 * and the icon carried *on the knob* so the one thing the thumb is already
 * looking at also says which control it is.
 *
 * The drag is relative, lifted straight from the edge-rails RailTrack: onStart
 * snapshots the value under the thumb and onUpdate adds the travel to it, so a
 * thumb landing anywhere on the track never jumps the lens to where it landed.
 * On a live shot an absolute slider is a thrown-away frame; this never is.
 */

/** Wide enough to catch a thumb aiming at a thin track. */
const COLUMN = 44;

/** The knob, and therefore how far the value can actually travel. */
const KNOB = 30;

/** The track's default length when the screen does not dictate one. */
const DEFAULT_HEIGHT = 168;

/**
 * How many tick marks to lay down the track. Enough to read as a scale, few
 * enough that they stay separate on the shortest track we allow.
 */
const TICKS = 9;

export function ControlSlider({
  icon,
  value,
  min,
  max,
  onChange,
  format,
  label,
  disabled,
  height,
  locked,
}: {
  /** Carried on the knob, so the thing under the thumb names the control. */
  icon: ReactNode;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  format: (value: number) => string;
  label: string;
  /** A control the lens cannot do right now: drawn, faded, and not draggable. */
  disabled?: boolean;
  /** The track length; defaults when the caller has nothing to say about it. */
  height?: number;
  /** Held/active - amber rather than white, the one accent in the chrome. */
  locked?: boolean;
}) {
  const track = height ?? DEFAULT_HEIGHT;
  const span = max - min;

  // Relative dragging: base is the value the thumb landed on, latest mirrors
  // the live prop so a start always snapshots the current value even after a
  // parent-driven change between drags.
  const base = useRef(value);
  const latest = useRef(value);
  latest.current = value;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .runOnJS(true)
        .onStart(() => {
          base.current = latest.current;
        })
        .onUpdate((event) => {
          if (span <= 0) return;
          // Up is more - screen y grows downwards and the value does not.
          const moved = (-event.translationY / (track - KNOB)) * span;
          const next = Math.min(max, Math.max(min, base.current + moved));
          onChange(next);
        }),
    [disabled, span, min, max, onChange, track],
  );

  const travel = track - KNOB;
  const knobTop = span > 0 ? travel - ((value - min) / span) * travel : travel;

  // One amber when held/active, off-white otherwise. The accent is the only
  // colour the chrome spends, so the operator reads "this one is doing
  // something" without reading a word.
  const accent = locked ? filmic.color.accent : filmic.color.ink;
  const glyphOpacity = disabled ? 0.4 : 1;

  return (
    <View
      className="items-center rounded-2xl px-1.5 py-2"
      style={{ backgroundColor: filmic.color.panel, opacity: disabled ? 0.55 : 1 }}
    >
      {/* Tiny, uppercase, tracked out: a header for the scale, not a reading. */}
      <Text
        className="pb-1.5 text-[9px] font-semibold uppercase"
        style={{ color: locked ? filmic.color.accent : filmic.color.inkMuted, letterSpacing: 1 }}
      >
        {label}
      </Text>

      <GestureDetector gesture={pan}>
        <View style={{ height: track, width: COLUMN }} collapsable={false}>
          {/* The spine the ticks hang on - dark-cored so it survives a bright
              sky, which a bare hairline does not. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: COLUMN / 2 - 1,
              top: KNOB / 2,
              bottom: KNOB / 2,
              width: 2,
              borderRadius: filmic.radius.pill,
              backgroundColor: filmic.color.lineStrong,
            }}
          />

          {/* The Filmic scale: short marks down the track, evenly spaced across
              the knob's travel so each tick sits where a value actually lands. */}
          {Array.from({ length: TICKS }).map((_, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: COLUMN / 2 - 5,
                top: KNOB / 2 + (i / (TICKS - 1)) * travel - 0.5,
                width: i % 2 === 0 ? 10 : 6,
                height: 1.5,
                borderRadius: 1,
                backgroundColor: filmic.color.line,
                opacity: glyphOpacity,
              }}
            />
          ))}

          {/* The knob, carrying the icon. White or amber so it reads as the one
              thing you can move, with a dark edge so it holds on any picture. */}
          <View
            pointerEvents="none"
            style={{
              position: "absolute",
              left: COLUMN / 2 - KNOB / 2,
              top: knobTop,
              height: KNOB,
              width: KNOB,
              borderRadius: filmic.radius.pill,
              borderWidth: 2,
              borderColor: "rgba(0,0,0,0.4)",
              backgroundColor: accent,
              alignItems: "center",
              justifyContent: "center",
              opacity: glyphOpacity,
            }}
          >
            {icon}
          </View>
        </View>
      </GestureDetector>

      {/* The reading, in tabular figures so a changing value does not shift
          sideways under a glance. Amber when the control is held/active. */}
      <View
        className="mt-1.5 rounded-full px-2 py-0.5"
        style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      >
        <Mono className={`text-[11px] font-semibold ${locked ? "text-filmic-accent" : "text-filmic-ink"}`}>
          {format(value)}
        </Mono>
      </View>
    </View>
  );
}

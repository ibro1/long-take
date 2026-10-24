import { type JSX, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { Text } from "@/components/ui/text";
import { filmic } from "@/lib/theme/filmic";

import { Panel } from "./chrome";
import { ValueSlider } from "./value-slider";

/**
 * The colour diamond's panel: white balance and exposure, the two settings
 * that decide what the picture looks like rather than what it shows.
 *
 * Laid out the way Filmic Pro lays it out - a row of presets first, because
 * a preset is what an operator reaches for nine times in ten, and the manual
 * sliders only once they have said they want them. Nothing manual is drawn
 * for a lens that cannot do it: a slider the camera ignores teaches the
 * operator that the sliders do not work.
 *
 * The panel holds the values it is showing while a slider is under the
 * thumb. The props round-trip through native and arrive a frame or two late,
 * and a knob that chased its own stale value would stutter backwards.
 */

/** Camera2's CONTROL_AWB_MODE_AUTO. */
const AWB_AUTO = 1;
/** CONTROL_AWB_MODE_OFF. The Kelvin chip stands for it; it is not a preset. */
const AWB_OFF = 0;

/** Where Kelvin mode starts when the camera has not reported a temperature. */
const DEFAULT_KELVIN = 5500;

const KELVIN_MIN = 2000;
const KELVIN_MAX = 10000;
const TINT_MIN = -50;
const TINT_MAX = 50;

/** Third-stop ISO values, the numbers printed on every camera's dial. */
const ISO_STOPS = [
  50, 64, 80, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 2000, 2500, 3200, 4000, 5000,
  6400, 8000, 10000, 12800, 16000, 20000, 25600, 32000, 40000, 51200,
];

/**
 * Shutter denominators: the third-stop series plus the video speeds (1/48,
 * 1/50, 1/60, 1/100, 1/120) an operator matching mains lighting asks for.
 */
const SHUTTER_DENOMINATORS = [
  8000, 6400, 5000, 4000, 3200, 2500, 2000, 1600, 1250, 1000, 800, 640, 500, 400, 320, 250, 240, 200, 160, 125,
  120, 100, 96, 80, 60, 50, 48, 40, 30, 25, 24, 20, 15,
];

/**
 * One word per chip, so the whole row fits across a phone. The full name
 * still reaches a screen reader through describeWhiteBalance.
 */
const SHORT_WB: Record<number, string> = {
  1: "Auto",
  2: "Tungsten",
  3: "Fluorescent",
  4: "Warm",
  5: "Daylight",
  6: "Cloudy",
  7: "Twilight",
  8: "Shade",
};

function shortWhiteBalance(mode: number, describe: (mode: number) => string): string {
  return SHORT_WB[mode] ?? describe(mode).split(" - ")[0];
}

export type ImagePanelProps = {
  onClose: () => void;
  // white balance
  whiteBalanceModes: number[]; // Camera2 AWB modes the lens offers (1 = auto)
  whiteBalance: number; // current preset mode, or -1 when in kelvin mode
  describeWhiteBalance: (mode: number) => string;
  onWhiteBalance: (mode: number) => void;
  manualWhiteBalance: boolean; // lens supports kelvin/tint
  kelvin: number | null; // null = not in kelvin mode
  tint: number;
  onKelvin: (kelvin: number, tint: number) => void;
  // exposure
  manualSensor: boolean; // lens supports ISO/shutter
  exposureMode: "auto" | "manual";
  onExposureMode: (mode: "auto" | "manual") => void;
  isoRange: { min: number; max: number } | null;
  exposureTimeRange: { minNs: number; maxNs: number } | null;
  iso: number;
  exposureNs: number;
  onManualExposure: (iso: number, exposureNs: number) => void;
  fps: number; // for the 180-degree hint
};

/** `5500K`. */
function formatKelvin(k: number): string {
  return `${Math.round(k)}K`;
}

/** Signed, because the sign is the meaning: minus is green, plus is magenta. */
function formatTint(t: number): string {
  const r = Math.round(t);
  return r > 0 ? `+${r}` : `${r}`;
}

function formatIso(iso: number): string {
  return `${Math.round(iso)}`;
}

/** `1/60`, or seconds for the rare exposure longer than one. */
function formatShutter(ns: number): string {
  if (!(ns > 0)) return "–";
  const denominator = 1e9 / ns;
  if (denominator >= 1) return `1/${Math.round(denominator)}`;
  return `${(ns / 1e9).toFixed(1)}s`;
}

/** ISO stops the sensor can do, with its own ends added so both are reachable. */
function isoStops(range: { min: number; max: number } | null): number[] {
  if (!range || range.max <= range.min) return [];
  const inside = ISO_STOPS.filter((s) => s >= range.min && s <= range.max);
  return Array.from(new Set([range.min, ...inside, range.max])).sort((a, b) => a - b);
}

/**
 * Shutter stops from 1/8000 up to 1/fps, in nanoseconds, ascending - so the
 * slider brightens to the right, the same way as ISO beside it. Nothing
 * longer than a frame: the camera cannot expose for longer than it has to
 * deliver the next one, and asking would only drop the frame rate.
 */
function shutterStops(range: { minNs: number; maxNs: number } | null, fps: number): number[] {
  if (!range || range.maxNs <= range.minNs) return [];
  const slowest = fps > 0 ? fps : 1;
  const denominators = new Set(SHUTTER_DENOMINATORS);
  if (fps > 0) {
    denominators.add(Math.round(fps));
    denominators.add(Math.round(fps * 2));
  }
  return Array.from(denominators)
    .filter((d) => d >= slowest - 1e-6 && d <= 8000)
    .map((d) => 1e9 / d)
    .filter((ns) => ns >= range.minNs && ns <= range.maxNs)
    .sort((a, b) => a - b);
}

/** Close enough to call it the same speed: 1/60 against 16,666,667 ns. */
function sameShutter(a: number, b: number): boolean {
  return a > 0 && b > 0 && Math.abs(a - b) / b < 0.01;
}

export function ImagePanel(props: ImagePanelProps): JSX.Element {
  const {
    onClose,
    whiteBalanceModes,
    whiteBalance,
    describeWhiteBalance,
    onWhiteBalance,
    manualWhiteBalance,
    kelvin,
    tint,
    onKelvin,
    manualSensor,
    exposureMode,
    onExposureMode,
    isoRange,
    exposureTimeRange,
    iso,
    exposureNs,
    onManualExposure,
    fps,
  } = props;

  // Local copies, resynced whenever the camera reports something new.
  const [localKelvin, setLocalKelvin] = useState(kelvin ?? DEFAULT_KELVIN);
  const [localTint, setLocalTint] = useState(tint);
  const [localIso, setLocalIso] = useState(iso);
  const [localNs, setLocalNs] = useState(exposureNs);
  useEffect(() => {
    if (kelvin !== null) setLocalKelvin(kelvin);
  }, [kelvin]);
  useEffect(() => setLocalTint(tint), [tint]);
  useEffect(() => setLocalIso(iso), [iso]);
  useEffect(() => setLocalNs(exposureNs), [exposureNs]);

  const presets = useMemo(() => whiteBalanceModes.filter((m) => m !== AWB_OFF), [whiteBalanceModes]);
  const kelvinOn = kelvin !== null;

  const isoList = useMemo(() => isoStops(isoRange), [isoRange]);
  const shutterList = useMemo(() => shutterStops(exposureTimeRange, fps), [exposureTimeRange, fps]);
  const manual = manualSensor && exposureMode === "manual";
  const naturalNs = fps > 0 ? 1e9 / (2 * fps) : 0;
  const natural = sameShutter(localNs, naturalNs);

  const goManual = () => {
    if (!manualSensor || exposureMode === "manual") return;
    onExposureMode("manual");
    // Seeded from what auto exposure had settled on, so the picture does not
    // jump the moment the operator takes over - they start from the shot they
    // were looking at and adjust from there.
    const seedIso = isoRange ? Math.min(isoRange.max, Math.max(isoRange.min, iso)) : iso;
    const frameNs = fps > 0 ? 1e9 / fps : Number.POSITIVE_INFINITY;
    const maxNs = Math.min(exposureTimeRange?.maxNs ?? Number.POSITIVE_INFINITY, frameNs);
    const seedNs = Math.min(maxNs, Math.max(exposureTimeRange?.minNs ?? 0, exposureNs));
    setLocalIso(seedIso);
    setLocalNs(seedNs);
    onManualExposure(seedIso, seedNs);
  };

  return (
    <Panel title="Image" onClose={onClose}>
      {/* White balance only appears with something to choose: one mode is a
          control that does nothing. */}
      {presets.length > 1 || manualWhiteBalance ? (
        <View className="gap-2">
          <SectionLabel>White balance</SectionLabel>
          <View className="flex-row flex-wrap gap-1.5">
            {presets.map((mode) => (
              <Chip
                key={mode}
                label={shortWhiteBalance(mode, describeWhiteBalance)}
                spoken={describeWhiteBalance(mode)}
                selected={!kelvinOn && whiteBalance === mode}
                onPress={() => onWhiteBalance(mode)}
              />
            ))}
            {manualWhiteBalance ? (
              <Chip
                label="Kelvin"
                spoken="Set the colour temperature by hand"
                selected={kelvinOn}
                onPress={() => {
                  if (!kelvinOn) onKelvin(localKelvin, localTint);
                }}
              />
            ) : null}
          </View>

          {manualWhiteBalance && kelvinOn ? (
            <View className="gap-1 pt-1">
              <ValueSlider
                label="Temperature"
                value={localKelvin}
                min={KELVIN_MIN}
                max={KELVIN_MAX}
                step={100}
                format={formatKelvin}
                onChange={(k) => {
                  setLocalKelvin(k);
                  onKelvin(k, localTint);
                }}
              />
              <ValueSlider
                label="Tint"
                value={localTint}
                min={TINT_MIN}
                max={TINT_MAX}
                step={1}
                format={formatTint}
                onChange={(t) => {
                  setLocalTint(t);
                  onKelvin(localKelvin, t);
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {presets.length > 1 || manualWhiteBalance ? <Separator /> : null}

      <View className="gap-2">
        <SectionLabel>Exposure</SectionLabel>
        <View className="flex-row overflow-hidden rounded-lg border-hairline border-filmic-line">
          <Segment
            label="Auto"
            selected={!manual}
            onPress={() => {
              if (exposureMode !== "auto") onExposureMode("auto");
            }}
          />
          <View style={styles.segmentDivider} />
          <Segment label="Manual" selected={manual} disabled={!manualSensor} onPress={goManual} />
        </View>

        {!manualSensor ? (
          <Text className="text-xs text-filmic-inkmuted">
            This lens does not let the app set ISO and shutter by hand.
          </Text>
        ) : null}

        {manual ? (
          isoList.length > 1 && shutterList.length > 0 ? (
            <View className="gap-1 pt-1">
              <ValueSlider
                label="ISO"
                value={localIso}
                min={isoList[0]}
                max={isoList[isoList.length - 1]}
                stops={isoList}
                format={formatIso}
                onChange={(next) => {
                  setLocalIso(next);
                  onManualExposure(next, localNs);
                }}
              />
              <ValueSlider
                label="Shutter"
                value={localNs}
                min={shutterList[0]}
                max={shutterList[shutterList.length - 1]}
                stops={shutterList}
                format={formatShutter}
                onChange={(next) => {
                  setLocalNs(next);
                  onManualExposure(localIso, next);
                }}
              />
              {/* The 180-degree rule: open half of each frame. Faster looks
                  stuttery, slower smears - this is the motion the eye expects
                  from film, so it is said outright and lit up when it is set. */}
              {fps > 0 ? (
                <Text className={`text-xs ${natural ? "font-semibold text-filmic-accent" : "text-filmic-inkmuted"}`}>
                  {`1/${Math.round(2 * fps)} gives natural motion`}
                </Text>
              ) : null}
            </View>
          ) : (
            <Text className="text-xs text-filmic-inkmuted">
              The camera has not reported its ISO and shutter range yet.
            </Text>
          )
        ) : null}
      </View>
    </Panel>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <Text className="text-[10px] font-semibold uppercase tracking-wide text-filmic-inkmuted">{children}</Text>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

// Static style plus className for press feedback: nativewind's Pressable drops
// a style function outright (see filmic-chrome.tsx).
function Chip({
  label,
  spoken,
  selected,
  onPress,
}: {
  label: string;
  spoken: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={4}
      className={`min-h-8 justify-center rounded-md px-2.5 active:opacity-60 ${
        selected ? "bg-filmic-accent" : "bg-filmic-elevated"
      }`}
    >
      <Text
        numberOfLines={1}
        className={`text-xs ${selected ? "font-semibold text-filmic-accentink" : "text-filmic-ink"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Segment({
  label,
  selected,
  disabled = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-9 flex-1 items-center justify-center active:opacity-60 ${
        selected ? "bg-filmic-accent" : "bg-filmic-elevated"
      }`}
      style={disabled ? styles.disabled : undefined}
    >
      <Text className={`text-xs ${selected ? "font-semibold text-filmic-accentink" : "text-filmic-ink"}`}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: filmic.color.line, marginVertical: 4 },
  segmentDivider: { width: StyleSheet.hairlineWidth, backgroundColor: filmic.color.line },
  disabled: { opacity: 0.4 },
});

import { useCallback, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";

/**
 * Composition guides over the picture: rule of thirds, a centre cross, and the
 * 4:3 and 1:1 safe areas for when the landscape feed is cropped downstream
 * (a 4:3 projector, a square social post).
 *
 * Drawn inside the picture area only - the screen minus the chrome insets -
 * because a thirds line that runs under a control column marks a third of the
 * glass, not of the shot. Never takes touches: the reticles and the touch layer
 * underneath must keep working with guides on.
 */

export type GuideSet = { thirds: boolean; centre: boolean; safe43: boolean; safe11: boolean };

type Insets = { left: number; right: number; top: number; bottom: number };

/** Faint white: visible on a dark room, not competing with the reticles' amber. */
const GUIDE = "rgba(255,255,255,0.35)";
const STROKE = 1;
/** Dashed so a safe area never reads as a thirds line or a frame edge. */
const DASH = "6 4";
/** Full length of the centre cross. */
const CROSS = 24;

/** Largest rectangle of the given aspect (w/h) that fits, centred. */
function fit(width: number, height: number, aspect: number) {
  const w = width / height > aspect ? height * aspect : width;
  const h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export function FramingGuides({ guides, insets }: { guides: GuideSet; insets: Insets }) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    // Skip identical layouts so a parent re-render does not cost a second pass.
    setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }, []);

  const any = guides.thirds || guides.centre || guides.safe43 || guides.safe11;
  if (!any) return null;

  const { width, height } = size;
  const ready = width > 0 && height > 0;
  const cx = width / 2;
  const cy = height / 2;
  const half = CROSS / 2;
  const safe43 = ready ? fit(width, height, 4 / 3) : null;
  const safe11 = ready ? fit(width, height, 1) : null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        pointerEvents="none"
        onLayout={onLayout}
        style={{
          position: "absolute",
          left: insets.left,
          right: insets.right,
          top: insets.top,
          bottom: insets.bottom,
        }}
      >
        {ready ? (
          <Svg width={width} height={height}>
            {guides.thirds ? (
              <>
                <Line x1={width / 3} y1={0} x2={width / 3} y2={height} stroke={GUIDE} strokeWidth={STROKE} />
                <Line x1={(width * 2) / 3} y1={0} x2={(width * 2) / 3} y2={height} stroke={GUIDE} strokeWidth={STROKE} />
                <Line x1={0} y1={height / 3} x2={width} y2={height / 3} stroke={GUIDE} strokeWidth={STROKE} />
                <Line x1={0} y1={(height * 2) / 3} x2={width} y2={(height * 2) / 3} stroke={GUIDE} strokeWidth={STROKE} />
              </>
            ) : null}
            {guides.centre ? (
              <>
                <Line x1={cx - half} y1={cy} x2={cx + half} y2={cy} stroke={GUIDE} strokeWidth={STROKE} />
                <Line x1={cx} y1={cy - half} x2={cx} y2={cy + half} stroke={GUIDE} strokeWidth={STROKE} />
              </>
            ) : null}
            {guides.safe43 && safe43 ? (
              <Rect
                x={safe43.x}
                y={safe43.y}
                width={safe43.w}
                height={safe43.h}
                stroke={GUIDE}
                strokeWidth={STROKE}
                strokeDasharray={DASH}
                fill="none"
              />
            ) : null}
            {guides.safe11 && safe11 ? (
              <Rect
                x={safe11.x}
                y={safe11.y}
                width={safe11.w}
                height={safe11.h}
                stroke={GUIDE}
                strokeWidth={STROKE}
                strokeDasharray={DASH}
                fill="none"
              />
            ) : null}
          </Svg>
        ) : null}
      </View>
    </View>
  );
}

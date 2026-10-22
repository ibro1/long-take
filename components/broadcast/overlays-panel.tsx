import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";

import { Text } from "@/components/ui/text";
import type { Connection } from "@/lib/broadcast/connections";
import {
  applyPreset,
  canPushOverlays,
  clearOverlays,
  lastPushedFromHere,
  listPresets,
  type OverlayPreset,
} from "@/lib/broadcast/overlays";

import { Panel, Row } from "./chrome";

/** Stands in for a preset id while a take-down is in flight; no preset can hold it. */
const CLEAR = " clear";

/**
 * The overlays already saved for this stream, on the glass, for an operator
 * who is the entire crew.
 *
 * A studio operator at a laptop pushes the lower third while someone else
 * films; alone with a phone on a stand there is nobody to do that, and until
 * now no way to put an overlay up at all. This panel is deliberately only the
 * pushing half - names to tap and a way to take them down. Writing an overlay
 * stays in the dashboard, where there is a keyboard and where nobody is
 * holding a camera steady at the time.
 */
export function OverlaysPanel({
  connection,
  onClose,
}: {
  connection: Connection | null;
  onClose: () => void;
}) {
  const [presets, setPresets] = useState<OverlayPreset[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * What this phone pushed, which is a smaller claim than what is on screen -
   * see `lastPushedFromHere`. Held from the moment of the tap and put back if
   * the studio refuses, so the row answers the finger rather than the round
   * trip.
   */
  const [applied, setApplied] = useState<string | null>(() =>
    connection ? lastPushedFromHere(connection.id) : null,
  );
  const [pending, setPending] = useState<string | null>(null);

  /**
   * The panel is closed by the operator, often a second after a tap. An answer
   * that arrives afterwards is dropped rather than setting state on something
   * that is no longer on screen.
   */
  const onScreen = useRef(true);
  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!connection) return;
    setLoading(true);
    setMessage(null);
    const result = await listPresets(connection);
    if (!onScreen.current) return;
    setLoading(false);
    if (result.ok) {
      setPresets(result.value);
    } else {
      setMessage(result.message);
    }
  }, [connection]);

  /**
   * Read again every time the panel opens. Presets are made, renamed and
   * deleted in the dashboard while the phone is filming, and a list held over
   * from half an hour ago is how a tap puts the wrong name in front of an
   * audience.
   */
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const push = useCallback(
    (preset: OverlayPreset) => {
      if (!connection) return;
      setApplied(preset.id);
      setPending(preset.id);
      setMessage(null);
      void (async () => {
        const result = await applyPreset(connection, preset.id);
        if (!onScreen.current) return;
        setPending(null);
        if (!result.ok) {
          setApplied(lastPushedFromHere(connection.id));
          setMessage(result.message);
        }
      })();
    },
    [connection],
  );

  const takeDown = useCallback(() => {
    if (!connection) return;
    setApplied(null);
    setPending(CLEAR);
    setMessage(null);
    void (async () => {
      const result = await clearOverlays(connection);
      if (!onScreen.current) return;
      setPending(null);
      if (!result.ok) {
        setApplied(lastPushedFromHere(connection.id));
        setMessage(result.message);
      }
    })();
  }, [connection]);

  /**
   * Said once, in one line, rather than offered as a control that takes a tap
   * and does nothing. Overlays are burned in by Framevane's own compositor, so
   * a destination pointing anywhere else has none - that is a fact about where
   * the video is going, not a fault to apologise for.
   */
  if (!canPushOverlays(connection)) {
    return (
      <Panel title="Overlays" onClose={onClose}>
        <Text className="text-sm text-white/70">
          {connection
            ? "This destination does not go through Framevane, so there are no overlays to push."
            : "No destination yet, so there is nowhere to push an overlay."}
        </Text>
      </Panel>
    );
  }

  const list = presets ?? [];

  return (
    <Panel title="Overlays" onClose={onClose}>
      {list.map((preset) => (
        <Row
          key={preset.id}
          label={preset.name}
          selected={applied === preset.id}
          /* Only ever a claim about this phone: the studio is never asked what
             is on screen, and a dashboard operator can change it without this
             phone hearing a thing. */
          hint={pending === preset.id ? "Pushing" : "Pushed from here"}
          onPress={() => push(preset)}
        />
      ))}

      {loading && list.length === 0 ? (
        <Text className="text-sm text-white/70">Reading the presets on this stream.</Text>
      ) : null}

      {!loading && list.length === 0 && !message ? (
        <Text className="text-sm text-white/70">
          No presets on this stream. They are written in the dashboard, on something with a
          keyboard.
        </Text>
      ) : null}

      {/* Take down clears every slot rather than the last thing pushed. It is
          the control reached for when something is on screen that should not
          be, and at that moment nobody wants to work out which one it was. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Take down"
        onPress={takeDown}
        className="mt-1 items-center rounded-xl border border-white/20 bg-white/10 px-3 py-2.5"
      >
        <Text className="text-sm font-semibold text-white">
          {pending === CLEAR ? "Taking down" : "Take down"}
        </Text>
      </Pressable>

      {message ? (
        <View className="gap-2">
          <Text className="text-sm text-amber-200">{message}</Text>
          {/* A failure here is usually the uplink, and it is often over by the
              time the line has been read. The way out is another go, not a trip
              back to the dashboard. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={() => void refresh()}
            className="self-start rounded-full bg-white/15 px-3 py-1.5"
          >
            <Text className="text-xs font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      ) : null}
    </Panel>
  );
}

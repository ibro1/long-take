import { useState } from "react";

import { Group, Page, SwitchRow } from "@/components/settings/chrome";
import {
  loadPreferences,
  type Preferences,
  QUICK_CONTROLS,
  type QuickControl,
  savePreferences,
} from "@/lib/broadcast/settings";

/**
 * Which controls sit on the glass.
 *
 * The viewfinder has room for about six controls a hand can find without
 * looking, and it offers nine. Which six depends entirely on the job: a
 * one-camera church stream never flips the camera and records every week, a
 * touchline operator flips constantly and has never taken a still. So the
 * choice is the operator's, and nothing is ever removed - what comes off the
 * glass goes into the overflow menu, one tap further in.
 *
 * The microphone, the torch and the button that goes live are not listed.
 * Those are reached for without looking away from the picture, and a control
 * that can move is a control that is not where the hand expects it.
 */
export default function QuickAccessScreen() {
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());

  const onGlass = new Set(preferences.quickAccess);

  const toggle = (control: QuickControl) => {
    const next = QUICK_CONTROLS.filter((id) =>
      id === control ? !onGlass.has(id) : onGlass.has(id),
    );
    setPreferences(savePreferences({ quickAccess: next }));
  };

  return (
    <Page
      title="Quick access"
      intro={
        onGlass.size === QUICK_CONTROLS.length
          ? `All ${QUICK_CONTROLS.length} controls are on the glass.`
          : `${onGlass.size} of ${QUICK_CONTROLS.length} controls are on the glass. The rest are in the overflow menu.`
      }
    >
      <Group
        title="Panels"
        footer="Turning one off does not take it away. It moves into the overflow menu on the viewfinder, which is one tap rather than none."
      >
        {PANELS.map((control) => (
          <SwitchRow
            key={control}
            label={LABEL[control]}
            detail={DETAIL[control]}
            on={onGlass.has(control)}
            onPress={() => toggle(control)}
          />
        ))}
      </Group>

      <Group
        title="During a broadcast"
        footer="The microphone and the torch stay on the glass either way, beside the button that goes live. Those three are found by feel while the operator is watching the picture, so they do not move."
      >
        {TRANSPORT.map((control) => (
          <SwitchRow
            key={control}
            label={LABEL[control]}
            detail={DETAIL[control]}
            on={onGlass.has(control)}
            onPress={() => toggle(control)}
          />
        ))}
      </Group>
    </Page>
  );
}

/**
 * Split the way the viewfinder splits them - the row of panels opened before
 * going live, and the row of things done to a broadcast already running - so
 * that a control is looked for here in the same group it sits in there.
 */
const PANELS: QuickControl[] = ["camera", "shape", "overlays", "stats", "log"];
const TRANSPORT: QuickControl[] = ["record", "photo", "pause", "flip"];

/** Word for word what the control is labelled on the glass. */
const LABEL: Record<QuickControl, string> = {
  camera: "Camera",
  shape: "Shape",
  overlays: "Overlays",
  stats: "Stats",
  log: "Log",
  record: "Record",
  photo: "Photo",
  pause: "Pause",
  flip: "Flip",
};

const DETAIL: Record<QuickControl, string> = {
  camera: "Focus, exposure, stabilisation and white balance.",
  shape: "Portrait, landscape, or follow the phone.",
  overlays: "Push this stream's overlays, where the destination has a compositor behind it.",
  stats: "Picture size, codec, and what is actually going out.",
  log: "What the encoder has said this session.",
  record: "Start and stop a copy on the phone by hand.",
  photo: "Write a still from the camera.",
  pause: "Hold the picture and the sound without dropping the connection.",
  flip: "Front camera to back and back again.",
};

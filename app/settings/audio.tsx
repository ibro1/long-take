import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";

import { ChoiceRow, Group, Page, SwitchRow } from "@/components/settings/chrome";
import { audioDevices, deviceLabel } from "@/components/settings/phone";
import { offerableInputs } from "@/lib/broadcast/inputs";
import {
  loadPreferences,
  loadSettings,
  type PhoneEncoderSettings,
  type Preferences,
  savePreferences,
  saveSettings,
} from "@/lib/broadcast/settings";
import * as Broadcaster from "@/modules/framevane-broadcaster";
import type { AudioDevice } from "@/modules/framevane-broadcaster";

/**
 * The sound, which is the half of a broadcast an audience will not forgive.
 *
 * Two kinds of setting share this screen and they behave differently. The
 * microphone and its gain are separate native calls that are safe to make
 * while live, so they go in as they are touched; the encoding below them
 * cannot be changed without rebuilding the encoder, so it waits for the next
 * broadcast. Each group says which it is, rather than leaving the operator to
 * find out mid-broadcast.
 */
export default function AudioSettingsScreen() {
  const [settings, setSettings] = useState<PhoneEncoderSettings>(() => loadSettings());
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  /**
   * Why the last choice did not take, when it did not.
   *
   * This screen used to swallow the failure whole: the tap did nothing, the
   * chip sprang back to the device Android was still using, and nothing
   * anywhere said why. A control that silently declines is worse than one that
   * is missing, because the operator goes on believing they changed it.
   */
  const [note, setNote] = useState<string | null>(null);

  const update = (patch: Partial<PhoneEncoderSettings>) => setSettings(saveSettings(patch));

  /**
   * Re-read the list, without letting a failed read empty it.
   *
   * An empty answer means the module could not enumerate the inputs, not that
   * the phone has none - and replacing a good list with it is how this screen
   * came to show a single chip after a tap that failed. The list only shrinks
   * to nothing when it was already nothing.
   */
  const refreshDevices = useCallback(() => {
    const next = offerableInputs(audioDevices());
    setDevices((previous) => (next.length > 0 || previous.length === 0 ? next : previous));
  }, []);

  /**
   * Re-read on focus rather than subscribe: the list changes when something is
   * plugged in, and a lapel mic connected while this screen was open is found
   * by leaving it and coming back.
   */
  useFocusEffect(
    useCallback(() => {
      refreshDevices();
    }, [refreshDevices]),
  );

  /** What the encoder says it is using, which beats what we last asked for. */
  const currentDevice = devices.find((device) => device.current)?.id ?? preferences.audioDeviceId;

  const selectDevice = async (id: number) => {
    setPreferences(savePreferences({ audioDeviceId: id }));
    setNote(null);
    try {
      await Broadcaster.selectAudioDevice(id);
    } catch (error) {
      setNote(
        error instanceof Error && error.message
          ? `The phone would not switch microphone: ${error.message}`
          : "The phone would not switch microphone.",
      );
    }

    /**
     * Read back rather than assumed, and read back again after the reopen the
     * native side does when a preview is running - the microphone is stopped
     * and started so the recorder actually moves, and it takes a moment to say
     * what it landed on.
     */
    refreshDevices();
    setTimeout(refreshDevices, 900);
  };

  const setGain = async (micGain: number) => {
    update({ micGain });
    try {
      await Broadcaster.setMicGain(micGain);
    } catch {
      // Off air there may be no capture session to apply it to. It is stored,
      // and it goes in with the rest at the next broadcast.
    }
  };

  return (
    <Page title="Audio">
      <Group
        title="Microphone"
        note="Applied now, unless a broadcast or a recording is running."
        footer={
          note ??
          (devices.length === 0
            ? "Nothing to list until the viewfinder has opened the microphone. Go to Broadcast once, then come back."
            : "Changing this stops and restarts the microphone, so it cannot be changed mid-broadcast - a choice made while live is used from the next one. A lapel mic plugged in after this screen opened shows up when you come back to it. Where the phone has several built-in microphones they are numbered, because Android gives them all the same name.")
        }
      >
        <ChoiceRow
          label="Input"
          value={currentDevice}
          options={[
            { label: "Let Android choose", value: -1 },
            ...devices.map((device) => ({ label: deviceLabel(device), value: device.id })),
          ]}
          onChange={selectDevice}
        />
      </Group>

      <Group
        title="Gain"
        note="Applied now when the viewfinder is open, and from the next broadcast otherwise."
        footer="1× is the microphone as it comes. Above that is gain rather than volume: it lifts a quiet room and it clips anything that was already loud, and clipping cannot be undone downstream. Watch the meter on the viewfinder."
      >
        <ChoiceRow
          label="Gain"
          value={settings.micGain}
          options={[
            { label: "0.5×", value: 0.5 },
            { label: "0.75×", value: 0.75 },
            { label: "1×", value: 1 },
            { label: "1.5×", value: 1.5 },
            { label: "2×", value: 2 },
          ]}
          onChange={setGain}
        />
      </Group>

      <Group
        title="Encoding"
        note="A phone microphone does not justify more than 128k. Spend the bits on picture."
      >
        <ChoiceRow
          label="Bitrate"
          value={settings.audioBitrate}
          options={[
            { label: "64k", value: 64_000 },
            { label: "128k", value: 128_000 },
            { label: "192k", value: 192_000 },
          ]}
          onChange={(audioBitrate) => update({ audioBitrate })}
        />
        <ChoiceRow
          label="Sample rate"
          value={settings.sampleRate}
          options={[
            { label: "44.1 kHz", value: 44_100 },
            { label: "48 kHz", value: 48_000 },
          ]}
          onChange={(sampleRate) => update({ sampleRate })}
        />
        <ChoiceRow
          label="Channels"
          value={settings.stereo ? 1 : 0}
          options={[
            { label: "Mono", value: 0 },
            { label: "Stereo", value: 1 },
          ]}
          onChange={(value) => update({ stereo: value === 1 })}
        />
      </Group>

      <Group
        title="Capture effects"
        note="Applied at the next broadcast."
        footer="Both are Android's own processing, written for phone calls."
      >
        <SwitchRow
          label="Suppress noise"
          detail="Helps a voice in a noisy hall and chews music and crowd sound."
          on={settings.noiseSuppressor}
          onPress={() => update({ noiseSuppressor: !settings.noiseSuppressor })}
        />
        <SwitchRow
          label="Cancel echo"
          detail="Worth having when the phone is also playing audio out loud. Nothing to cancel otherwise."
          on={settings.echoCanceler}
          onPress={() => update({ echoCanceler: !settings.echoCanceler })}
        />
      </Group>
    </Page>
  );
}

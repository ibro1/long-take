import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { ChoiceRow, Group, NavRow, Page, paper, SwitchRow, useSettingsNav } from "@/components/settings/chrome";
import {
  CODEC_LABEL,
  codecOptions,
  codecSupport,
  listCodecs,
  recordingsOnPhone,
  supports,
  totalBytes,
} from "@/components/settings/phone";
import { Text } from "@/components/ui/text";
import { formatBytes } from "@/lib/broadcast/recordings";
import {
  DEFAULT_FRAME_RATES,
  DEFAULT_PICTURES,
  loadPreferences,
  loadSettings,
  type PhoneEncoderSettings,
  type Preferences,
  RECORD_QUALITIES,
  recordQualityFor,
  savePreferences,
  saveSettings,
  SPLIT_BYTES,
  TAKE_FRAME_RATES,
  TAKE_PICTURES,
  TAKE_QUALITIES,
  takeRateOffered,
} from "@/lib/broadcast/settings";
import * as Broadcaster from "@/modules/framevane-broadcaster";
import type { RecordingFile } from "@/modules/framevane-broadcaster";

/**
 * How the picture is encoded, which is a fact about this handset rather than
 * about any destination - picture size and bitrate are set per destination,
 * where a YouTube stream and a test server can differ.
 *
 * Everything here takes effect at the next broadcast. Reconfiguring an encoder
 * takes the camera down, and doing that from a settings screen while the phone
 * is on air is a surprise nobody should get.
 *
 * Recording lives here too. It is the other half of what happens to the
 * picture, and it moved here when the settings hub became Filmic's grid of
 * nine, which has no tile of its own for it.
 */
export default function VideoSettingsScreen() {
  const nav = useSettingsNav();
  const [tab, setTab] = useState<"encoding" | "framerate" | "recording">("encoding");
  // The steady rates of the lens now open; empty off the viewfinder or on an
  // older build, when the usual four are offered.
  const [lensRates] = useState<number[]>(() => {
    try {
      return Broadcaster.capabilities().frameRates ?? [];
    } catch {
      return [];
    }
  });
  const [settings, setSettings] = useState<PhoneEncoderSettings>(() => loadSettings());
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [codecs, setCodecs] = useState(() => codecSupport());
  const [recordings, setRecordings] = useState<RecordingFile[]>(() => recordingsOnPhone());
  const [canSaveToGallery] = useState(() => {
    try {
      return Broadcaster.canSaveToGallery();
    } catch {
      return false;
    }
  });

  const update = (patch: Partial<PhoneEncoderSettings>) => setSettings(saveSettings(patch));
  const updatePreferences = (patch: Partial<Preferences>) =>
    setPreferences(savePreferences(patch));

  /**
   * Picking is one press, and backing out of Android's picker is not a
   * failure: an empty answer means the operator changed their mind, and the
   * folder they already had stands. Clearing it is the second press, which is
   * why the row offers it.
   */
  const chooseFolder = useCallback(async () => {
    if (preferences.recordingFolder) {
      setPreferences(savePreferences({ recordingFolder: "" }));
      await Broadcaster.setRecordingFolder("").catch(() => {});
      return;
    }
    const uri = await Broadcaster.pickRecordingFolder().catch(() => "");
    if (!uri) return;
    setPreferences(savePreferences({ recordingFolder: uri }));
    await Broadcaster.setRecordingFolder(uri).catch(() => {});
  }, [preferences.recordingFolder]);

  /**
   * The encoder only knows what this phone can do once a capture session
   * exists, so the list is re-read every time this screen comes up rather than
   * once at mount - a phone that has since opened the viewfinder has an answer
   * now where it had none before.
   */
  useFocusEffect(
    useCallback(() => {
      setCodecs(codecSupport());
      setPreferences(loadPreferences());
      setRecordings(recordingsOnPhone());
    }, []),
  );

  return (
    <Page title="Video">
      {/* Filmic's Video page: tabs rather than one long list. Encoding and
          Frame Rate are what a take is recorded at - the app's main job. */}
      <TabBar
        tabs={[
          { id: "encoding", label: "Encoding" },
          { id: "framerate", label: "Frame Rate" },
          { id: "recording", label: "Recording" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "encoding" ? (
        <>
      <Group footer="For recordings with no destination; a destination keeps its own. A size this camera cannot record falls back to 1080p, and the app says so.">
        <View style={tileStyles.row}>
          {TAKE_PICTURES.map((p) => (
            <Tile
              key={p.height}
              label={p.height === 2160 ? "4K" : `${p.height}p`}
              detail={
                p.height === 2160
                  ? "UHD"
                  : p.height === 1440
                    ? "QHD"
                    : p.height === 1080
                      ? "Full HD"
                      : p.height === 720
                        ? "HD"
                        : p.height === 480
                          ? "SD"
                          : "Low"
              }
              on={preferences.takeHeight === p.height}
              onPress={() => updatePreferences({ takeHeight: p.height })}
            />
          ))}
        </View>
        <Stepper
          options={TAKE_QUALITIES}
          value={preferences.takeQuality}
          onChange={(takeQuality) => updatePreferences({ takeQuality })}
        />
      </Group>

      <Group
        title="Codec"
        footer={
          <>
            <Text className="text-xs text-muted-foreground">
              H.265 carries the same picture at about half the bitrate, which is the difference
              between 720p and 1080p on the same uplink. H.264 is understood by everything.
            </Text>
            {codecs.length === 0 ? (
              <Text className="text-xs text-muted-foreground">
                This phone has not said what it can encode. H.264 is safe on anything.
              </Text>
            ) : (
              <Text className="text-xs text-muted-foreground">
                This phone encodes {listCodecs(codecs)}.
                {supports(codecs, "h265") ? "" : " It cannot encode H.265, so that is not offered."}
              </Text>
            )}
            {codecs.length > 0 && !supports(codecs, settings.videoCodec) ? (
              <Text className="text-xs text-destructive">
                {CODEC_LABEL[settings.videoCodec]} is set but this phone does not report it. The
                broadcast will fail when you go live. Choose one of the above.
              </Text>
            ) : null}
          </>
        }
      >
        <ChoiceRow
          label="Codec"
          value={settings.videoCodec}
          options={codecOptions(codecs, settings.videoCodec)}
          onChange={(videoCodec) => update({ videoCodec })}
        />
      </Group>

      <Group
        title="Encoder"
        footer="Leave it on. It is here because a few handsets report hardware H.265 and then produce a broken picture with it, and falling back to software is the only way to stream at all on those."
      >
        <SwitchRow
          label="Encode on the hardware"
          detail="Software encoding heats the phone until it throttles, which ends a long broadcast by itself."
          on={settings.preferHardwareCodec}
          onPress={() => update({ preferHardwareCodec: !settings.preferHardwareCodec })}
        />
      </Group>
        </>
      ) : null}

      {tab === "framerate" ? (
        <Group footer="24 for a film look, 25 or 30 to match the mains where you are, 60 for smooth motion. Greyed rates are ones this phone's camera cannot hold; 120 and 240 need slow-motion capture, which is not in the app yet.">
          <View style={tileStyles.fpsRow}>
            {TAKE_FRAME_RATES.map((fps) => {
              const on = preferences.takeFps === fps;
              // Greyed where this phone cannot hold the rate, as Filmic does.
              const offered = takeRateOffered(fps, lensRates);
              return (
                <Pressable
                  key={fps}
                  accessibilityRole="button"
                  accessibilityLabel={`${fps} frames per second${offered ? "" : ", not available on this phone"}`}
                  accessibilityState={{ selected: on, disabled: !offered }}
                  disabled={!offered}
                  onPress={() => updatePreferences({ takeFps: fps })}
                  className="active:opacity-60"
                  style={[tileStyles.fps, on && tileStyles.fpsOn]}
                >
                  <Text
                    style={[
                      tileStyles.fpsText,
                      on && { color: paper.ink },
                      !offered && { color: paper.track },
                    ]}
                  >
                    {fps}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Group>
      ) : null}

      {tab === "recording" ? (
        <>

      <Group
        title="New destinations"
        footer="What a destination starts at when you add one. Each destination can override it on Destinations, and the ones you already have keep their own."
      >
        <ChoiceRow
          label="Default resolution"
          value={preferences.defaultHeight}
          options={DEFAULT_PICTURES.map((p) => ({ label: p.label, value: p.height as number }))}
          onChange={(defaultHeight) => updatePreferences({ defaultHeight })}
        />
        <ChoiceRow
          label="Default frame rate"
          value={preferences.defaultFps}
          options={DEFAULT_FRAME_RATES.map((fps) => ({ label: `${fps} fps`, value: fps as number }))}
          onChange={(defaultFps) => updatePreferences({ defaultFps })}
        />
      </Group>

      <Group
        title="Recording"
        footer="Framevane already archives everything it receives, so the copy on the phone is not the one you would normally edit from - it is the one that survives the uplink failing entirely. It costs storage and a little heat. A take is always written to the app's own folder first, because that is the only place Android lets it be written without a storage permission; moving it to the library happens once the recorder has closed the file. Sections are numbered and each one is closed and saved on its own, so a file that goes wrong costs that section and not the whole take; they also close at 3.5 GB whatever the time is set to, which is the largest file a card reader will take. Recording at a different size from the broadcast runs a second video encoder, which costs heat - and it is also the only way the file is kept clear of the network. Matching the broadcast means one encoder feeding both, so when the uplink congests and the bitrate is dropped to keep the picture moving, the recording is dropped with it. A size of its own is written at its own bitrate whatever the connection does. The rungs are the ones that fit the broadcast's shape exactly; a size that does not fit is ignored and the log says so."
      >
        <SwitchRow
          label="Record to the phone while broadcasting"
          detail="Starts with the broadcast and stops with it."
          on={preferences.recordWhileStreaming}
          onPress={() =>
            updatePreferences({ recordWhileStreaming: !preferences.recordWhileStreaming })
          }
        />
        <SwitchRow
          label="Save to the phone's video library"
          detail={
            canSaveToGallery
              ? "Finished takes move to Movies/Framevane, where the gallery and any video player can open them."
              : "This phone is too old for the video library; takes stay in the app's folder."
          }
          on={preferences.saveToGallery && canSaveToGallery}
          onPress={() => {
            if (!canSaveToGallery) return;
            const next = !preferences.saveToGallery;
            updatePreferences({ saveToGallery: next });
            void Broadcaster.setSaveToGallery(next).catch(() => {});
          }}
        />
        <NavRow
          label="Where recordings are kept"
          detail={
            preferences.recordingFolder
              ? "A folder you picked. Tap to choose a different one."
              : canSaveToGallery
                ? "The phone's video library, in Movies/Framevane."
                : "This app's own folder - this phone is too old for the library."
          }
          value={preferences.recordingFolder ? folderName(preferences.recordingFolder) : undefined}
          onPress={() => void chooseFolder()}
        />
        <ChoiceRow
          label="Record at"
          value={preferences.recordHeight}
          options={RECORD_QUALITIES.map((q) => ({
            label: q.height === 0 ? "Same" : q.label,
            value: q.height as number,
          }))}
          onChange={(height) => {
            updatePreferences({ recordHeight: height });
            const quality = recordQualityFor(height);
            void Broadcaster.setRecordingQuality(quality.height, quality.bitrate).catch(() => {});
          }}
        />
        <ChoiceRow
          label="Split long recordings"
          value={preferences.splitMinutes}
          options={[
            { label: "Off", value: 0 },
            { label: "15 min", value: 15 },
            { label: "30 min", value: 30 },
            { label: "60 min", value: 60 },
          ]}
          onChange={(minutes) => {
            updatePreferences({ splitMinutes: minutes });
            void Broadcaster.setRecordingSplit(minutes, SPLIT_BYTES).catch(() => {});
          }}
        />
        <NavRow
          label="Recordings on the phone"
          detail={recordingsSummary(recordings)}
          onPress={() => nav.go("/settings/recordings")}
        />
      </Group>

      {/* The shape of the broadcast is set from the viewfinder, where the
          operator can see what it does to the picture; saying so here is
          cheaper than an operator hunting for it in Settings. */}
      <View className="px-1">
        <Text className="text-xs text-muted-foreground">
          Bitrate belongs to the destination and is set on Destinations, along with the picture
          size and frame rate it actually sends. Portrait or landscape is set from the viewfinder,
          under Shape.
        </Text>
      </View>
        </>
      ) : null}
    </Page>
  );
}

/** Filmic's tab strip: the chosen tab white with an accent edge, the rest grey. */
function TabBar<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <View style={tileStyles.tabs}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.id)}
            style={[tileStyles.tab, on && tileStyles.tabOn]}
          >
            <Text style={[tileStyles.tabText, on && { color: paper.ink, fontWeight: "600" }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Tile({
  label,
  detail,
  on,
  onPress,
}: {
  label: string;
  detail: string;
  on: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${detail}`}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      className="active:opacity-60"
      style={[tileStyles.tile, on && tileStyles.tileOn]}
    >
      <Text style={[tileStyles.tileLabel, on && { color: paper.accentInk }]}>{label}</Text>
      <Text style={[tileStyles.tileDetail, on && { color: paper.accentInk }]}>{detail}</Text>
    </Pressable>
  );
}

/** Filmic's quality picker: one value between two arrows. */
function Stepper<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; detail: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const step = (d: number) => onChange(options[(i + d + options.length) % options.length].value);
  return (
    <View style={tileStyles.stepper}>
      <Pressable accessibilityRole="button" accessibilityLabel="Lower quality" onPress={() => step(-1)} hitSlop={8} style={tileStyles.arrow}>
        <ChevronLeft size={28} color={paper.ink} />
      </Pressable>
      <View style={{ flex: 1, alignItems: "center" }}>
        <Text style={tileStyles.stepValue}>{options[i].label} quality</Text>
        <Text style={tileStyles.stepDetail}>{options[i].detail}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Higher quality" onPress={() => step(1)} hitSlop={8} style={tileStyles.arrow}>
        <ChevronRight size={28} color={paper.ink} />
      </Pressable>
    </View>
  );
}

const tileStyles = StyleSheet.create({
  tabs: { flexDirection: "row", borderRadius: 8, overflow: "hidden", backgroundColor: paper.track },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center", borderTopWidth: 3, borderTopColor: "transparent" },
  tabOn: { backgroundColor: paper.card, borderTopColor: paper.accent },
  tabText: { color: paper.inkMuted, fontSize: 15 },
  row: { flexDirection: "row", gap: 6, padding: 12 },
  tile: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: "center", backgroundColor: paper.page },
  tileOn: { backgroundColor: paper.accent },
  tileLabel: { color: paper.ink, fontSize: 16, fontWeight: "600" },
  tileDetail: { color: paper.inkMuted, fontSize: 11 },
  stepper: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingBottom: 12 },
  arrow: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  stepValue: { color: paper.ink, fontSize: 17, fontWeight: "600" },
  stepDetail: { color: paper.inkMuted, fontSize: 12 },
  fpsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 14, paddingHorizontal: 8 },
  fps: { width: 48, height: 48, borderRadius: 29, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
  fpsOn: { borderColor: paper.ink },
  fpsText: { color: paper.inkMuted, fontSize: 19 },
});

function recordingsSummary(recordings: RecordingFile[]): string {
  if (recordings.length === 0) return "Nothing on the phone yet";
  return `${recordings.length} ${recordings.length === 1 ? "file" : "files"}, ${formatBytes(
    totalBytes(recordings),
  )}`;
}

/**
 * The tail of a document-tree URI, which is the part that means anything.
 *
 * `content://com.android.externalstorage.documents/tree/primary%3ADCIM%2FTakes`
 * is not a folder name to anybody. The last segment after the colon is, and a
 * URI shaped differently - a network provider, a third-party file app - falls
 * back to saying that a folder is set rather than guessing at its name.
 */
function folderName(uri: string): string {
  try {
    const tail = decodeURIComponent(uri).split(":").pop() ?? "";
    const name = tail.split("/").filter(Boolean).pop();
    return name ?? "Chosen";
  } catch {
    return "Chosen";
  }
}

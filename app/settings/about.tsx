import Constants from "expo-constants";
import * as IntentLauncher from "expo-intent-launcher";
import { useRef, useState } from "react";
import { Pressable, Share } from "react-native";

import { Group, NavRow, Page, ReadoutRow } from "@/components/settings/chrome";
import { Text } from "@/components/ui/text";
import { loadSettings } from "@/lib/broadcast/settings";
import { latestPerfFile, perfShareText, setPerfLog, usePerfLog } from "@/lib/diagnostics/perf-log";

/**
 * What this app is and which build of it is running.
 *
 * The version and the build number are here for one reason: a bug report that
 * does not carry them cannot be acted on, and the operator reporting it is
 * usually standing somewhere with one bar of signal. Both are read from the
 * manifest the running app was built with rather than from anything typed into
 * a constant, so they cannot drift from the binary they describe.
 */
export default function AboutScreen() {
  const [codec] = useState(() => loadSettings().videoCodec);
  const perfOn = usePerfLog();
  const [perfNote, setPerfNote] = useState<string | null>(null);

  // Three taps on the version inside a second and a half. Hidden on purpose:
  // the performance log is for whoever is diagnosing the app, and a visible
  // switch is one an operator turns on to see what it does and forgets.
  const taps = useRef<number[]>([]);
  const tapVersion = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((at) => now - at < 1500), now];
    if (taps.current.length < 3) return;
    taps.current = [];
    setPerfLog(!perfOn);
    setPerfNote(null);
  };

  const sharePerf = async () => {
    const file = latestPerfFile();
    if (!file) return setPerfNote(NOTHING_YET);
    try {
      const { text, trimmed } = await perfShareText(file);
      await Share.share({ title: file.name, message: text });
      setPerfNote(
        trimmed
          ? `${file.name} is too long for one message, so the newest rows were sent. ` +
              "Open the file for all of it."
          : null,
      );
    } catch (caught) {
      setPerfNote(`Could not share ${file.name}: ${messageOf(caught)}`);
    }
  };

  // The whole file, for a day too long to send as a message: a viewer or Drive
  // can open it from a content link, and send it on from there.
  const openPerf = async () => {
    const file = latestPerfFile();
    if (!file) return setPerfNote(NOTHING_YET);
    try {
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: file.contentUri,
        type: "text/csv",
        flags: FLAG_GRANT_READ_URI_PERMISSION,
      });
    } catch (caught) {
      setPerfNote(`Nothing on this phone would open ${file.name}: ${messageOf(caught)}`);
    }
  };

  const turnPerfOff = () => {
    setPerfLog(false);
    setPerfNote(null);
  };

  return (
    <Page title="About">
      <Group>
        <ReadoutRow label="App" value={Constants.expoConfig?.name ?? "Long Take"} />
        <Pressable
          // Not announced as a button: it is still a readout to everyone who
          // is not looking for the performance log.
          onPress={tapVersion}
          className="active:opacity-60"
        >
          <ReadoutRow label="Version" value={version()} />
        </Pressable>
        <ReadoutRow label="Encoder" value="RootEncoder 2.7.0" />
        <ReadoutRow label="Video" value={codec === "h265" ? "H.265" : "H.264"} />
        <ReadoutRow label="Protocols" value="RTMP · SRT" />
      </Group>

      {perfOn ? (
        <Group
          title="Diagnostics"
          footer={
            perfNote ??
            "A line every ten seconds - temperature, battery, frame rates and the stream - to " +
              "one file per day on this phone. Send it to whoever asked for it after the class."
          }
        >
          <ReadoutRow label="Performance log" value="on" />
          <NavRow
            label="Share performance log"
            detail="Today's file, or the latest one"
            onPress={() => void sharePerf()}
          />
          <NavRow
            label="Open performance log file"
            detail="The whole file, in another app"
            onPress={() => void openPerf()}
          />
          <NavRow label="Turn off performance log" onPress={turnPerfOff} />
        </Group>
      ) : null}

      <Text className="px-1 text-sm text-muted-foreground">
        Long Take sends the camera and the microphone on this phone to a server you run yourself,
        over RTMP or SRT, and can keep a copy on the phone while it does. There is no account
        behind it: a destination is paired by scanning a code on your own dashboard, and the stream
        key that comes with it stays on this device.
      </Text>

      <Text className="px-1 text-xs text-muted-foreground">
        The theme follows the phone. The viewfinder is always dark - a bright screen behind a
        camera is a light source pointed at whatever you are filming.
      </Text>
    </Page>
  );
}

const NOTHING_YET =
  "Nothing recorded yet. The first line is written ten seconds after it is turned on.";

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/** Android's Intent.FLAG_GRANT_READ_URI_PERMISSION: the viewer may read the link. */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * `1.0.0 (14)` - the version an operator will quote and the build number that
 * identifies which one of it they have. Android's version code is the only
 * half that is unique per upload, and a store build always carries one; when
 * it is missing the version stands alone rather than being padded with a
 * figure nobody checked.
 */
function version(): string {
  const name = Constants.expoConfig?.version;
  const build = Constants.expoConfig?.android?.versionCode;
  if (!name) return build ? `build ${build}` : "unknown";
  return build ? `${name} (${build})` : name;
}

import Constants from "expo-constants";
import { useState } from "react";

import { Group, Page, ReadoutRow } from "@/components/settings/chrome";
import { Text } from "@/components/ui/text";
import { loadSettings } from "@/lib/broadcast/settings";

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

  return (
    <Page title="About">
      <Group>
        <ReadoutRow label="App" value={Constants.expoConfig?.name ?? "Framevane"} />
        <ReadoutRow label="Version" value={version()} />
        <ReadoutRow label="Encoder" value="RootEncoder 2.7.0" />
        <ReadoutRow label="Video" value={codec === "h265" ? "H.265" : "H.264"} />
        <ReadoutRow label="Protocols" value="RTMP · SRT" />
      </Group>

      <Text className="px-1 text-sm text-muted-foreground">
        Framevane sends the camera and the microphone on this phone to a server you run yourself,
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

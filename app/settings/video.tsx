import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";
import { View } from "react-native";

import { ChoiceRow, Group, Page, SwitchRow } from "@/components/settings/chrome";
import {
  CODEC_LABEL,
  codecOptions,
  codecSupport,
  listCodecs,
  supports,
} from "@/components/settings/phone";
import { Text } from "@/components/ui/text";
import { loadSettings, type PhoneEncoderSettings, saveSettings } from "@/lib/broadcast/settings";

/**
 * How the picture is encoded, which is a fact about this handset rather than
 * about any destination - picture size and bitrate are set per destination,
 * where a YouTube stream and a test server can differ.
 *
 * Everything here takes effect at the next broadcast. Reconfiguring an encoder
 * takes the camera down, and doing that from a settings screen while the phone
 * is on air is a surprise nobody should get.
 */
export default function VideoSettingsScreen() {
  const [settings, setSettings] = useState<PhoneEncoderSettings>(() => loadSettings());
  const [codecs, setCodecs] = useState(() => codecSupport());

  const update = (patch: Partial<PhoneEncoderSettings>) => setSettings(saveSettings(patch));

  /**
   * The encoder only knows what this phone can do once a capture session
   * exists, so the list is re-read every time this screen comes up rather than
   * once at mount - a phone that has since opened the viewfinder has an answer
   * now where it had none before.
   */
  useFocusEffect(
    useCallback(() => {
      setCodecs(codecSupport());
    }, []),
  );

  return (
    <Page title="Video" intro="Applied the next time you go live.">
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

      {/* The shape of the broadcast is set from the viewfinder, where the
          operator can see what it does to the picture; saying so here is
          cheaper than an operator hunting for it in Settings. */}
      <View className="px-1">
        <Text className="text-xs text-muted-foreground">
          Picture size, frame rate and bitrate belong to the destination and are set on
          Destinations. Portrait or landscape is set from the viewfinder, under Shape.
        </Text>
      </View>
    </Page>
  );
}

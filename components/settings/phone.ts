import { activeConnection, listConnections } from "@/lib/broadcast/connections";
import { FRAMEVANE_WEB } from "@/lib/product";
import { pushLog } from "@/lib/broadcast/log";
import * as Broadcaster from "@/modules/framevane-broadcaster";
import type {
  AudioDevice,
  CodecSupport,
  RecordingFile,
  VideoCodec,
} from "@/modules/framevane-broadcaster";

/**
 * What this phone, its encoder and its destinations will tell the settings
 * screens about themselves.
 *
 * Every read here is one the encoder can refuse. It only knows what the
 * hardware accepts once a capture session exists, so before the viewfinder has
 * been opened - which is exactly where an operator setting up a new phone
 * starts - the truthful answer to most of these is "nothing yet", and each of
 * them says so by returning an empty list rather than throwing into a screen.
 */

export function audioDevices(): AudioDevice[] {
  try {
    return Broadcaster.audioDevices();
  } catch {
    return [];
  }
}

export function codecSupport(): CodecSupport[] {
  try {
    return Broadcaster.supportedCodecs();
  } catch {
    return [];
  }
}

/**
 * The takes on the phone, or an empty list if the read itself failed.
 *
 * The failure is logged rather than swallowed. An empty list drawn after a
 * read that never happened is the app saying the operator's recordings are
 * gone - which is exactly what it said, once, when this reached the disk
 * through the camera preview and the preview was not mounted on this screen.
 */
export function recordingsOnPhone(): RecordingFile[] {
  try {
    return Broadcaster.recordings();
  } catch (error) {
    pushLog({
      at: Date.now(),
      level: "error",
      message: `Could not read the recordings: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return [];
  }
}

export const CODEC_LABEL: Record<VideoCodec, string> = {
  h264: "H.264",
  h265: "H.265",
  av1: "AV1",
};

/** Always this order, whatever order the phone happens to report them in. */
const CODEC_ORDER: VideoCodec[] = ["h264", "h265", "av1"];

function sortCodecs(codecs: CodecSupport[]): CodecSupport[] {
  return [...codecs].sort((a, b) => CODEC_ORDER.indexOf(a.codec) - CODEC_ORDER.indexOf(b.codec));
}

export function supports(codecs: CodecSupport[], codec: VideoCodec): boolean {
  return codecs.some((support) => support.codec === codec);
}

/**
 * Offer what the phone says it can do and nothing else - an H.265 chip on a
 * handset that cannot encode it is a trap that springs at the worst possible
 * moment. When the phone has reported nothing, H.264 stands alone because
 * every Android encoder does it, and whatever was already chosen stays
 * selectable rather than disappearing under the operator.
 */
export function codecOptions(
  codecs: CodecSupport[],
  current: VideoCodec,
): { label: string; value: VideoCodec }[] {
  if (codecs.length === 0) {
    const fallback: VideoCodec[] = current === "h264" ? ["h264"] : ["h264", current];
    return fallback.map((codec) => ({ label: CODEC_LABEL[codec], value: codec }));
  }
  return sortCodecs(codecs).map((support) => ({
    label: CODEC_LABEL[support.codec],
    value: support.codec,
  }));
}

/** "H.264 on the hardware and H.265 in software". */
export function listCodecs(codecs: CodecSupport[]): string {
  const parts = sortCodecs(codecs).map(
    (support) =>
      `${CODEC_LABEL[support.codec]} ${support.hardware ? "on the hardware" : "in software"}`,
  );
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function totalBytes(recordings: RecordingFile[]): number {
  return recordings.reduce((sum, recording) => sum + recording.bytes, 0);
}

export const KIND: Record<AudioDevice["kind"], string> = {
  builtin: "",
  wired: "wired",
  bluetooth: "Bluetooth",
  usb: "USB",
  other: "",
};

/** The device as it is written in a list, with what it is plugged in by. */
export function deviceLabel(device: AudioDevice): string {
  return `${device.name}${KIND[device.kind] ? ` · ${KIND[device.kind]}` : ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `12 Sep, 18:04` - the day and the time, which is how a recording is found again. */
export function stamp(at: number): string {
  const when = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${when.getDate()} ${MONTHS[when.getMonth()]}, ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * Where this phone's copy of Framevane lives on the web.
 *
 * The privacy policy and the terms are pages on the dashboard, and Framevane
 * is self-hosted - so the ones that govern this operator are the ones on the
 * server they paired with, not ours. That address arrives in the pairing QR
 * code as `api` and is kept on the destination, so it is read back from there:
 * the destination being sent to first, then any other that carries one, for a
 * phone whose current destination was typed in by hand.
 *
 * The public site is the fallback and not the default. It is the right answer
 * for a phone that has never been paired - a fresh install on the shop floor,
 * where somebody still has to be able to read the policy before agreeing to
 * anything - and the wrong one for a paired phone, whose own server publishes
 * both pages at the same paths.
 */
const PUBLIC_SITE = FRAMEVANE_WEB;

export function dashboardSite(): string {
  const paired = activeConnection()?.api ?? listConnections().find((c) => c.api)?.api;
  return (paired ?? PUBLIC_SITE).replace(/\/+$/, "");
}

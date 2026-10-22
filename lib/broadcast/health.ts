import Constants from "expo-constants";

import { scrub } from "@/lib/scrub";
import type { BroadcastStats } from "@/modules/framevane-broadcaster";

/**
 * What the phone tells the studio about itself while it is live.
 *
 * The studio could see what the compositor receives and nothing about the
 * handset producing it, so a class that went wrong was diagnosed from a
 * screenshot of whichever screen the operator happened to be on. These are the
 * few numbers that explain most failures: whether the phone is hot, whether its
 * battery is going, and whether the picture it is sending is the one it was
 * asked for.
 *
 * Nothing here can identify anything but the phone: no stream URL, no key, no
 * name. The studio authenticates the report by the control token it arrives with.
 */
export type HealthReport = {
  v: 1;
  state: string;
  thermal: number;
  /** Not read until the thermal governor lands; the studio accepts null. */
  headroom: number | null;
  battery: { level: number; charging: boolean };
  fps: number;
  fpsTarget: number;
  bitrate: number;
  congested: boolean;
  droppedVideo: number;
  droppedAudio: number;
  queueItems: number;
  queueCapacity: number;
  width: number;
  height: number;
  codec: string;
  recording: boolean;
  network: "wifi" | "cellular" | "other" | "none" | null;
  appVersion: string;
  appBuild: number;
  /**
   * Reconnect attempts this broadcast, and the reason for the last drop. The
   * studio scrubs the reason again on arrival; it is scrubbed here as well
   * because a report is a request body, and request bodies end up in proxy
   * logs this app has never seen.
   */
  reconnects: number;
  lastDrop: string;
};

export type HealthInput = {
  state: string;
  thermal: number;
  charge: { level: number; charging: boolean };
  stats: BroadcastStats | null;
  reconnects: number;
  lastDrop: string;
};

export function buildHealthReport(input: HealthInput): HealthReport {
  const { stats, charge } = input;
  const android = Constants.expoConfig?.android as { versionCode?: number } | undefined;
  return {
    v: 1,
    state: input.state,
    thermal: input.thermal,
    headroom: null,
    battery: { level: charge.level, charging: charge.charging },
    fps: stats?.measuredFps ?? 0,
    fpsTarget: stats?.fps ?? 0,
    bitrate: stats?.bitrate ?? 0,
    congested: stats?.congested ?? false,
    droppedVideo: stats?.droppedVideoFrames ?? 0,
    droppedAudio: stats?.droppedAudioFrames ?? 0,
    queueItems: stats?.queueItems ?? 0,
    queueCapacity: stats?.queueCapacity ?? 0,
    width: stats?.width ?? 0,
    height: stats?.height ?? 0,
    codec: String(stats?.codec ?? ""),
    recording: stats?.recording ?? false,
    network: null,
    appVersion: Constants.expoConfig?.version ?? "unknown",
    appBuild: android?.versionCode ?? 0,
    reconnects: Math.max(0, Math.floor(input.reconnects)),
    // The studio keeps 120 characters; cut after scrubbing, so a key is never
    // half-redacted by a cut that landed inside it.
    lastDrop: scrub(input.lastDrop).slice(0, 120),
  };
}

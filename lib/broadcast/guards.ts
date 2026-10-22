/**
 * The readings the app takes on the operator's behalf, and the one thing it
 * says about them.
 *
 * Three conditions end a real event - the phone getting hot, the disk filling,
 * the battery going - and all three are invisible in the picture until it is
 * too late to act. The readings come from the phone; the judgement is here,
 * because thresholds are a product decision that will be argued about and a
 * reading is not.
 *
 * Everything in this file is pure. That is deliberate: it is the only part of
 * this work that can be checked without a phone in your hand, and the ranking
 * rule below - which warning wins when two conditions are true at once - is
 * exactly the sort of thing that is cheap to assert and expensive to find by
 * hand at an event.
 */

import { t } from "../i18n/translate.ts";

/** One gigabyte, written once so the thresholds below read as sizes. */
const GB = 1024 * 1024 * 1024;

/**
 * Refuse to start a recording below this. Two gigabytes is about twelve
 * minutes at the highest bitrate this app offers, and a take that cannot last
 * a quarter of an hour is not a take.
 */
export const MIN_FREE = 2 * GB;

/** Warn from here down. */
export const LOW_FREE = 1 * GB;

/**
 * Stop the recording at this much left, *plus* whatever the take has grown to.
 *
 * The addition is the part that is easy to miss: a finished take is copied
 * into the phone's video library before the original is deleted, so closing a
 * 4 GB recording needs 4 GB free, not zero. Without it the take completes and
 * then cannot be published - and that failure lands after the event, which is
 * the worst possible time to learn about it.
 */
export const STOP_FREE = 400 * 1024 * 1024;

/** Warn here. The phone is still perfectly able to broadcast. */
export const LOW_BATTERY = 0.15;

/**
 * Close any recording here. A file the muxer never finished plays nowhere, and
 * a phone at five percent under a video encoder does not have long. The
 * broadcast itself is left alone: ending it is the operator's decision, and a
 * phone that ends a paid stream by itself is worse than a phone that dies.
 */
export const CRITICAL_BATTERY = 0.05;

/**
 * Android's thermal scale: 0 none, 1 light, 2 moderate, 3 severe, 4 critical.
 *
 * `moderate` was the threshold and it was wrong in the field. Plenty of phones
 * - Chinese ROMs especially - sit at moderate from the moment the screen comes
 * on, so the warning appeared the second the app opened and stayed for a
 * whole hour's broadcast on a phone that was not hot. A warning that is always
 * on is not a warning, and this one covered the picture.
 *
 * So: severe, which is the system saying it is throttling rather than that it
 * might; and critical for the one that says to act now. A phone that sits at
 * moderate says nothing, which costs the few seconds of notice moderate would
 * have given on the phones where it means something - and buys a warning that
 * is worth reading when it does appear.
 */
export const THERMAL_WARN = 3;
export const THERMAL_BAD = 4;

export type Conditions = {
  /** Android's thermal status, or -1 on a phone that cannot say. */
  thermal: number;
  usableBytes: number;
  battery: number;
  charging: boolean;
  /** Bits per second the recorder is writing, for the minutes-left estimate. */
  recordingBitrate: number;
  /** Bytes the current take has grown to, or 0 when nothing is recording. */
  takeBytes: number;
  recording: boolean;
  /** On air. Nothing is being encoded off air, whatever the phone's temperature. */
  live: boolean;
};

export type Guard = {
  id: "thermal" | "storage" | "battery";
  tone: "warn" | "bad";
  text: string;
  /** What the app is about to do by itself, if anything. Said before doing it. */
  action?: "stopRecording";
};

/**
 * At most one, ranked.
 *
 * Two banners over a viewfinder is the same as none - the operator reads
 * neither and the picture is covered twice. So the conditions are ranked by
 * how soon they end the broadcast if ignored, and the winner is the only one
 * drawn. The rest are in the log, which is where a second fact belongs.
 */
export function guardFor(conditions: Conditions): Guard | null {
  const { thermal, usableBytes, battery, charging, recording, takeBytes } = conditions;

  // First, because it is the only one with a deadline measured in seconds and
  // the only one where the app acts rather than asks.
  if (!charging && battery <= CRITICAL_BATTERY) {
    return {
      id: "battery",
      tone: "bad",
      text: recording ? t("guard.batteryClosing") : t("guard.batteryGone"),
      action: recording ? "stopRecording" : undefined,
    };
  }

  // Second: a full disk ends the take outright, and unlike heat it does not
  // recover on its own.
  if (recording && usableBytes <= STOP_FREE + takeBytes) {
    return {
      id: "storage",
      tone: "bad",
      text: t("guard.storageClosing"),
      action: "stopRecording",
    };
  }

  /**
   * Heat is only news while something is being encoded.
   *
   * A phone on charge in a warm room reports itself hot with the app merely
   * open, and "the encoder is being throttled" is then simply false - there is
   * no encoder running to throttle. It was the first thing on screen at
   * launch and it stayed there through a whole broadcast, which is how a
   * warning becomes wallpaper.
   */
  const encoding = recording || conditions.live;

  if (encoding && thermal >= THERMAL_BAD) {
    return {
      id: "thermal",
      tone: "bad",
      text: t("guard.tooHot"),
    };
  }

  if (recording && usableBytes <= LOW_FREE) {
    /**
     * Minutes only when there is a bitrate to divide by. With no destination
     * chosen and the recorder following the broadcast there is nothing to
     * estimate from, and "about no more of recording left" - which is what the
     * arithmetic produced - is worse than saying plainly that the phone is
     * nearly full.
     */
    const left = conditions.recordingBitrate > 0 ? minutesLeft(conditions) : null;
    return {
      id: "storage",
      tone: "warn",
      text: left ? t("guard.minutesLeft", { left }) : t("guard.nearlyFull"),
    };
  }

  if (encoding && thermal >= THERMAL_WARN) {
    return {
      id: "thermal",
      tone: "warn",
      text: t("guard.gettingHot"),
    };
  }

  if (!charging && battery <= LOW_BATTERY) {
    return {
      id: "battery",
      tone: "warn",
      text: t("guard.battery", { percent: Math.round(battery * 100) }),
    };
  }

  return null;
}

/**
 * The same readings, asked before going live rather than during.
 *
 * `guardFor` answers "what is wrong now", and off air its answer is mostly
 * nothing: heat is not news without an encoder running, and storage only
 * matters to a take that exists. But the check before going live is asking a
 * different question - "is this phone fit to start" - and a phone already at
 * severe before the first frame, or one with no room for the recording the
 * operator has asked for, is exactly what that check is for. The operator was
 * learning both a minute into the class, from a banner over the picture.
 *
 * Every line rather than the winner: the check is a panel the operator is
 * reading, not a banner over a shot, and there is room in it for two facts.
 * Ranked the same way, so the worst is first.
 */
export function preflightGuards({
  thermal,
  usableBytes,
  battery,
  charging,
  willRecord,
}: Pick<Conditions, "thermal" | "usableBytes" | "battery" | "charging"> & {
  /** Recording on this phone is set to start with the broadcast. */
  willRecord: boolean;
}): Guard[] {
  const lines: Guard[] = [];

  if (!charging && battery <= CRITICAL_BATTERY) {
    lines.push({
      id: "battery",
      tone: "bad",
      text: t("guard.preBatteryGone"),
    });
  }

  // Zero is a phone that did not answer, not a full disk - the same reading
  // `toggleRecording` declines to refuse on.
  if (willRecord && usableBytes > 0 && !canStartRecording(usableBytes)) {
    lines.push({
      id: "storage",
      tone: "bad",
      text: t("guard.preStorage", { room: tooLittleRoom(usableBytes) }),
    });
  }

  if (thermal >= THERMAL_BAD) {
    lines.push({
      id: "thermal",
      tone: "bad",
      text: t("guard.preTooHot"),
    });
  } else if (thermal >= THERMAL_WARN) {
    lines.push({
      id: "thermal",
      tone: "warn",
      text: t("guard.preWarm"),
    });
  }

  if (!charging && battery > CRITICAL_BATTERY && battery <= LOW_BATTERY) {
    lines.push({
      id: "battery",
      tone: "warn",
      text: t("guard.preBattery", { percent: Math.round(battery * 100) }),
    });
  }

  return lines;
}

/**
 * Minutes, not bytes.
 *
 * "1.1 GB free" is a number an operator has to do arithmetic on while holding
 * a camera. Minutes is the same fact in the unit the decision is actually made
 * in. The estimate is the honest one: what is left after the floor the
 * recorder will stop at, divided by what the recorder is actually writing.
 */
export function minutesLeft({
  usableBytes,
  recordingBitrate,
  takeBytes,
}: Pick<Conditions, "usableBytes" | "recordingBitrate" | "takeBytes">): string {
  const spare = usableBytes - STOP_FREE - takeBytes;
  const bytesPerSecond = recordingBitrate / 8;
  if (spare <= 0 || bytesPerSecond <= 0) return t("guard.noMore");
  const minutes = Math.floor(spare / bytesPerSecond / 60);
  if (minutes < 1) return t("guard.underAMinute");
  if (minutes === 1) return t("guard.aMinute");
  return t("guard.minutes", { n: minutes });
}

/** Whether a recording should be allowed to start at all. */
export function canStartRecording(usableBytes: number): boolean {
  return usableBytes >= MIN_FREE;
}

/** The refusal, in the words it is shown in. */
export function tooLittleRoom(usableBytes: number): string {
  return t("guard.tooLittleRoom", {
    free: formatGigabytes(usableBytes),
    needed: formatGigabytes(MIN_FREE),
  });
}

function formatGigabytes(bytes: number): string {
  const gb = bytes / GB;
  if (gb < 0.1) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${gb.toFixed(1)} GB`;
}

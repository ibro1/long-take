import { Directory, File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";

import { storage } from "@/lib/storage";

/**
 * A performance log the operator can turn on for one class and send back.
 *
 * It exists because a JS thread that saturated during an hour-long broadcast
 * could not be reproduced on a desk, and guesses about why were all we had.
 * This records the numbers from the release build on the real phone in the
 * real hall, one line every ten seconds, and costs nothing while it is off.
 *
 * Hidden on purpose: it is turned on by tapping the version three times in
 * About, because it is a tool for whoever is diagnosing the app, not a setting
 * an operator should wonder about.
 */

const SWITCH_KEY = "diagnostics.perf";

export const PERF_COLUMNS = [
  "iso_time",
  "thermal",
  "battery_level",
  "charging",
  "js_fps",
  "ui_fps",
  "js_heap_mb",
  "encoder_fps",
  "dropped",
  "bitrate_kbps",
  "live",
  "app_state",
] as const;

export type PerfRow = Record<(typeof PERF_COLUMNS)[number], string>;

const HEADER = `${PERF_COLUMNS.join(",")}\n`;

/** Named for the day it covers, so a class is one file and a week is seven. */
const FILE_PATTERN = /^perf-\d{4}-\d{2}-\d{2}\.csv$/;

export function perfLogOn(): boolean {
  return storage.getBoolean(SWITCH_KEY) ?? false;
}

export function setPerfLog(on: boolean): void {
  storage.set(SWITCH_KEY, on);
}

function subscribePerfLog(fn: () => void): () => void {
  const listener = storage.addOnValueChangedListener((key) => {
    if (key === SWITCH_KEY) fn();
  });
  return () => listener.remove();
}

/** The switch, live: About flips it and the probe starts or stops with it. */
export function usePerfLog(): boolean {
  return useSyncExternalStore(subscribePerfLog, perfLogOn);
}

/** Local date, because the operator thinks of "today's class", not UTC's. */
function dayOf(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

function fileFor(at: Date): File {
  return new File(Paths.document, `perf-${dayOf(at)}.csv`);
}

/**
 * Every value is a number, an ISO time or a short word, so a byte per char is
 * exact - and it avoids leaning on TextEncoder for something this small.
 */
function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0x7f;
  return bytes;
}

/**
 * One row on the end of today's file, with the header when the file is new.
 *
 * Appended through a handle rather than read and rewritten: a day of rows is
 * hundreds of kilobytes, and rewriting it every ten seconds would be the probe
 * becoming the load it is there to measure.
 */
export function appendPerfRow(row: PerfRow): void {
  const line = `${PERF_COLUMNS.map((column) => row[column]).join(",")}\n`;
  const file = fileFor(new Date(row.iso_time));
  if (!file.exists) {
    file.write(HEADER + line);
    return;
  }
  const handle = file.open();
  try {
    handle.offset = handle.size ?? file.size;
    handle.writeBytes(ascii(line));
  } finally {
    handle.close();
  }
}

/** Today's file if there is one, else the most recent day that has one. */
export function latestPerfFile(): File | null {
  try {
    const today = fileFor(new Date());
    if (today.exists) return today;
    const files = new Directory(Paths.document)
      .list()
      .filter((entry): entry is File => entry instanceof File && FILE_PATTERN.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name));
    return files[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Small enough to go through a share sheet as text - Android refuses an intent
 * much over half a megabyte, and WhatsApp cuts a message at about 65,000
 * characters. An hour of rows is about 30,000, so a class fits whole.
 */
const SHARE_LIMIT = 60_000;

/**
 * The file's text for sharing: whole when it fits, otherwise the header and
 * the newest rows that do. The newest are kept because the class being asked
 * about is almost always the last thing recorded.
 */
export async function perfShareText(file: File): Promise<{ text: string; trimmed: boolean }> {
  const text = await file.text();
  if (text.length <= SHARE_LIMIT) return { text, trimmed: false };
  const tail = text.slice(text.length - (SHARE_LIMIT - HEADER.length));
  // Drop the partial row the cut landed in.
  const rows = tail.slice(tail.indexOf("\n") + 1);
  return { text: HEADER + rows, trimmed: true };
}

import type { HealthReport } from "./health";
import { type StudioStatus, studioStatusFrom } from "./studio-status.ts";
import type { Connection } from "./types";

/**
 * Pushing a saved overlay from the phone.
 *
 * The phone applies presets and takes them down again. It does not write them:
 * typing a lower third on a phone while filming is the thing nobody wants to
 * do, the dashboard already has a full editor for it, and captions are the
 * server's own business - they come from transcription and never touch this
 * file. So the whole client is three verbs against a studio that already knows
 * what the overlays say.
 *
 * Everything here answers rather than throws. This runs from a viewfinder that
 * is often mid-broadcast on a phone uplink, where a failed request is an
 * ordinary Tuesday: an operator who has walked behind a wall must get a line of
 * text, not a red screen and not a spinner that never ends.
 */

/** A saved overlay, by the name the operator gave it in the dashboard. */
export type OverlayPreset = { id: string; name: string };

/**
 * What a destination needs before overlays mean anything: the dashboard it
 * belongs to, and a token for that dashboard's control routes.
 *
 * The token is deliberately not the stream key. It is issued per stream and
 * revoked on its own, so a phone that is lost can be shut out of the overlays
 * without changing the key and re-pairing every other phone.
 */
export type ControlChannel = { api: string; token: string };

export type ControlResult<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Long enough for a round trip while the uplink is already carrying video,
 * short enough that a studio which has gone away is reported as gone rather
 * than left spinning behind a panel the operator is waiting on.
 */
const TIMEOUT_MS = 6000;

/**
 * Whether this destination goes through Framevane at all.
 *
 * A destination without the pair points at some other RTMP server - a
 * platform's own ingest, someone else's MediaMTX - where there is no
 * compositor and no such thing as an overlay. The two travel together or not
 * at all: a base URL with no token cannot be authenticated and a token with no
 * base has nowhere to go, so half of one is the same as neither.
 */
export function controlChannelFor(connection: Connection | null | undefined): ControlChannel | null {
  if (!connection?.api || !connection.controlToken) return null;
  return { api: connection.api, token: connection.controlToken };
}

export function canPushOverlays(connection: Connection | null | undefined): boolean {
  return controlChannelFor(connection) !== null;
}

/**
 * What this phone last pushed, and nothing more.
 *
 * The studio is not asked what is on screen, because the contract has no way
 * of telling us - and a dashboard operator, another phone, or an expiring hold
 * can all change it without this phone hearing. Kept here rather than in the
 * panel's own state so that closing the panel and opening it again does not
 * lose the one piece of history the phone genuinely has, and dropped on a cold
 * start along with every other claim about a broadcast that has since ended.
 */
const pushedFromHere = new Map<string, string | null>();

export function lastPushedFromHere(connectionId: string): string | null {
  return pushedFromHere.get(connectionId) ?? null;
}

/**
 * The presets this stream has, freshly.
 *
 * Never cached across opens: presets are made and deleted in the dashboard
 * while the phone is filming, and a stale list is how a tap pushes the wrong
 * name to an audience.
 */
export async function listPresets(connection: Connection): Promise<ControlResult<OverlayPreset[]>> {
  const result = await request(connection, "GET", "/api/control/presets");
  if (!result.ok) return result;

  const presets = presetsFrom(result.value);
  if (!presets) {
    return { ok: false, message: "The studio sent back something this app cannot read." };
  }
  return { ok: true, value: presets };
}

export async function applyPreset(
  connection: Connection,
  presetId: string,
): Promise<ControlResult<null>> {
  const result = await request(connection, "POST", "/api/control/preset", { presetId });
  if (result.ok) pushedFromHere.set(connection.id, presetId);
  return result.ok ? { ok: true, value: null } : result;
}

export type Visibility = "private" | "unlisted" | "public";

export type WhoCanWatch = {
  visibility: Visibility;
  /**
   * Destinations this setting will not reach, by name.
   *
   * Framevane carries it on the API call that creates the broadcast, so it only
   * lands on a YouTube channel or Facebook Page connected over OAuth. A pasted
   * stream key has no object to set privacy on and the platform's own default
   * decides. Naming them is the difference between a control that works and a
   * control that appears to.
   */
  ignoredBy: string[];
};

const VISIBILITIES: Visibility[] = ["private", "unlisted", "public"];

function whoCanWatchFrom(value: unknown): WhoCanWatch | null {
  if (!value || typeof value !== "object") return null;
  const visibility = (value as { visibility?: unknown }).visibility;
  if (typeof visibility !== "string" || !VISIBILITIES.includes(visibility as Visibility)) {
    return null;
  }
  const ignoredBy = (value as { ignoredBy?: unknown }).ignoredBy;
  return {
    visibility: visibility as Visibility,
    ignoredBy: Array.isArray(ignoredBy) ? ignoredBy.filter((n): n is string => typeof n === "string") : [],
  };
}

/**
 * Who can watch this stream, as the dashboard currently has it.
 *
 * Read rather than remembered, because it is a property of the stream and the
 * studio can change it while the phone is in a pocket. A remembered copy would
 * let the app show "Private" over a broadcast that had been made public from a
 * laptop.
 */
export async function getWhoCanWatch(
  connection: Connection,
): Promise<ControlResult<WhoCanWatch>> {
  const result = await request(connection, "GET", "/api/control/visibility");
  if (!result.ok) return result;

  const parsed = whoCanWatchFrom(result.value);
  if (!parsed) {
    return { ok: false, message: "The studio sent back something this app cannot read." };
  }
  return { ok: true, value: parsed };
}

export async function setWhoCanWatch(
  connection: Connection,
  visibility: Visibility,
): Promise<ControlResult<null>> {
  const result = await request(connection, "POST", "/api/control/visibility", { visibility });
  return result.ok ? { ok: true, value: null } : result;
}

/**
 * What the broadcast is called, as the studio has it.
 *
 * This is the stream's name in the studio, and the title YouTube and Facebook
 * are given when Framevane creates the broadcast. For a destination that goes
 * through Framevane it is also the destination's name on this phone - one name,
 * read from here and written back here - because two names that looked alike
 * and meant different things is how an hour went out under the wrong title.
 */
export async function getTitle(connection: Connection): Promise<ControlResult<string>> {
  const result = await request(connection, "GET", "/api/control/title");
  if (!result.ok) return result;
  const title = (result.value as { title?: unknown } | null)?.title;
  if (typeof title !== "string") {
    return { ok: false, message: "The studio sent back something this app cannot read." };
  }
  return { ok: true, value: title };
}

export async function setTitle(
  connection: Connection,
  title: string,
): Promise<ControlResult<string>> {
  const result = await request(connection, "POST", "/api/control/title", { title });
  if (!result.ok) return result;
  const saved = (result.value as { title?: unknown } | null)?.title;
  return { ok: true, value: typeof saved === "string" ? saved : title };
}

/**
 * The WhatsApp announcement, as the dashboard has it.
 *
 * `available` is whether the studio can send at all - it needs a sending
 * service configured - so the app can say why the switch is greyed out rather
 * than offering one that does nothing. `chats` comes from that service, not
 * from a list in here, so the two cannot drift.
 */
export type Announce = {
  available: boolean;
  chats: string[];
  announce: boolean;
  announceDelay: number;
  announceChats: string[];
  announceTeacher: string;
  announceSession: string;
  /** The exact line that would go out, built by the studio. */
  preview: string;
  /**
   * Whether the studio writes these or fills in a template, and whether the
   * preview above is a written one.
   *
   * Two flags rather than one because they fail differently and the operator
   * needs to tell them apart: `wording` off means nobody configured the
   * writer, `wording` on with `written` false means it was asked and has not
   * answered yet - or was asked and refused, and the template is what will go
   * out. A studio too old to report either leaves both false, which reads as
   * the template, which is what it sends.
   */
  wording: boolean;
  written: boolean;
};

function announceFrom(value: unknown): Announce | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.announce !== "boolean") return null;
  const strings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((v): v is string => typeof v === "string") : [];
  return {
    available: raw.available === true,
    chats: strings(raw.chats),
    announce: raw.announce,
    announceDelay: typeof raw.announceDelay === "number" ? raw.announceDelay : 0,
    announceChats: strings(raw.announceChats),
    announceTeacher: typeof raw.announceTeacher === "string" ? raw.announceTeacher : "",
    announceSession: typeof raw.announceSession === "string" ? raw.announceSession : "",
    preview: typeof raw.preview === "string" ? raw.preview : "",
    wording: raw.wording === true,
    written: raw.written === true,
  };
}

export async function getAnnounce(connection: Connection): Promise<ControlResult<Announce>> {
  const result = await request(connection, "GET", "/api/control/announce");
  if (!result.ok) return result;
  const parsed = announceFrom(result.value);
  if (!parsed) {
    return { ok: false, message: "The studio sent back something this app cannot read." };
  }
  return { ok: true, value: parsed };
}

/**
 * Changes one field or several. Only what is passed is written, so two phones
 * editing different fields do not overwrite each other, and the answer is the
 * whole setting as the studio now has it.
 */
export async function setAnnounce(
  connection: Connection,
  patch: Partial<
    Pick<Announce, "announce" | "announceDelay" | "announceChats" | "announceTeacher" | "announceSession">
  >,
): Promise<ControlResult<Announce>> {
  const result = await request(connection, "POST", "/api/control/announce", patch);
  if (!result.ok) return result;
  const parsed = announceFrom(result.value);
  if (!parsed) {
    return { ok: false, message: "The studio sent back something this app cannot read." };
  }
  return { ok: true, value: parsed };
}

/**
 * Forces the WhatsApp announcement to be sent immediately from the studio,
 * bypassing the 6-hour repeat lockout window.
 */
export async function sendAnnounceNow(
  connection: Connection,
): Promise<ControlResult<{ sentTo: string[] }>> {
  const result = await request(connection, "POST", "/api/control/announce", { action: "send" });
  if (!result.ok) return result;
  const val = result.value as { ok?: boolean; sentTo?: string[]; error?: string } | null;
  if (!val?.ok) {
    return { ok: false, message: val?.error ?? "Failed to send announcement." };
  }
  return { ok: true, value: { sentTo: Array.isArray(val.sentTo) ? val.sentTo.map(String) : [] } };
}

/**
 * Tells the studio the operator ended the lesson, rather than the phone having
 * dropped.
 *
 * The server cannot tell those apart - both are the publisher going away - so
 * it holds the run open for two minutes in case a lost connection comes back.
 * Right for a wall or a handover; wrong for a class that finished, where it
 * leaves a live event on the channel with a spinner on it.
 *
 * Sent after the encoder has stopped, never before: while this phone is still
 * publishing, ending the run just lets the ingest edge start another one.
 *
 * Best effort by design. The common reason for ending is the connection being
 * poor, so this request is the one most likely to fail - and when it does, the
 * two-minute grace closes the run exactly as it did before.
 */
export async function endBroadcast(connection: Connection): Promise<ControlResult<null>> {
  const result = await request(connection, "POST", "/api/control/end");
  return result.ok ? { ok: true, value: null } : result;
}

/**
 * The phone's report on itself, sent while live. Quiet by design: a failure
 * here is never shown to the operator, because a health report that fails must
 * not become one more thing to look at mid-class. The caller counts failures
 * and says so once in the log.
 */
export async function postHealth(
  connection: Connection,
  report: HealthReport,
): Promise<ControlResult<null>> {
  const result = await request(connection, "POST", "/api/control/health", report);
  return result.ok ? { ok: true, value: null } : result;
}

/**
 * Whether each platform behind the studio is on air, as the studio last heard.
 *
 * The one thing the phone cannot see for itself: its own connection can be
 * perfectly healthy while the YouTube event it feeds never went live. Quiet
 * like the health report - the caller polls it and a miss is simply the old
 * answer standing - and it carries no watch URL or id, only the state.
 */
export async function getStudioStatus(
  connection: Connection,
): Promise<ControlResult<StudioStatus>> {
  const result = await request(connection, "GET", "/api/control/status");
  if (!result.ok) return result;
  const parsed = studioStatusFrom(result.value);
  return parsed
    ? { ok: true, value: parsed }
    : { ok: false, message: "The studio sent back something this app cannot read." };
}

/** The recent log, on request, so the studio can read what the phone saw. */
export async function postPhoneLog(
  connection: Connection,
  lines: { at: number; level: string; message: string }[],
): Promise<ControlResult<null>> {
  const result = await request(connection, "POST", "/api/control/log", { lines });
  return result.ok ? { ok: true, value: null } : result;
}

/** One place the studio sends the picture. Never carries a key. */
export type StudioDestination = {
  id: string;
  name: string;
  platform: string;
  enabled: boolean;
  orientation: "landscape" | "portrait" | null;
};

function destinationsFrom(value: unknown): StudioDestination[] | null {
  const list = (value as { destinations?: unknown } | null)?.destinations;
  if (!Array.isArray(list)) return null;
  return list.flatMap((item) => {
    const row = item as Partial<StudioDestination>;
    return typeof row.id === "string" &&
      typeof row.name === "string" &&
      typeof row.platform === "string" &&
      typeof row.enabled === "boolean"
      ? [{
          id: row.id,
          name: row.name,
          platform: row.platform,
          enabled: row.enabled,
          orientation: row.orientation === "landscape" || row.orientation === "portrait"
            ? row.orientation
            : null,
        }]
      : [];
  });
}

/**
 * Where the studio fans the picture out to.
 *
 * The phone knows one destination - the studio - and the channels and Pages
 * behind it were only visible on the laptop.
 */
export async function getDestinations(
  connection: Connection,
): Promise<ControlResult<StudioDestination[]>> {
  const result = await request(connection, "GET", "/api/control/destinations");
  if (!result.ok) return result;
  const parsed = destinationsFrom(result.value);
  return parsed
    ? { ok: true, value: parsed }
    : { ok: false, message: "The studio sent back something this app cannot read." };
}

/**
 * Switches one on or off. Answers with the whole list as the studio stored it,
 * and the studio's own sentence about whether the running broadcast took the
 * change or it waits for the next one.
 *
 * The sentence is the studio's, not written here, because only the studio
 * knows whether its encoder could change destinations mid-broadcast - and
 * that changes with the server, not with this app. Null when there is nothing
 * to say, which is also what a studio too old to send one gives.
 */
export async function setDestinationEnabled(
  connection: Connection,
  destinationId: string,
  enabled: boolean,
): Promise<ControlResult<{ destinations: StudioDestination[]; message: string | null }>> {
  const result = await request(connection, "POST", "/api/control/destinations", {
    destinationId,
    enabled,
  });
  if (!result.ok) return result;
  const parsed = destinationsFrom(result.value);
  const message = (result.value as { message?: unknown } | null)?.message;
  return parsed
    ? {
        ok: true,
        value: { destinations: parsed, message: typeof message === "string" ? message : null },
      }
    : { ok: false, message: "The studio sent back something this app cannot read." };
}

export async function clearOverlays(connection: Connection): Promise<ControlResult<null>> {
  const result = await request(connection, "POST", "/api/control/clear");
  if (result.ok) pushedFromHere.set(connection.id, null);
  return result.ok ? { ok: true, value: null } : result;
}

/**
 * One request, one sentence back.
 *
 * The token goes in a header and nowhere else - never in a URL, never in a
 * message, never near a log line. This app mirrors its log to a development
 * server and operators screenshot that log when something goes wrong, so a
 * credential that reaches it has effectively been published. For the same
 * reason none of the messages below quote the thrown error or the server's own
 * body: both can carry the request back with them, and neither says anything
 * an operator holding a phone can act on. What they can act on is which end
 * went quiet, which is all these say.
 */
async function request(
  connection: Connection,
  method: "GET" | "POST",
  path: string,
  /**
   * Whatever the endpoint takes. It was strings only while every control was a
   * preset id or a visibility; the announcement has a switch, a number and a
   * list, and narrowing this to strings would only mean stringifying them here
   * and parsing them back on the server.
   */
  body?: Record<string, unknown>,
): Promise<ControlResult<unknown>> {
  const channel = controlChannelFor(connection);
  if (!channel) {
    return { ok: false, message: "This destination does not go through Framevane." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${channel.api}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${channel.token}`,
        /**
         * Which stream, for a destination that came with the account link.
         * Its token is the phone's and opens every stream on the account, so
         * on its own it does not say which one this is about; a stream-paired
         * token already does, and sends nothing extra.
         */
        ...(connection.studioStreamId ? { "X-Framevane-Stream": connection.studioStreamId } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) return { ok: false, message: describeStatus(response.status) };

    /**
     * Parsed whatever the method was.
     *
     * This used to hand POST callers a flat null, on the reasoning that the
     * two POSTs that existed answered with whatever they liked and nobody
     * read it. The announcement is a POST that answers with the whole setting
     * as the studio now has it - and the caller, reading null, reported it as
     * the studio sending back something the app could not read. The switch
     * looked broken while the server was doing exactly as it was asked.
     *
     * A body that is not JSON is null rather than a failure: the callers that
     * ignore it must keep working, and the ones that need it say so
     * themselves.
     */
    return { ok: true, value: await response.json().catch(() => null) };
  } catch {
    return {
      ok: false,
      message: controller.signal.aborted
        ? "The studio did not answer in time."
        : "The studio could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Plain facts, in the order they are worth telling apart. A refused token and
 * a dashboard too old to have these routes look identical from the viewfinder
 * otherwise, and they are fixed in completely different places - one by
 * pairing again, one by updating the dashboard.
 */
function describeStatus(status: number): string {
  if (status === 401 || status === 403) return "The studio refused this phone's overlay token.";
  if (status === 404) return "This studio has no overlay control at that address.";
  if (status >= 500) return "The studio failed to push it.";
  return `The studio answered ${status}.`;
}

/**
 * Trusted only as far as it parses. The list is drawn straight onto a
 * viewfinder and tapped without reading, so an entry with no id would be a
 * button that pushes nothing, and an unnamed preset falls back to its id
 * rather than becoming a blank row nobody can tell from its neighbours.
 */
// --- Destination orientation ---

export async function setDestinationOrientation(
  connection: Connection,
  destinationId: string,
  orientation: "landscape" | "portrait" | null,
): Promise<ControlResult<null>> {
  const result = await request(connection, "POST", "/api/control/destination-orientation", {
    destinationId,
    orientation,
  });
  return result.ok ? { ok: true, value: null } : result;
}

// --- Stream source settings ---

export type SourceSettings = {
  sourceType: "live" | "file";
  sourceFile: string | null;
  width: number;
  height: number;
};

function sourceSettingsFrom(value: unknown): SourceSettings | null {
  const obj = value as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") return null;
  const st = obj.sourceType;
  const sf = obj.sourceFile;
  const w = obj.width;
  const h = obj.height;
  if ((st !== "live" && st !== "file") || typeof w !== "number" || typeof h !== "number") {
    return null;
  }
  return {
    sourceType: st,
    sourceFile: typeof sf === "string" ? sf : null,
    width: w,
    height: h,
  };
}

export async function getSourceSettings(
  connection: Connection,
): Promise<ControlResult<SourceSettings>> {
  const result = await request(connection, "GET", "/api/control/source");
  if (!result.ok) return result;
  const parsed = sourceSettingsFrom(result.value);
  return parsed
    ? { ok: true, value: parsed }
    : { ok: false, message: "The studio sent back something this app cannot read." };
}

export async function setSourceSettings(
  connection: Connection,
  patch: { sourceType?: "live" | "file"; orientation?: "landscape" | "portrait" },
): Promise<ControlResult<SourceSettings>> {
  const result = await request(connection, "POST", "/api/control/source", patch);
  if (!result.ok) return result;
  const parsed = sourceSettingsFrom(result.value);
  return parsed
    ? { ok: true, value: parsed }
    : { ok: false, message: "The studio sent back something this app cannot read." };
}

export async function uploadSourceVideo(
  connection: Connection,
  fileId: string,
  base64: string,
): Promise<ControlResult<{ bytes: number }>> {
  const channel = controlChannelFor(connection);
  if (!channel) {
    return { ok: false, message: "This destination does not go through Framevane." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const response = await fetch(`${channel.api}/api/control/source-upload`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${channel.token}`,
        "Content-Type": "application/octet-stream",
        "X-File-Id": fileId,
        ...(connection.studioStreamId ? { "X-Framevane-Stream": connection.studioStreamId } : {}),
      },
      body: base64ToArrayBuffer(base64),
    });

    if (!response.ok) return { ok: false, message: describeStatus(response.status) };
    const payload = await response.json().catch(() => null);
    const bytes = (payload as { bytes?: unknown } | null)?.bytes;
    return { ok: true, value: { bytes: typeof bytes === "number" ? bytes : 0 } };
  } catch {
    return {
      ok: false,
      message: controller.signal.aborted
        ? "The upload did not finish in time."
        : "The studio could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function controlFileLoop(
  connection: Connection,
  action: "start" | "stop",
): Promise<ControlResult<null>> {
  const result = await request(connection, "POST", "/api/control/source-loop", { action });
  return result.ok ? { ok: true, value: null } : result;
}

function presetsFrom(value: unknown): OverlayPreset[] | null {
  if (typeof value !== "object" || value === null) return null;
  const list = (value as { presets?: unknown }).presets;
  if (!Array.isArray(list)) return null;

  const presets: OverlayPreset[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || !id) continue;
    presets.push({ id, name: typeof name === "string" && name.trim() ? name.trim() : id });
  }
  return presets;
}

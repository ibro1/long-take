import { DEFAULT_SETTINGS, bitsPerSecond, nameFromServer, protocolFor } from "./pairing.ts";
import type { AccountLink, Connection } from "./types";

/**
 * The phone's copy of the studio's stream list.
 *
 * Before this, each Framevane destination on the phone was paired from one
 * stream's code and lived its own life: the phone showed three of the
 * owner's five streams, and a rename on one side never reached the other. A
 * linked phone instead holds one credential for the account and asks the
 * studio for the list, so the two are one list with the studio as its owner.
 *
 * Everything that decides what the list becomes is a pure function here, so
 * it can be tested without a phone; storage and the screen only call it.
 */

/** Ids of destinations the account link owns. Nothing else is ever touched. */
export const ACCOUNT_PREFIX = "acct_";

export function isAccountConnection(connection: Connection): boolean {
  return connection.id.startsWith(ACCOUNT_PREFIX);
}

/** One stream as the studio's device API describes it. */
export type AccountStream = {
  id: string;
  name: string;
  server: string;
  key: string;
  width: number;
  height: number;
  fps: number;
  videoBitrate: number;
};

export type AccountStreams = { account: string | null; streams: AccountStream[] };

/**
 * `GET /api/device/streams`, trusted only as far as it parses.
 *
 * An entry without a server or a key is dropped rather than repaired: there
 * is nothing to dial, and a card that cannot go live is a card somebody will
 * pick two minutes before a lesson. Picture settings that are missing or odd
 * fall back to the defaults, the same rule a pairing link follows. Null for an
 * answer that is not the list at all, so the caller leaves the phone's copy
 * alone instead of reading a broken answer as "every stream was deleted".
 */
export function accountStreamsFrom(value: unknown): AccountStreams | null {
  const list = (value as { streams?: unknown } | null)?.streams;
  if (!Array.isArray(list)) return null;

  const accountName = (value as { account?: { name?: unknown } }).account?.name;
  const whole = (raw: unknown, fallback: number): number => {
    const n = typeof raw === "string" ? Number(raw) : raw;
    return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : fallback;
  };

  const seen = new Set<string>();
  const streams: AccountStream[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const server = typeof row.server === "string" ? row.server.trim() : "";
    const key = typeof row.key === "string" ? row.key.trim() : "";
    if (!id || !server || !key || seen.has(id)) continue;
    seen.add(id);
    streams.push({
      id,
      name: typeof row.name === "string" ? row.name.trim() : "",
      server,
      key,
      width: whole(row.w, DEFAULT_SETTINGS.width),
      height: whole(row.h, DEFAULT_SETTINGS.height),
      fps: whole(row.fps, DEFAULT_SETTINGS.fps),
      videoBitrate:
        typeof row.bitrate === "number"
          ? whole(row.bitrate, DEFAULT_SETTINGS.videoBitrate)
          : bitsPerSecond(typeof row.bitrate === "string" ? row.bitrate : null, DEFAULT_SETTINGS.videoBitrate),
    });
  }

  return {
    account: typeof accountName === "string" && accountName.trim() ? accountName.trim() : null,
    streams,
  };
}

export type Reconciled = { connections: Connection[]; activeId: string | null };

/**
 * The phone's destinations after a sync: one per stream on the account.
 *
 * - Each stream becomes `acct_<streamId>`, with its name, server and key from
 *   the studio and the account token as its control token.
 * - A destination paired earlier from one stream's code, for a stream that is
 *   now on the list, is replaced by the synced one - the same stream twice is
 *   two cards that look alike and drift apart. If it was the one chosen to
 *   send to, the synced one is chosen in its place.
 * - `acct_` destinations for streams that are gone are removed, and if one of
 *   them was chosen, nothing is: falling back silently to another card is how
 *   an operator goes live somewhere they did not pick.
 * - Anything that does not go through Framevane is left exactly as it was.
 *
 * The picture settings, SRT latency and passphrase are kept from the card
 * being replaced when there is one. The editor tells the operator those are
 * this phone's own copy - what it encodes and spends mobile data on - and a
 * sync that quietly put them back on every visit would make that sentence
 * false. A stream new to the phone starts from the studio's figures, as a
 * freshly paired one always has.
 *
 * The synced cards are dated from the moment of linking, one millisecond
 * apart in the studio's order, so the list (newest first) shows them together
 * and in the same order as the dashboard, and a sync never reshuffles them.
 */
export function reconcileAccountStreams(
  local: Connection[],
  link: Pick<AccountLink, "api" | "token" | "linkedAt">,
  streams: AccountStream[],
  activeId: string | null,
): Reconciled {
  const synced = new Map(local.filter(isAccountConnection).map((c) => [c.id, c]));
  const pairedByKey = new Map<string, Connection>();
  for (const connection of local) {
    if (isAccountConnection(connection)) continue;
    if (!connection.api || !connection.controlToken) continue;
    if (!pairedByKey.has(connection.streamKey)) pairedByKey.set(connection.streamKey, connection);
  }

  const onAccount = new Map(streams.map((stream) => [stream.key, `${ACCOUNT_PREFIX}${stream.id}`]));
  const replaced = (connection: Connection): boolean =>
    !isAccountConnection(connection) &&
    Boolean(connection.api && connection.controlToken) &&
    onAccount.has(connection.streamKey);

  // Any card being replaced hands its "chosen" mark to the one replacing it,
  // including a second copy of the same stream paired twice.
  let nextActive = activeId;
  for (const connection of local) {
    if (connection.id === activeId && replaced(connection)) {
      nextActive = onAccount.get(connection.streamKey) ?? null;
    }
  }

  const fromStudio = streams.map((stream, index): Connection => {
    const id = `${ACCOUNT_PREFIX}${stream.id}`;
    const previous = synced.get(id) ?? pairedByKey.get(stream.key);

    return {
      id,
      name: stream.name || nameFromServer(stream.server),
      server: stream.server,
      streamKey: stream.key,
      protocol: protocolFor(stream.server),
      srtLatencyMs: previous?.srtLatencyMs ?? DEFAULT_SETTINGS.srtLatencyMs,
      ...(previous?.passphrase ? { passphrase: previous.passphrase } : {}),
      api: link.api,
      controlToken: link.token,
      studioStreamId: stream.id,
      width: previous?.width ?? stream.width,
      height: previous?.height ?? stream.height,
      fps: previous?.fps ?? stream.fps,
      videoBitrate: previous?.videoBitrate ?? stream.videoBitrate,
      createdAt: link.linkedAt - index,
    };
  });

  const kept = new Set(fromStudio.map((c) => c.id));
  if (nextActive?.startsWith(ACCOUNT_PREFIX) && !kept.has(nextActive)) nextActive = null;

  const others = local.filter((connection) => !isAccountConnection(connection) && !replaced(connection));

  return { connections: [...fromStudio, ...others], activeId: nextActive };
}

/**
 * The list once the link is gone - revoked from the dashboard or undone here.
 *
 * Every `acct_` card goes with it: their token is the link's, and a card left
 * holding a dead token would offer overlays and a title that answer "refused"
 * to every tap. Cards the operator made themselves stay.
 */
export function withoutAccountStreams(local: Connection[], activeId: string | null): Reconciled {
  return {
    connections: local.filter((connection) => !isAccountConnection(connection)),
    activeId: activeId?.startsWith(ACCOUNT_PREFIX) ? null : activeId,
  };
}

/** Same value whatever order the keys were written in, for "did anything change". */
export function sameConnections(a: Connection[], b: Connection[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(b.map((c) => [c.id, c]));
  return a.every((c) => {
    const other = byId.get(c.id);
    if (!other) return false;
    const keys = new Set([...Object.keys(c), ...Object.keys(other)]) as Set<keyof Connection>;
    for (const key of keys) if (c[key] !== other[key]) return false;
    return true;
  });
}

/* -------------------------------------------------------------------------- */
/* The device API                                                             */
/* -------------------------------------------------------------------------- */

/** As long as a pairing claim: the same studio, over the same signal. */
const TIMEOUT_MS = 10_000;

export type StreamsAnswer =
  | { ok: true; value: AccountStreams }
  /** The studio no longer knows this phone. Not a network problem - final. */
  | { ok: false; revoked: true }
  | { ok: false; revoked: false; message: string };

/**
 * Asks the studio for the account's streams.
 *
 * Only a 401 is read as the link being gone. Everything else - no signal, a
 * timeout, a studio mid-restart - leaves the phone's copy as it is, because
 * deleting an operator's destinations over a dropped packet would be the app
 * punishing them for standing behind a wall. None of the messages quote the
 * response or the error, for the reason `overlays.ts` gives: either can carry
 * the request, and the request carries the token.
 */
export async function fetchAccountStreams(link: AccountLink): Promise<StreamsAnswer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${link.api}/api/device/streams`, {
      method: "GET",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${link.token}` },
    });
    if (response.status === 401) return { ok: false, revoked: true };
    if (!response.ok) {
      return {
        ok: false,
        revoked: false,
        message:
          response.status === 404
            ? "This studio does not share its stream list yet. Update it."
            : `The studio answered ${response.status}.`,
      };
    }
    const parsed = accountStreamsFrom(await response.json().catch(() => null));
    return parsed
      ? { ok: true, value: parsed }
      : { ok: false, revoked: false, message: "The studio sent back something the app cannot read." };
  } catch {
    return {
      ok: false,
      revoked: false,
      message: controller.signal.aborted
        ? "The studio did not answer in time."
        : "The studio could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Tells the studio to forget this phone. True when it has - including when it
 * already had, which is what a 401 means here.
 */
export async function unlinkDevice(link: AccountLink): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${link.api}/api/device`, {
      method: "DELETE",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${link.token}` },
    });
    return response.ok || response.status === 401;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

import type { SrtOptions } from "@/modules/framevane-broadcaster";

import type { AccountLink, Connection } from "./types";

/** Sensible starting point for a phone on a mobile uplink. */
export const DEFAULT_SETTINGS = {
  width: 1280,
  height: 720,
  fps: 30,
  videoBitrate: 2_500_000,
  srtLatencyMs: 2000,
} as const;

/**
 * Builds what the encoder is actually handed.
 *
 * The protocols carry the stream key completely differently: RTMP - and RTMPS,
 * which is the same handshake inside TLS - puts it in the path, while SRT puts
 * it in a `streamid` parameter that MediaMTX parses as `publish:<path>`.
 * Getting this wrong looks like a server refusing the connection for no
 * reason, so it is done in one place. The scheme is left as the operator typed
 * it, because the scheme is what the native side reads the protocol from.
 */
export function endpointFor(connection: Connection): string {
  const server = connection.server.replace(/\/+$/, "");
  if (connection.protocol !== "srt") {
    return `${server}/${connection.streamKey}`;
  }

  const path = new URL(server.replace(/^srt:/, "http:")).pathname.replace(/^\/+|\/+$/g, "");
  const streamId = `publish:${path ? `${path}/` : ""}${connection.streamKey}`;
  const base = server.split("?")[0];
  return `${base}?streamid=${encodeURIComponent(streamId)}&latency=${latencyOf(connection) * 1000}`;
}

/**
 * The SRT latency to dial with, whatever the record says.
 *
 * A card saved before the field existed reads it back as undefined, and
 * `undefined * 1000` is NaN - which went into the URL as `latency=NaN`, a
 * value the SRT library parses as nothing and the server reads as no floor at
 * all. Normalising on read covers the stored cards; this covers anything
 * built in between, because a URL is the one place a bad number cannot be
 * argued with afterwards.
 */
function latencyOf(connection: Connection): number {
  const value = connection.srtLatencyMs;
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : DEFAULT_SETTINGS.srtLatencyMs;
}

/**
 * A saved destination, read back into the shape this build expects.
 *
 * The cards are JSON on the phone, written by whichever version of the app
 * saved them, and the type says nothing about what is actually in storage. A
 * card from before SRT latency, or before the picture settings travelled with
 * a destination, came back without those fields - and every reader trusted
 * the type, so the missing latency reached the SRT URL as NaN and the missing
 * picture reached the encoder as undefined. Each field is checked and the
 * current default stands in for anything absent or unusable, so an old card
 * behaves as though it had been saved today with nothing changed.
 *
 * Null for a record that cannot be a destination at all: without a server and
 * a key there is nothing to dial, and inventing either would be worse than
 * dropping the card.
 */
export function normalizeConnection(raw: unknown): Connection | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const text = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;
  const positive = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;

  const id = text(record.id);
  const server = text(record.server)?.trim();
  const streamKey = text(record.streamKey);
  if (!id || !server || !streamKey) return null;

  const latency = record.srtLatencyMs;
  const createdAt = record.createdAt;
  const passphrase = text(record.passphrase);
  // Half a control channel is none - the same rule pairing applies.
  const api = text(record.api);
  const controlToken = text(record.controlToken);
  const studioStreamId = text(record.studioStreamId);

  return {
    id,
    name: text(record.name)?.trim() || nameFromServer(server),
    server,
    streamKey,
    // The scheme decides, as everywhere else; a stored protocol that
    // disagrees with it is the mismatch servers report as a refused socket.
    protocol: protocolFor(server),
    srtLatencyMs:
      typeof latency === "number" && Number.isFinite(latency) && latency >= 0
        ? Math.round(latency)
        : DEFAULT_SETTINGS.srtLatencyMs,
    ...(passphrase ? { passphrase } : {}),
    ...(api && controlToken ? { api, controlToken } : {}),
    // Meaningless without the channel it qualifies, so it goes with it.
    ...(api && controlToken && studioStreamId ? { studioStreamId } : {}),
    width: positive(record.width, DEFAULT_SETTINGS.width),
    height: positive(record.height, DEFAULT_SETTINGS.height),
    fps: positive(record.fps, DEFAULT_SETTINGS.fps),
    videoBitrate: positive(record.videoBitrate, DEFAULT_SETTINGS.videoBitrate),
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/**
 * Reads a pairing link from the dashboard's QR code:
 *   framevane://pair?server=rtmp://host:1935/live&key=...&name=Sharhul
 * Typing an RTMP URL and a thirty-character key on a phone, in a hurry, before
 * a broadcast, is how the wrong key ends up saved.
 */
/** A positive whole number, or the fallback. Anything else is not a setting. */
function whole(raw: string | null, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

/**
 * The dashboard stores a bitrate the way ffmpeg reads one - "4500k" - and the
 * encoder counts in bits per second. Converting here keeps the server's
 * spelling and the phone's arithmetic each where they belong.
 */
export function bitsPerSecond(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const match = /^(\d+)([kKmM]?)$/.exec(raw.trim());
  if (!match) return fallback;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  const scale = match[2].toLowerCase() === "m" ? 1_000_000 : match[2] ? 1_000 : 1;
  return value * scale;
}

/**
 * The dashboard's own address and this stream's control token, when the code
 * carries them.
 *
 * They arrive together because they are only useful together, and their
 * presence is what tells the phone this destination goes through Framevane at
 * all - the signal the viewfinder uses to decide whether overlays exist here.
 * So half a pair is read as none: a base URL with no token cannot be
 * authenticated, and a token with no base has nowhere to go.
 *
 * The URL is reduced to origin and path. A query string or a fragment on it
 * would end up in the middle of the control URLs built from it, and the whole
 * point of pairing by QR code is that the operator never has to notice.
 */
function controlChannelFrom(url: URL): { api: string; controlToken: string } | undefined {
  const api = url.searchParams.get("api")?.trim();
  const token = url.searchParams.get("token")?.trim();
  if (!api || !token) return undefined;

  let base: URL;
  try {
    base = new URL(api);
  } catch {
    return undefined;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") return undefined;

  return { api: `${base.origin}${base.pathname.replace(/\/+$/, "")}`, controlToken: token };
}

/**
 * The schemes a pairing link may arrive under.
 *
 * The app is called Long Take; the relay it pairs with is called Framevane, and
 * it was the app's own name until the rename. Both are accepted, and
 * `framevane:` is not going away: every QR code already drawn, screenshotted,
 * printed on a wall or pinned in a group carries it, and the dashboard keeps
 * emitting it until it too is deployed with the new name. A scheme is invisible
 * to the operator - the only thing renaming it can do here is break pairing on
 * a live broadcast, which is exactly what nobody needs on a Sunday morning.
 */
const PAIRING_SCHEMES = ["framevane:", "longtake:"];

export function connectionFromPairingUrl(raw: string): Connection | null {
  try {
    const url = new URL(raw);
    if (!PAIRING_SCHEMES.includes(url.protocol)) return null;
    const server = url.searchParams.get("server");
    const key = url.searchParams.get("key");
    if (!server || !key) return null;

    return {
      id: `conn_${Date.now().toString(36)}`,
      name: url.searchParams.get("name") ?? "Framevane",
      server,
      streamKey: key,
      protocol: protocolFor(server),
      srtLatencyMs: DEFAULT_SETTINGS.srtLatencyMs,
      /**
       * The stream's own picture settings, when the code carries them. A code
       * made before they were included still pairs - it simply falls back to
       * the defaults, which is what every code used to do.
       */
      width: whole(url.searchParams.get("w"), DEFAULT_SETTINGS.width),
      height: whole(url.searchParams.get("h"), DEFAULT_SETTINGS.height),
      fps: whole(url.searchParams.get("fps"), DEFAULT_SETTINGS.fps),
      videoBitrate: bitsPerSecond(
        url.searchParams.get("bitrate"),
        DEFAULT_SETTINGS.videoBitrate,
      ),
      /**
       * The control channel, when the code carries one. A code from an older
       * dashboard, or a destination typed in by hand, has neither - it pairs
       * and streams exactly as it always did, and simply has no overlays to
       * offer, which is the truth about where it is pointing.
       */
      ...controlChannelFrom(url),
      createdAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/**
 * Reads the account-link QR from the dashboard's Phones section:
 *   framevane://link?api=https://studio.example&code=K7M4QP2X
 *   longtake://link?api=...                       (same link, new name)
 *
 * Unlike a stream's pairing link this carries no credential, only a one-time
 * code and where to spend it - so a photo of the screen is worth nothing once
 * the code is used or ten minutes have passed. The phone still has to make the
 * claim itself, which is `claimPairingCode` with the studio filled in.
 *
 * Told apart from a stream link by the word after the scheme, read off the
 * raw text rather than `URL.host`: a custom scheme's host is the part of URL
 * parsing runtimes disagree on, and this one has to agree with the scanner.
 *
 * Both schemes, for the same reason `PAIRING_SCHEMES` has both.
 */
export function accountLinkCodeFromUrl(raw: string): { studio: string; code: string } | null {
  if (!/^(?:framevane|longtake):\/\/link(?:[/?]|$)/i.test(raw.trim())) return null;
  try {
    const url = new URL(raw.trim());
    const studio = studioUrlFrom(url.searchParams.get("api") ?? "");
    const code = (url.searchParams.get("code") ?? "").replace(/[^0-9A-Za-z]/g, "");
    return studio && code ? { studio, code } : null;
  } catch {
    return null;
  }
}

/**
 * The scheme decides the protocol, everywhere. Asking the operator for it
 * separately invites the two to disagree, and a mismatch is reported by every
 * server as a refused connection with no reason given.
 */
export function protocolFor(server: string): Connection["protocol"] {
  const scheme = server.trim().toLowerCase();
  if (scheme.startsWith("srt:")) return "srt";
  if (scheme.startsWith("rtmps:")) return "rtmps";
  return "rtmp";
}

/**
 * SRT's two settings that do not travel in the URL, for
 * `Broadcaster.setSrtOptions` before the connection is opened.
 *
 * Latency is also put in the URL by `endpointFor`, and that is deliberate
 * rather than sloppy: SRT negotiates latency as the larger of the two ends'
 * values, so the same figure arriving twice is the same floor arriving twice.
 * The passphrase has nowhere in the URL to live and can only be set this way.
 *
 * Always sent, as an empty string when there is none. Leaving it out used to
 * mean "no change" on the native side, so a destination without a passphrase
 * inherited the last one that had one and was dialled encrypted with a key its
 * server had never seen.
 */
export function srtOptionsFor(connection: Connection): SrtOptions {
  return {
    latencyMs: latencyOf(connection),
    passphrase: connection.passphrase ?? "",
  };
}

/** Something wrong with a destination, in words the operator can act on. */
export type ConnectionProblem = {
  /** True when it cannot be saved at all; false when it is only a bad idea. */
  blocking: boolean;
  message: string;
};

/**
 * Why this destination will not work, said out loud.
 *
 * A Save button that is simply dead teaches nobody anything - least of all at
 * the side of a pitch, two minutes before kick-off, with a key pasted from a
 * phone keyboard. Every check here exists because the failure it catches is
 * otherwise reported by the server as a refused connection with no reason.
 */
export function connectionProblems(connection: Connection): ConnectionProblem[] {
  const problems: ConnectionProblem[] = [];
  const server = connection.server.trim();
  const key = connection.streamKey.trim();

  if (!/^(rtmp|rtmps|srt):\/\/[^/?\s]+/.test(server)) {
    problems.push({
      blocking: true,
      message: "The server URL needs to start rtmp://, rtmps:// or srt:// and carry a host.",
    });
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(server.replace(/^(rtmps?|srt):/, "http:"));
    } catch {
      parsed = null;
    }

    if (!parsed) {
      problems.push({
        blocking: true,
        message: "That server URL will not parse. Check for a stray space.",
      });
    } else if (connection.protocol === "srt") {
      // SRT has no default port, so a URL without one connects to nothing and
      // the failure looks identical to a server that is down.
      if (!parsed.port) {
        problems.push({
          blocking: true,
          message: "SRT needs the port too, as in srt://host:8890.",
        });
      }
    } else if (parsed.pathname.replace(/\/+$/, "").length <= 1) {
      // RTMP's application path is what MediaMTX matches the stream against;
      // without it the handshake is rejected before the key is even read.
      problems.push({
        blocking: true,
        message: "RTMP needs the application path as well, as in rtmp://host:1935/live.",
      });
    }
  }

  if (!key) {
    problems.push({
      blocking: true,
      message:
        "The stream key is missing. It is on the stream's page in Framevane, beside the server URL.",
    });
  } else if (/[\s/?#]/.test(key)) {
    problems.push({
      blocking: true,
      message: "The stream key has a slash or a space in it. Check you did not paste the whole URL.",
    });
  }

  if (!connection.name.trim()) {
    problems.push({
      blocking: false,
      message: "No name yet. Saved as the host, which is harder to tell apart when there are three.",
    });
  }

  // The figures most platforms publish for these shapes. Under them the
  // encoder spends its bitrate on movement and the picture smears.
  const pixelsPerSecond = connection.width * connection.height * connection.fps;
  const wanted = Math.round((pixelsPerSecond * 0.04) / 1000);
  if (connection.videoBitrate < wanted * 1000) {
    problems.push({
      blocking: false,
      message:
        `${connection.height}p at ${connection.fps} fps wants around ${wanted} kbps, and this ` +
        `is set to ${Math.round(connection.videoBitrate / 1000)} kbps. Movement will smear.`,
    });
  }

  // SRT's own limit, enforced by libsrt rather than by us: a passphrase
  // outside it is rejected when the socket is created, which surfaces as a
  // connection that fails instantly with nothing useful said about it.
  const passphrase = connection.passphrase?.trim() ?? "";
  const passphraseOutOfRange = passphrase.length < 10 || passphrase.length > 79;
  if (connection.protocol === "srt" && passphrase && passphraseOutOfRange) {
    problems.push({
      blocking: true,
      message: "An SRT passphrase has to be between 10 and 79 characters, or left empty.",
    });
  }

  if (connection.protocol === "srt" && connection.srtLatencyMs < 1000) {
    problems.push({
      blocking: false,
      message:
        "Under 1000 ms of SRT latency leaves no room to ask for a lost packet again on a mobile uplink.",
    });
  }

  return problems;
}

/** The host, for a destination nobody got round to naming. */
export function nameFromServer(server: string): string {
  try {
    return new URL(server.replace(/^(rtmps?|srt):/, "http:")).hostname || "Framevane";
  } catch {
    return "Framevane";
  }
}

/* -------------------------------------------------------------------------- */
/* Pairing by typed code                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The other way in, for an operator with one device.
 *
 * Scanning assumes two: a phone to point, and a screen to point it at. The
 * person this app was built for films alone with the studio open on the same
 * handset that is doing the filming, and there is nothing for them to scan.
 *
 * Typing the destination by hand was already possible and was not an answer.
 * That path can only carry the server and the key - there is nowhere to put
 * the studio's address or this stream's control token - so a hand-typed
 * destination is a dumb pipe for ever: no overlays, no broadcast title, no
 * who-can-watch, no announcement. Everything the app can do beyond pushing
 * pixels is gated on a pair it had no way to receive.
 *
 * So the code is not the credential. It is eight characters the studio will
 * exchange, once, for exactly the link the QR would have carried - and the
 * result goes through the same parser, so a connection paired this way and one
 * paired by scanning are the same object.
 */

/** Long enough for a round trip on a hall's wifi, short enough to give up on. */
const CLAIM_TIMEOUT_MS = 10_000;

/**
 * What a code turned out to be. The operator types the same eight characters
 * either way and cannot know which kind the studio showed them - one stream's
 * pairing, or the whole account's link - so the answer says, and the screen
 * files it accordingly.
 */
export type ClaimResult =
  | { ok: true; kind: "stream"; connection: Connection }
  | { ok: true; kind: "account"; account: AccountLink }
  | { ok: false; message: string };

/**
 * The account half of a claim answer: `{ device: { api, token, name } }`.
 *
 * The token is checked for its prefix rather than taken as any string,
 * because it is about to be stored as a credential and sent to every control
 * route - an answer from something that is not a Framevane studio should fail
 * here, not on the first overlay. The address it names is preferred to the
 * one the code was typed against, since it is the studio's own idea of where
 * it lives; the typed one stands in when it is missing or unusable.
 */
export function accountLinkFromClaim(
  value: unknown,
  studio: string,
  now: number = Date.now(),
): AccountLink | null {
  const device = (value as { device?: unknown } | null)?.device;
  if (!device || typeof device !== "object") return null;
  const { api, token, name } = device as { api?: unknown; token?: unknown; name?: unknown };
  if (typeof token !== "string" || !/^fvd_[A-Za-z0-9_-]+$/.test(token)) return null;

  const base = (typeof api === "string" && /^https?:\/\//i.test(api.trim()) && studioUrlFrom(api)) || studio;
  return {
    api: base,
    token,
    name: typeof name === "string" && name.trim() ? name.trim() : nameFromStudio(base),
    linkedAt: now,
  };
}

/** The host, for a studio that did not say what it is called. */
export function nameFromStudio(api: string): string {
  return api.replace(/^https?:\/\//i, "").replace(/\/.*$/, "") || "Framevane";
}

/**
 * What the operator typed, turned into an address.
 *
 * Nobody types a scheme. `framevane.linkfa.de` is what is on the screen in
 * front of them and what they will type, and refusing it in favour of
 * "https://framevane.linkfa.de" would be this app being right at the operator's
 * expense. A scheme they did type is kept, so a plain-HTTP studio on a local
 * network still works.
 */
export function studioUrlFrom(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Spends a pairing code at a studio.
 *
 * Answers rather than throws, like everything else the viewfinder calls: this
 * runs on a phone at a tripod, where a failed request is an ordinary Tuesday.
 *
 * Every failure says what to do next and none of them say anything about the
 * code. The studio deliberately gives one answer to expired, spent, mistyped
 * and never-existed, so repeating that distinction here would be inventing it.
 */
export async function claimPairingCode(
  studio: string,
  code: string,
  /**
   * What the studio should call this phone in its list of linked phones.
   * Sent with every claim because the phone cannot tell an account code from a
   * stream code until the answer comes back; a stream claim ignores it, and so
   * does a studio too old to know about linking.
   */
  device?: string,
): Promise<ClaimResult> {
  const base = studioUrlFrom(studio);
  if (!base) return { ok: false, message: "That does not look like a studio address." };

  const typed = code.replace(/[^0-9A-Za-z]/g, "");
  if (typed.length === 0) return { ok: false, message: "Type the code from the studio." };

  /**
   * AbortController and a timer, not `AbortSignal.timeout`.
   *
   * React Native polyfills AbortSignal from the `abort-controller` package,
   * which implements the constructor and nothing static - there is no
   * `AbortSignal.timeout` on this runtime. Calling it threw before the request
   * was ever made, and the catch below reported that as "Could not reach
   * <studio>", which sent an operator looking at their signal for a bug in
   * this file. The rest of the app has always used the pair below; this was
   * the one place that did not.
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLAIM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${base}/api/pair/claim`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(device?.trim() ? { code: typed, device: device.trim().slice(0, 80) } : { code: typed }),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, message: `Could not reach ${base}. Check the address and the signal.` };
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    return { ok: false, message: "Too many tries. Wait a moment, then try again." };
  }
  if (!response.ok) {
    /**
     * A studio that has no pairing endpoint answers 404 with its own HTML
     * not-found page, which is the same status this endpoint uses for a code
     * it will not accept. The content type tells them apart, and they need
     * different sentences: one is fixed by typing it again, the other never
     * will be.
     */
    const isJson = (response.headers.get("content-type") ?? "").includes("json");
    return {
      ok: false,
      message:
        response.status === 404 && !isJson
          ? "That studio does not take pairing codes yet. Update it, or scan the QR instead."
          : "That code was not accepted. Show a new one in the studio and type it again.",
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, message: "The studio sent back something the app cannot read." };
  }

  // An account code answers with the phone's own credential instead of a link.
  if (body && typeof body === "object" && "device" in body) {
    const account = accountLinkFromClaim(body, base);
    return account
      ? { ok: true, kind: "account", account }
      : { ok: false, message: "The studio sent back something the app cannot read." };
  }

  const link = (body as { link?: unknown } | null)?.link;
  const connection = typeof link === "string" ? connectionFromPairingUrl(link) : null;
  if (!connection) {
    return { ok: false, message: "The studio sent back something the app cannot read." };
  }

  return { ok: true, kind: "stream", connection };
}

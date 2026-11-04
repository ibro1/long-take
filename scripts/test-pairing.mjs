#!/usr/bin/env node
/**
 * The contract between the dashboard and the phone.
 *
 *   node --experimental-strip-types scripts/test-pairing.mjs
 *
 * The dashboard builds a `framevane://pair` link and draws it as a QR code; the
 * app parses that link and turns it into an endpoint the encoder can use. Those
 * two live in different languages, in different apps, on different machines,
 * and nothing but this checks that they still agree.
 *
 * Everything below is invented. This file used to be written against one real
 * stream - its host, its key, its control token and the name of the lecture it
 * carried - which made a check that runs on every checkout into a copy of a
 * live credential, and would have published one alongside the source. What the
 * checks are actually about is the shape of a pairing link, and a made-up one
 * has the same shape.
 */
import { canPushOverlays } from "../lib/broadcast/overlays.ts";
import { connectionFromPairingUrl, endpointFor } from "../lib/broadcast/pairing.ts";

/** A key of the same length and alphabet as a real one, and obviously not one. */
const KEY = "examplekey0000000000000000000001";
/** `ctl_` and sixteen characters, as the dashboard mints them. */
const TOKEN = "ctl_example000000000";

const SERVER = "rtmp://ingest.example.com:1935/live";
const SRT = "srt://ingest.example.com:8890";
const STUDIO = "https://studio.example.com";
/** Spaces and a capital, because a real broadcast title has both. */
const NAME = "Example lecture";

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

/** Exactly how apps/dashboard/src/lib/streams/functions.ts builds it. */
function dashboardLink({ server, key, name, w, h, fps, bitrate, api, token }) {
  const link = new URL("framevane://pair");
  link.searchParams.set("server", server);
  link.searchParams.set("key", key);
  link.searchParams.set("name", name);
  // Written exactly as `$pairingCode` writes them, including the bitrate's
  // ffmpeg spelling - the point of this file is that the two agree.
  if (w !== undefined) link.searchParams.set("w", String(w));
  if (h !== undefined) link.searchParams.set("h", String(h));
  if (fps !== undefined) link.searchParams.set("fps", String(fps));
  if (bitrate !== undefined) link.searchParams.set("bitrate", bitrate);
  // The control channel, which the phone reads as "this destination goes
  // through Framevane" and nothing else does.
  if (api !== undefined) link.searchParams.set("api", api);
  if (token !== undefined) link.searchParams.set("token", token);
  return link.toString();
}

const rtmp = connectionFromPairingUrl(
  dashboardLink({
    server: SERVER,
    key: KEY,
    name: NAME,
  }),
);

check("an RTMP pairing link is understood", rtmp !== null);
check("the name survives spaces", rtmp?.name === NAME, rtmp?.name);
check("the protocol is taken from the scheme", rtmp?.protocol === "rtmp", rtmp?.protocol);
check(
  "the key goes in the path, where RTMP expects it",
  endpointFor(rtmp) === `${SERVER}/${KEY}`,
  endpointFor(rtmp),
);

const srt = connectionFromPairingUrl(
  dashboardLink({
    server: SRT,
    key: KEY,
    name: NAME,
  }),
);

check("an SRT pairing link is understood", srt?.protocol === "srt", srt?.protocol);

/**
 * SRT carries the key completely differently: MediaMTX reads it from a
 * `streamid` of the form `publish:<path>`. Getting this wrong presents as the
 * server refusing the connection for no stated reason, which is why it is
 * pinned here rather than discovered on a phone.
 */
const srtEndpoint = endpointFor(srt);
check(
  "the key goes in streamid, where SRT expects it",
  srtEndpoint.includes(`streamid=publish%3A${KEY}`),
  srtEndpoint,
);
check("SRT latency is sent in microseconds", srtEndpoint.includes("latency=2000000"), srtEndpoint);

/**
 * The stream's own picture settings. Without these the phone paired at its own
 * defaults and sent 720p into a stream configured for 360p - the compositor
 * scaled it down again, so the uplink and the battery paid for a difference no
 * viewer ever saw.
 */
const sized = connectionFromPairingUrl(
  dashboardLink({
    server: SERVER,
    key: KEY,
    name: NAME,
    w: 640,
    h: 360,
    fps: 30,
    bitrate: "4500k",
  }),
);

check("the picture travels with the code", sized?.height === 360 && sized?.width === 640, `${sized?.width}x${sized?.height}`);
check(
  "the dashboard's bitrate spelling becomes bits per second",
  sized?.videoBitrate === 4_500_000,
  sized?.videoBitrate,
);

/**
 * A code made before the picture was included must still pair. Refusing one
 * would strand anyone whose dashboard is a version behind.
 */
check(
  "a code without a picture still pairs, at the defaults",
  rtmp?.height === 720 && rtmp?.videoBitrate === 2_500_000,
  `${rtmp?.height}p ${rtmp?.videoBitrate}`,
);

check("a nonsense bitrate falls back rather than becoming NaN", 
  connectionFromPairingUrl(
    dashboardLink({
      server: SERVER,
      key: KEY,
      name: "x",
      bitrate: "lots",
    }),
  )?.videoBitrate === 2_500_000,
);

/**
 * The control channel. Without it the phone can stream to this destination and
 * has no way to put an overlay on it, which is the whole difference between a
 * Framevane stream and any other RTMP server - so the phone reads the pair as
 * the capability itself and offers nothing where there is none.
 */
const controlled = connectionFromPairingUrl(
  dashboardLink({
    server: SERVER,
    key: KEY,
    name: NAME,
    api: STUDIO,
    token: TOKEN,
  }),
);

check("the dashboard's address travels with the code", controlled?.api === STUDIO, controlled?.api);
check("the control token travels with the code", controlled?.controlToken === TOKEN, controlled?.controlToken);
check("a paired stream can push overlays", canPushOverlays(controlled));

/**
 * A trailing slash, or a query string someone appended, would otherwise end up
 * in the middle of every control URL built from this.
 */
const trailing = connectionFromPairingUrl(
  dashboardLink({
    server: SERVER,
    key: KEY,
    name: "x",
    api: `${STUDIO}/?ref=qr`,
    token: TOKEN,
  }),
);
check("the dashboard address is trimmed to something URLs can be built on", trailing?.api === STUDIO, trailing?.api);

/**
 * A code from a dashboard that predates the control routes, and a destination
 * typed in by hand, both arrive with neither. They must pair exactly as they
 * always have - the only thing they lack is overlays.
 */
check("a code without a control channel still pairs", rtmp !== null && rtmp.api === undefined && rtmp.controlToken === undefined);
check("and is honest about having no overlays", canPushOverlays(rtmp) === false);

/**
 * Half a channel is none: a base URL with no token cannot be authenticated and
 * a token with no base has nowhere to go. Either alone would present as a
 * control that takes a tap and does nothing.
 */
const halves = [
  { api: STUDIO },
  { token: TOKEN },
  { api: "ftp://studio.example.com", token: TOKEN },
  { api: "not a url", token: TOKEN },
];
for (const half of halves) {
  const paired = connectionFromPairingUrl(
    dashboardLink({
      server: SERVER,
      key: KEY,
      name: "x",
      ...half,
    }),
  );
  check(
    `an incomplete control channel pairs without one: ${JSON.stringify(half)}`,
    paired !== null && canPushOverlays(paired) === false,
  );
}

check("a link that is not ours is refused", connectionFromPairingUrl("https://example.com") === null);
check("nonsense is refused rather than thrown at", connectionFromPairingUrl("not a url") === null);

console.log(failures === 0 ? "\n[pairing] ALL CHECKS PASSED" : `\n[pairing] ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

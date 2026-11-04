import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountLinkCodeFromUrl,
  accountLinkFromClaim,
  connectionFromPairingUrl,
  DEFAULT_SETTINGS,
  endpointFor,
  normalizeConnection,
  srtOptionsFor,
} from "./pairing.ts";

/**
 * Saved destinations as they really come back off the phone: written by
 * whichever version of the app saved them, so missing the fields that came
 * later, and occasionally holding a value no version should have written.
 */

const OLD_SRT_CARD = {
  id: "conn_old",
  name: "Hall",
  server: "srt://ingest.example:8890",
  streamKey: "sk_live_123",
  protocol: "srt",
  createdAt: 1_700_000_000_000,
};

test("a card saved before latency and picture settings gets today's defaults", () => {
  const card = normalizeConnection(OLD_SRT_CARD);
  assert.ok(card);
  assert.equal(card.srtLatencyMs, DEFAULT_SETTINGS.srtLatencyMs);
  assert.equal(card.width, DEFAULT_SETTINGS.width);
  assert.equal(card.height, DEFAULT_SETTINGS.height);
  assert.equal(card.fps, DEFAULT_SETTINGS.fps);
  assert.equal(card.videoBitrate, DEFAULT_SETTINGS.videoBitrate);
  // What it did have is kept.
  assert.equal(card.name, "Hall");
  assert.equal(card.createdAt, OLD_SRT_CARD.createdAt);
});

test("an old SRT card never puts NaN into the URL", () => {
  const card = normalizeConnection(OLD_SRT_CARD);
  assert.ok(card);
  const url = endpointFor(card);
  assert.ok(!url.includes("NaN"), url);
  assert.match(url, /latency=2000000$/);
  assert.equal(srtOptionsFor(card).latencyMs, DEFAULT_SETTINGS.srtLatencyMs);
});

test("the URL builder holds the line even for a record that skipped normalising", () => {
  const raw = { ...OLD_SRT_CARD, srtLatencyMs: undefined } as unknown as Parameters<typeof endpointFor>[0];
  assert.ok(!endpointFor(raw).includes("NaN"));
});

test("values no version should have written are replaced, not trusted", () => {
  const card = normalizeConnection({
    ...OLD_SRT_CARD,
    srtLatencyMs: Number.NaN,
    width: -1,
    height: "720",
    fps: 0,
    videoBitrate: Infinity,
  });
  assert.ok(card);
  assert.equal(card.srtLatencyMs, DEFAULT_SETTINGS.srtLatencyMs);
  assert.equal(card.width, DEFAULT_SETTINGS.width);
  assert.equal(card.height, DEFAULT_SETTINGS.height);
  assert.equal(card.fps, DEFAULT_SETTINGS.fps);
  assert.equal(card.videoBitrate, DEFAULT_SETTINGS.videoBitrate);
});

test("a card's own settings survive", () => {
  const card = normalizeConnection({
    ...OLD_SRT_CARD,
    srtLatencyMs: 4000,
    width: 1920,
    height: 1080,
    fps: 25,
    videoBitrate: 4_500_000,
    passphrase: "a-long-passphrase",
  });
  assert.ok(card);
  assert.equal(card.srtLatencyMs, 4000);
  assert.equal(card.width, 1920);
  assert.equal(card.fps, 25);
  assert.equal(card.videoBitrate, 4_500_000);
  assert.equal(card.passphrase, "a-long-passphrase");
});

test("the protocol follows the scheme, whatever was stored", () => {
  const card = normalizeConnection({ ...OLD_SRT_CARD, server: "rtmps://a.example/live", protocol: "srt" });
  assert.equal(card?.protocol, "rtmps");
});

test("half a control channel is none", () => {
  const card = normalizeConnection({ ...OLD_SRT_CARD, api: "https://studio.example/api" });
  assert.ok(card);
  assert.equal(card.api, undefined);
  assert.equal(card.controlToken, undefined);
  const paired = normalizeConnection({ ...OLD_SRT_CARD, api: "https://s.example", controlToken: "ct" });
  assert.equal(paired?.controlToken, "ct");
});

test("a record with nothing to dial is dropped", () => {
  assert.equal(normalizeConnection(null), null);
  assert.equal(normalizeConnection("conn"), null);
  assert.equal(normalizeConnection({ ...OLD_SRT_CARD, streamKey: undefined }), null);
  assert.equal(normalizeConnection({ ...OLD_SRT_CARD, server: "  " }), null);
});

test("a nameless card is named after its server", () => {
  assert.equal(normalizeConnection({ ...OLD_SRT_CARD, name: "" })?.name, "ingest.example");
});

test("a synced card keeps the stream it names, and only with its channel", () => {
  const synced = normalizeConnection({
    ...OLD_SRT_CARD,
    api: "https://s.example",
    controlToken: "fvd_abc",
    studioStreamId: "stream_1",
  });
  assert.equal(synced?.studioStreamId, "stream_1");
  const orphan = normalizeConnection({ ...OLD_SRT_CARD, studioStreamId: "stream_1" });
  assert.equal(orphan?.studioStreamId, undefined);
});

test("the account-link QR gives a studio and a code, never a destination", () => {
  const raw = "framevane://link?api=https%3A%2F%2Fstudio.example%2F&code=K7M4-QP2X";
  assert.deepEqual(accountLinkCodeFromUrl(raw), { studio: "https://studio.example", code: "K7M4QP2X" });
  assert.equal(connectionFromPairingUrl(raw), null);
  // A stream's link is not an account link, and half of one is nothing.
  assert.equal(accountLinkCodeFromUrl("framevane://pair?server=rtmp://h/live&key=k"), null);
  assert.equal(accountLinkCodeFromUrl("framevane://link?api=https://studio.example"), null);
  assert.equal(accountLinkCodeFromUrl("framevane://linked?api=https://studio.example&code=AB"), null);
});

/**
 * The app was called Framevane before it was called Long Take, and the QR codes
 * drawn under the old name are still on walls, in screenshots and pinned in
 * groups. Both schemes have to keep working: a rename that breaks pairing is a
 * rename that breaks a broadcast.
 */
test("both schemes pair, and the old one pairs exactly as the new one", () => {
  const link = (scheme: string) => `${scheme}://pair?server=rtmp://h/live&key=abc123&name=Test`;

  const old = connectionFromPairingUrl(link("framevane"));
  const next = connectionFromPairingUrl(link("longtake"));
  assert.ok(old && next, "both schemes are understood");
  assert.deepEqual(
    { server: next.server, key: next.streamKey, name: next.name, protocol: next.protocol },
    { server: old.server, key: old.streamKey, name: old.name, protocol: old.protocol },
  );

  // The account link follows the same rule.
  assert.deepEqual(
    accountLinkCodeFromUrl("longtake://link?api=https://studio.example&code=AB12"),
    accountLinkCodeFromUrl("framevane://link?api=https://studio.example&code=AB12"),
  );

  // And a scheme that is neither is still refused, in both parsers.
  assert.equal(connectionFromPairingUrl("other://pair?server=rtmp://h/live&key=abc"), null);
  assert.equal(accountLinkCodeFromUrl("other://link?api=https://studio.example&code=AB12"), null);
});

test("a claim answer for the account becomes a link with its token", () => {
  const link = accountLinkFromClaim(
    { device: { api: "https://studio.example/", token: "fvd_Abc-123_x", name: "Sharhul" } },
    "https://typed.example",
    42,
  );
  assert.deepEqual(link, { api: "https://studio.example", token: "fvd_Abc-123_x", name: "Sharhul", linkedAt: 42 });
});

test("a claim answer without a proper device token is refused", () => {
  assert.equal(accountLinkFromClaim({ device: { api: "https://s.example", token: "ct_stream" } }, "https://s.example"), null);
  assert.equal(accountLinkFromClaim({ device: {} }, "https://s.example"), null);
  assert.equal(accountLinkFromClaim({ link: "framevane://pair?x" }, "https://s.example"), null);
});

test("a claim answer with no usable address falls back to the studio typed", () => {
  const link = accountLinkFromClaim({ device: { api: "javascript:alert(1)", token: "fvd_x" } }, "https://typed.example");
  assert.equal(link?.api, "https://typed.example");
  assert.equal(link?.name, "typed.example");
});

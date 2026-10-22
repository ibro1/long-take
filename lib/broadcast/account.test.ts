import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accountStreamsFrom,
  reconcileAccountStreams,
  sameConnections,
  withoutAccountStreams,
} from "./account.ts";
import { DEFAULT_SETTINGS } from "./pairing.ts";
import type { Connection } from "./types.ts";

/**
 * The list a linked phone ends up with. The inputs are the shapes the phone
 * really holds: a card typed by hand, a card paired from one stream's code,
 * and cards a previous sync wrote.
 */

const LINK = { api: "https://studio.example", token: "fvd_testtoken", linkedAt: 1_800_000_000_000 };

function card(overrides: Partial<Connection>): Connection {
  return {
    id: "conn_x",
    name: "Card",
    server: "rtmp://ingest.example:1935/live",
    streamKey: "sk_x",
    protocol: "rtmp",
    srtLatencyMs: DEFAULT_SETTINGS.srtLatencyMs,
    width: 1280,
    height: 720,
    fps: 30,
    videoBitrate: 2_500_000,
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

const HAND_TYPED = card({ id: "conn_hand", name: "YouTube direct", server: "rtmps://a.rtmp.youtube.com/live2", protocol: "rtmps", streamKey: "yt_key" });
const STREAM_PAIRED = card({ id: "conn_paired", name: "Old name", streamKey: "sk_hall", api: "https://studio.example", controlToken: "ct_hall", width: 1920, height: 1080 });

function stream(id: string, key: string, name = id) {
  return { id, name, server: "rtmp://ingest.example:1935/live", key, width: 1280, height: 720, fps: 30, videoBitrate: 4_500_000 };
}

test("each stream on the account becomes one acct_ card holding the account token", () => {
  const { connections } = reconcileAccountStreams([], LINK, [stream("s1", "sk_1", "Hall"), stream("s2", "sk_2", "Masjid")], null);
  assert.deepEqual(connections.map((c) => c.id), ["acct_s1", "acct_s2"]);
  const hall = connections[0];
  assert.equal(hall.name, "Hall");
  assert.equal(hall.streamKey, "sk_1");
  assert.equal(hall.api, LINK.api);
  assert.equal(hall.controlToken, LINK.token);
  assert.equal(hall.studioStreamId, "s1");
  assert.equal(hall.videoBitrate, 4_500_000);
});

test("synced cards keep the dashboard's order in a newest-first list", () => {
  const { connections } = reconcileAccountStreams([], LINK, [stream("a", "k1"), stream("b", "k2"), stream("c", "k3")], null);
  const sorted = [...connections].sort((x, y) => y.createdAt - x.createdAt);
  assert.deepEqual(sorted.map((c) => c.id), ["acct_a", "acct_b", "acct_c"]);
});

test("a hand-typed destination is never touched", () => {
  const { connections, activeId } = reconcileAccountStreams([HAND_TYPED], LINK, [stream("s1", "yt_key")], "conn_hand");
  assert.deepEqual(connections.find((c) => c.id === "conn_hand"), HAND_TYPED);
  assert.equal(activeId, "conn_hand");
});

test("a stream-paired card for a stream on the account is replaced, and stays chosen", () => {
  const { connections, activeId } = reconcileAccountStreams(
    [STREAM_PAIRED, HAND_TYPED],
    LINK,
    [stream("hall", "sk_hall", "Main hall")],
    "conn_paired",
  );
  assert.deepEqual(connections.map((c) => c.id).sort(), ["acct_hall", "conn_hand"]);
  assert.equal(activeId, "acct_hall");
  const synced = connections.find((c) => c.id === "acct_hall");
  // The studio's name and token; the phone's own picture choice.
  assert.equal(synced?.name, "Main hall");
  assert.equal(synced?.controlToken, LINK.token);
  assert.equal(synced?.height, 1080);
});

test("a stream-paired card for a stream not on the account is kept", () => {
  const other = { ...STREAM_PAIRED, streamKey: "sk_elsewhere" };
  const { connections } = reconcileAccountStreams([other], LINK, [stream("hall", "sk_hall")], null);
  assert.ok(connections.some((c) => c.id === "conn_paired"));
});

test("a stream gone from the dashboard takes its card with it, and the choice", () => {
  const first = reconcileAccountStreams([], LINK, [stream("s1", "k1"), stream("s2", "k2")], null);
  const second = reconcileAccountStreams(first.connections, LINK, [stream("s1", "k1")], "acct_s2");
  assert.deepEqual(second.connections.map((c) => c.id), ["acct_s1"]);
  assert.equal(second.activeId, null);
});

test("a rename or a rotated key on the dashboard reaches the existing card", () => {
  const first = reconcileAccountStreams([], LINK, [stream("s1", "k1", "Before")], "acct_s1");
  const second = reconcileAccountStreams(first.connections, LINK, [stream("s1", "k1-rotated", "After")], "acct_s1");
  assert.equal(second.connections[0].name, "After");
  assert.equal(second.connections[0].streamKey, "k1-rotated");
  assert.equal(second.activeId, "acct_s1");
});

test("the phone's own picture settings on a synced card survive the next sync", () => {
  const first = reconcileAccountStreams([], LINK, [stream("s1", "k1")], null);
  const edited = first.connections.map((c) => ({ ...c, height: 360, width: 640, videoBitrate: 800_000 }));
  const second = reconcileAccountStreams(edited, LINK, [stream("s1", "k1")], null);
  assert.equal(second.connections[0].height, 360);
  assert.equal(second.connections[0].videoBitrate, 800_000);
});

test("a sync that changes nothing is recognised as such", () => {
  const first = reconcileAccountStreams([HAND_TYPED], LINK, [stream("s1", "k1")], null);
  const second = reconcileAccountStreams(first.connections, LINK, [stream("s1", "k1")], null);
  assert.ok(sameConnections(first.connections, second.connections));
  const renamed = reconcileAccountStreams(first.connections, LINK, [stream("s1", "k1", "New")], null);
  assert.ok(!sameConnections(first.connections, renamed.connections));
});

test("unlinking removes only the account's cards", () => {
  const synced = reconcileAccountStreams([HAND_TYPED], LINK, [stream("s1", "k1")], null).connections;
  const gone = withoutAccountStreams(synced, "acct_s1");
  assert.deepEqual(gone.connections, [HAND_TYPED]);
  assert.equal(gone.activeId, null);
  assert.equal(withoutAccountStreams(synced, "conn_hand").activeId, "conn_hand");
});

test("the device API's answer is read field by field", () => {
  const parsed = accountStreamsFrom({
    account: { name: "Sharhul" },
    streams: [
      { id: "s1", name: "Hall", server: "rtmp://i.example:1935/live", key: "k1", w: 1920, h: 1080, fps: 60, bitrate: "6000k", mode: "rtmp" },
      { id: "s2", name: "No key", server: "rtmp://i.example:1935/live" },
      { id: "s1", name: "Duplicate", server: "rtmp://i.example:1935/live", key: "k9" },
      { id: "s3", name: "Odd numbers", server: "rtmp://i.example:1935/live", key: "k3", w: -1, fps: "x", bitrate: "lots" },
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.account, "Sharhul");
  assert.deepEqual(parsed.streams.map((s) => s.id), ["s1", "s3"]);
  assert.equal(parsed.streams[0].videoBitrate, 6_000_000);
  assert.equal(parsed.streams[0].height, 1080);
  assert.equal(parsed.streams[1].width, DEFAULT_SETTINGS.width);
  assert.equal(parsed.streams[1].fps, DEFAULT_SETTINGS.fps);
  assert.equal(parsed.streams[1].videoBitrate, DEFAULT_SETTINGS.videoBitrate);
});

test("an answer that is not the list is not read as an empty account", () => {
  assert.equal(accountStreamsFrom(null), null);
  assert.equal(accountStreamsFrom({ error: "nope" }), null);
  assert.deepEqual(accountStreamsFrom({ streams: [] })?.streams, []);
});

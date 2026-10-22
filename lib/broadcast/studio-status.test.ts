import assert from "node:assert/strict";
import { test } from "node:test";

import { isSettled, platformChips, studioStatusFrom } from "./studio-status.ts";

/**
 * What the chip beside the uptime says, from what `/api/control/status`
 * answers. The case it exists for is the second test: video flowing for most
 * of a minute and the YouTube event still not live.
 */

const open = (platforms: { platform: string; status: string }[]) => ({
  open: true,
  waiting: false,
  platforms,
});

test("only an answer that parses is believed", () => {
  assert.equal(studioStatusFrom(null), null);
  assert.equal(studioStatusFrom({ platforms: [] }), null);
  assert.deepEqual(studioStatusFrom({ open: false, platforms: [] }), {
    open: false,
    waiting: false,
    platforms: [],
  });
  assert.deepEqual(
    studioStatusFrom({ open: true, waiting: true, platforms: [{ platform: "youtube" }, { platform: "youtube", status: "live" }] }),
    { open: true, waiting: true, platforms: [{ platform: "youtube", status: "live" }] },
  );
});

test("YouTube short of live is starting at first, and amber once the phone has been up a while", () => {
  for (const status of ["created", "ready", "testStarting", "testing", "liveStarting"]) {
    assert.deepEqual(platformChips(open([{ platform: "youtube", status }]), false), [
      { name: "YouTube", word: "starting", tone: "plain" },
    ]);
    assert.deepEqual(platformChips(open([{ platform: "youtube", status }]), true), [
      { name: "YouTube", word: "waiting", tone: "warn" },
    ]);
  }
});

test("live is live, and an event that ended under a sending phone is amber too", () => {
  assert.deepEqual(platformChips(open([{ platform: "youtube", status: "live" }]), true), [
    { name: "YouTube", word: "live", tone: "good" },
  ]);
  assert.deepEqual(platformChips(open([{ platform: "youtube", status: "complete" }]), true), [
    { name: "YouTube", word: "ended", tone: "warn" },
  ]);
});

test("Facebook is never polled, so only what its stored status can vouch for is shown", () => {
  assert.deepEqual(platformChips(open([{ platform: "facebook", status: "created" }]), true), []);
  assert.deepEqual(platformChips(open([{ platform: "facebook", status: "unpublished" }]), true), [
    { name: "Facebook", word: "unpublished", tone: "plain" },
  ]);
  assert.deepEqual(platformChips(open([{ platform: "facebook", status: "LIVE_NOW" }]), true), [
    { name: "Facebook", word: "live", tone: "good" },
  ]);
});

test("nothing is shown with no run open or no platform", () => {
  assert.deepEqual(platformChips(null, true), []);
  assert.deepEqual(platformChips({ open: false, waiting: false, platforms: [] }, true), []);
  assert.deepEqual(platformChips(open([]), true), []);
});

test("settled means connected for more than forty-five seconds", () => {
  assert.equal(isSettled(45), false);
  assert.equal(isSettled(46), true);
});

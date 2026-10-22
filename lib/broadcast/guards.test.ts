import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CRITICAL_BATTERY,
  type Conditions,
  guardFor,
  LOW_BATTERY,
  LOW_FREE,
  MIN_FREE,
  canStartRecording,
  minutesLeft,
  preflightGuards,
  STOP_FREE,
} from "./guards.ts";

// The extension is explicit because Node resolves this file itself, with no
// bundler in front of it - `allowImportingTsExtensions` in tsconfig is what
// keeps the type checker happy about saying so.

/**
 * The first test in this project.
 *
 * It is here rather than anywhere else because this is the one piece of the
 * guards that can be checked without a phone: what the app decides to say when
 * two things are wrong at once. Everything around it - the thermal listener,
 * the storage reading, the banner - needs a device, and the device steps are
 * written down in docs/RELIABILITY.md.
 *
 * Run with `node --test --experimental-strip-types lib/broadcast/*.test.ts`.
 */

const GB = 1024 * 1024 * 1024;

const fine: Conditions = {
  thermal: 0,
  usableBytes: 40 * GB,
  battery: 0.9,
  charging: false,
  recordingBitrate: 6_000_000,
  takeBytes: 0,
  recording: false,
  live: false,
};

test("says nothing when there is nothing to say", () => {
  assert.equal(guardFor(fine), null);
});

test("a phone on charge is not warned about its battery", () => {
  const flat = { ...fine, battery: 0.02, charging: true };
  assert.equal(guardFor(flat), null);
});

test("the battery outranks everything, because it has the shortest fuse", () => {
  const dire = {
    ...fine,
    battery: CRITICAL_BATTERY,
    thermal: 4,
    recording: true,
    usableBytes: 100 * 1024 * 1024,
  };
  const guard = guardFor(dire);
  assert.equal(guard?.id, "battery");
  assert.equal(guard?.action, "stopRecording");
});

test("a flat battery closes a recording but never the broadcast", () => {
  const guard = guardFor({ ...fine, battery: 0.03, recording: true });
  assert.equal(guard?.action, "stopRecording");
  // The wording is the promise: nothing here ends a broadcast.
  assert.ok(!/broadcast/i.test(guard?.text ?? ""));
});

test("nothing is closed when nothing is recording", () => {
  const guard = guardFor({ ...fine, battery: 0.03, recording: false });
  assert.equal(guard?.id, "battery");
  assert.equal(guard?.action, undefined);
});

test("the storage floor leaves room to copy the take, not just to close it", () => {
  // Four gigabytes written, four and a bit free: enough to finish the file and
  // nothing like enough to copy it into the video library afterwards.
  const take = 4 * GB;
  const guard = guardFor({
    ...fine,
    recording: true,
    takeBytes: take,
    usableBytes: take + STOP_FREE - 1,
  });
  assert.equal(guard?.id, "storage");
  assert.equal(guard?.action, "stopRecording");
});

test("the same free space is fine when nothing has been written yet", () => {
  assert.equal(guardFor({ ...fine, recording: true, usableBytes: 5 * GB, takeBytes: 0 }), null);
});

test("heat is not reported while nothing is being encoded", () => {
  // A phone on charge in a warm room says "severe" with the app merely open.
  // There is no encoder running to throttle, so saying so is simply false.
  assert.equal(guardFor({ ...fine, thermal: 4, live: false, recording: false }), null);
  assert.equal(guardFor({ ...fine, thermal: 4, live: true })?.id, "thermal");
  assert.equal(guardFor({ ...fine, thermal: 4, recording: true })?.id, "thermal");
});

test("heat outranks a warning about room, and room outranks a warning about heat", () => {
  const hotAndFull = {
    ...fine,
    live: true,
    thermal: 4,
    recording: true,
    usableBytes: LOW_FREE - 1,
  };
  assert.equal(guardFor(hotAndFull)?.id, "thermal", "critical heat wins over a low-room warning");

  const warmAndFull = { ...hotAndFull, thermal: 3 };
  assert.equal(guardFor(warmAndFull)?.id, "storage", "a low-room warning wins over mere heat");
});

test("a phone that merely says moderate is not reported as hot", () => {
  // The field case: a ROM that sits at moderate from the moment the screen
  // comes on. Warning about that put a banner over the picture for an hour.
  assert.equal(guardFor({ ...fine, live: true, thermal: 2 }), null);
  assert.equal(guardFor({ ...fine, live: true, thermal: 1 }), null);
});

test("a phone that cannot report its temperature is never accused of being hot", () => {
  assert.equal(guardFor({ ...fine, live: true, thermal: -1 }), null);
});

test("low storage is only a warning while something is being recorded", () => {
  assert.equal(guardFor({ ...fine, usableBytes: LOW_FREE - 1, recording: false }), null);
});

test("a low battery is the quietest of the three", () => {
  const guard = guardFor({ ...fine, battery: LOW_BATTERY });
  assert.equal(guard?.id, "battery");
  assert.equal(guard?.tone, "warn");
});

test("recording will not start without room for a take worth having", () => {
  assert.equal(canStartRecording(MIN_FREE), true);
  assert.equal(canStartRecording(MIN_FREE - 1), false);
});

test("minutes left counts what is usable, not what is free", () => {
  // 6 Mbps is 45 MB a minute. Ten minutes of room plus the floor should read
  // as ten minutes, not as whatever the whole disk would hold.
  const perMinute = (6_000_000 / 8) * 60;
  const left = minutesLeft({
    usableBytes: STOP_FREE + perMinute * 10,
    recordingBitrate: 6_000_000,
    takeBytes: 0,
  });
  assert.equal(left, "10 minutes");
});

test("with nothing to estimate from, it says so rather than doing the arithmetic", () => {
  // Record-only with no destination chosen: there is no bitrate to divide by,
  // and the arithmetic produced "About no more of recording left on this
  // phone."
  const guard = guardFor({
    ...fine,
    recording: true,
    usableBytes: LOW_FREE - 1,
    recordingBitrate: 0,
  });
  assert.equal(guard?.id, "storage");
  assert.equal(guard?.text, "This phone is nearly full.");
});

test("minutes left does not go negative or divide by zero", () => {
  assert.equal(minutesLeft({ usableBytes: 0, recordingBitrate: 6_000_000, takeBytes: 0 }), "no more");
  assert.equal(minutesLeft({ usableBytes: 40 * GB, recordingBitrate: 0, takeBytes: 0 }), "no more");
});

test("the check before going live warns about heat that guardFor keeps quiet off air", () => {
  // Off air the banner says nothing about a hot phone, rightly - but the check
  // is asking whether to start, and a phone already at severe is the answer.
  const ready = { thermal: 0, usableBytes: 40 * GB, battery: 0.9, charging: false, willRecord: false };
  assert.deepEqual(preflightGuards(ready), []);
  assert.equal(preflightGuards({ ...ready, thermal: 4 })[0]?.tone, "bad");
  assert.equal(preflightGuards({ ...ready, thermal: 3 })[0]?.tone, "warn");
  assert.deepEqual(preflightGuards({ ...ready, thermal: 2 }), []);
});

test("the check names a recording there is no room for, and only when one is asked for", () => {
  const ready = { thermal: 0, usableBytes: MIN_FREE - 1, battery: 0.9, charging: false, willRecord: false };
  assert.deepEqual(preflightGuards(ready), []);
  assert.equal(preflightGuards({ ...ready, willRecord: true })[0]?.id, "storage");
  // A phone that did not answer is not a full one.
  assert.deepEqual(preflightGuards({ ...ready, willRecord: true, usableBytes: 0 }), []);
});

test("the check lists every problem, worst first, and says one thing about the battery", () => {
  const lines = preflightGuards({
    thermal: 3,
    usableBytes: 40 * GB,
    battery: CRITICAL_BATTERY,
    charging: false,
    willRecord: false,
  });
  assert.deepEqual(
    lines.map((line) => `${line.id}:${line.tone}`),
    ["battery:bad", "thermal:warn"],
  );
  const low = preflightGuards({ thermal: 0, usableBytes: 40 * GB, battery: LOW_BATTERY, charging: false, willRecord: false });
  assert.deepEqual(low.map((line) => `${line.id}:${line.tone}`), ["battery:warn"]);
  assert.deepEqual(
    preflightGuards({ thermal: 0, usableBytes: 40 * GB, battery: 0.02, charging: true, willRecord: false }),
    [],
  );
});

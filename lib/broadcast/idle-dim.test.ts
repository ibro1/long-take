import assert from "node:assert/strict";
import { test } from "node:test";

import { IdleClock } from "./idle-dim.ts";

test("dims after the quiet spell, not before", () => {
  const clock = new IdleClock(30_000, 0);
  assert.equal(clock.tick(29_999), null);
  assert.equal(clock.tick(30_000), "dim");
  assert.equal(clock.isDimmed, true);
});

test("dims once, and the next touch wakes it once", () => {
  const clock = new IdleClock(30_000, 0);
  clock.tick(30_000);
  assert.equal(clock.tick(60_000), null);
  assert.equal(clock.touch(61_000), "wake");
  assert.equal(clock.touch(61_500), null);
});

test("a touch restarts the quiet spell", () => {
  const clock = new IdleClock(30_000, 0);
  assert.equal(clock.touch(20_000), null);
  assert.equal(clock.tick(30_000), null);
  assert.equal(clock.msUntilDim(30_000), 20_000);
  assert.equal(clock.tick(50_000), "dim");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { DrainEstimator } from "./battery-estimate.ts";

const MIN = 60_000;

/** One percent a minute from `start`, sampled every 30 s for `minutes`. */
function draining(estimator: DrainEstimator, start: number, minutes: number, t0 = 0) {
  for (let s = 0; s <= minutes * 2; s++) {
    estimator.sample(start - s * 0.005, false, t0 + s * 30_000);
  }
}

test("nothing under two minutes of data", () => {
  const e = new DrainEstimator();
  draining(e, 0.5, 1.5);
  assert.equal(e.minutesLeft(), null);
});

test("a steady drain gives level over rate", () => {
  const e = new DrainEstimator();
  draining(e, 0.5, 4);
  // 0.46 left at 1% a minute.
  assert.equal(e.minutesLeft(), 46);
});

test("nothing while charging, and charging clears the history", () => {
  const e = new DrainEstimator();
  draining(e, 0.5, 4);
  e.sample(0.46, true, 5 * MIN);
  assert.equal(e.minutesLeft(), null);
  e.sample(0.47, false, 6 * MIN);
  e.sample(0.47, false, 7 * MIN);
  assert.equal(e.minutesLeft(), null, "one minute of fresh data is not enough");
});

test("nothing when the level is flat or rising", () => {
  const e = new DrainEstimator();
  for (let m = 0; m <= 4; m++) e.sample(0.5, false, m * MIN);
  assert.equal(e.minutesLeft(), null);
});

test("only the last five minutes count", () => {
  const e = new DrainEstimator();
  // Ten minutes flat, then five draining at 1% a minute: the flat part has
  // aged out, so the estimate is the drain alone.
  for (let m = 0; m <= 10; m++) e.sample(0.6, false, m * MIN);
  for (let m = 1; m <= 5; m++) e.sample(0.6 - m * 0.01, false, (10 + m) * MIN);
  assert.equal(e.minutesLeft(), 55);
});

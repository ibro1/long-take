import assert from "node:assert/strict";
import { test } from "node:test";

import { ladderEffects, nextStep, STEP_DOWN_AFTER_MS, stepFor } from "./thermal-ladder.ts";

const LONG_AGO = 0;
const NOW = 10 * 60_000;

test("the thermal status maps to a step: moderate 1, severe 2, critical 3", () => {
  assert.deepEqual([-1, 0, 1, 2, 3, 4].map(stepFor), [0, 0, 0, 1, 2, 3]);
});

test("goes up at once, straight to the step called for, however recent the last change", () => {
  assert.equal(nextStep(0, 2, NOW, NOW), 1);
  assert.equal(nextStep(0, 4, NOW, NOW), 3);
  assert.equal(nextStep(1, 3, NOW, NOW - 1), 2);
});

test("comes down one step at a time, even when the phone has cooled right off", () => {
  assert.equal(nextStep(3, 0, NOW, LONG_AGO), 2);
  assert.equal(nextStep(2, 0, NOW, LONG_AGO), 1);
  assert.equal(nextStep(1, 0, NOW, LONG_AGO), 0);
});

test("does not come down until a minute has passed since the last change", () => {
  assert.equal(nextStep(2, 0, NOW, NOW - STEP_DOWN_AFTER_MS + 1), 2);
  assert.equal(nextStep(2, 0, NOW, NOW - STEP_DOWN_AFTER_MS), 1);
});

test("hysteresis: each step down needs a status low enough for the step below", () => {
  assert.equal(nextStep(3, 4, NOW, LONG_AGO), 3);
  assert.equal(nextStep(3, 3, NOW, LONG_AGO), 2);
  assert.equal(nextStep(2, 3, NOW, LONG_AGO), 2);
  assert.equal(nextStep(2, 2, NOW, LONG_AGO), 1);
  assert.equal(nextStep(1, 2, NOW, LONG_AGO), 1);
  assert.equal(nextStep(1, 1, NOW, LONG_AGO), 0);
  assert.equal(nextStep(0, 1, NOW, LONG_AGO), 0);
});

test("an unknown status changes nothing, up or down", () => {
  for (const step of [0, 1, 2, 3] as const) {
    assert.equal(nextStep(step, -1, NOW, LONG_AGO), step);
  }
});

test("effects accumulate up the ladder", () => {
  assert.deepEqual(ladderEffects(0), {
    aidsOff: false, spotMeterIntervalMs: 320, levelMeterFps: 30, bitrateCap: 1,
    quietHud: false, dimIdle: false, minimal: false,
  });
  assert.deepEqual(ladderEffects(1), {
    aidsOff: true, spotMeterIntervalMs: 1000, levelMeterFps: 5, bitrateCap: 1,
    quietHud: false, dimIdle: false, minimal: false,
  });
  assert.deepEqual(ladderEffects(2), {
    aidsOff: true, spotMeterIntervalMs: 1000, levelMeterFps: 5, bitrateCap: 0.7,
    quietHud: true, dimIdle: true, minimal: false,
  });
  assert.deepEqual(ladderEffects(3), {
    aidsOff: true, spotMeterIntervalMs: 1000, levelMeterFps: 5, bitrateCap: 0.7,
    quietHud: true, dimIdle: true, minimal: true,
  });
});

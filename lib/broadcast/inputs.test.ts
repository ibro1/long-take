import assert from "node:assert/strict";
import { test } from "node:test";

import type { AudioDevice } from "@/modules/framevane-broadcaster";

import { autoPickInput } from "./inputs.ts";

const device = (
  id: number,
  kind: AudioDevice["kind"],
  name = `mic ${id}`,
  current = false,
): AudioDevice => ({ id, name, kind, current });

test("takes the USB receiver over everything else", () => {
  const devices = [
    device(1, "builtin", "Phone microphone", true),
    device(2, "bluetooth", "AirPods"),
    device(3, "wired", "Lapel"),
    device(4, "usb", "Wireless receiver"),
  ];
  assert.equal(autoPickInput(devices, null)?.id, 4);
});

test("wired beats Bluetooth, which still beats the phone's own microphone", () => {
  assert.equal(
    autoPickInput([device(1, "builtin", "Phone microphone", true), device(3, "wired"), device(2, "bluetooth")], null)?.id,
    3,
  );
  assert.equal(
    autoPickInput([device(1, "builtin", "Phone microphone", true), device(2, "bluetooth")], null)?.id,
    2,
  );
});

test("a remembered microphone wins over the ranking", () => {
  const devices = [device(2, "bluetooth", "Headset"), device(4, "usb", "Wireless receiver")];
  assert.equal(autoPickInput(devices, { kind: "bluetooth", name: "Headset" })?.id, 2);
});

test("a remembered microphone that is not attached does not win", () => {
  const devices = [device(4, "usb", "Wireless receiver")];
  assert.equal(autoPickInput(devices, { kind: "bluetooth", name: "Headset" })?.id, 4);
});

test("nothing external attached is nothing to do", () => {
  assert.equal(autoPickInput([device(1, "builtin", "Phone microphone", true)], null), null);
});

/**
 * Selecting a microphone that is already selected stops and restarts it, and
 * this runs on every device report - the ones that arrive mid-broadcast too.
 */
test("the microphone already in use is not re-selected", () => {
  assert.equal(autoPickInput([device(4, "usb", "Receiver", true)], null), null);
});

test("an input the app cannot name is never taken on its own", () => {
  const devices = [device(1, "builtin", "Phone microphone", true), device(9, "other", "Microphone - PEGM10")];
  assert.equal(autoPickInput(devices, null), null);
});
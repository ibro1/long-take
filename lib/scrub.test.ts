import assert from "node:assert/strict";
import { test } from "node:test";

import { scrub } from "./scrub.ts";

/**
 * The rule every log line, crash report and support paste goes through. The
 * inputs are the shapes the app really produces: endpoints from `endpointFor`,
 * pairing links from the dashboard's QR code, and the header the overlay
 * routes are called with.
 */

test("a pairing link loses its whole query, token and key alike", () => {
  const out = scrub(
    "Could not read framevane://pair?server=rtmp://host:1935/live&key=sk_live_123&token=ct_abc&api=https://studio.example/api",
  );
  assert.equal(out, "Could not read framevane://pair?<redacted>");
  assert.ok(!out.includes("sk_live_123"));
  assert.ok(!out.includes("ct_abc"));
});

test("a pairing link in the middle of a line leaves the rest of the line alone", () => {
  assert.equal(
    scrub("scanned framevane://pair?key=abc&token=def then gave up"),
    "scanned framevane://pair?<redacted> then gave up",
  );
});

test("the control token on its own is redacted, under either name", () => {
  assert.equal(scrub("GET /overlays?token=ct_abc&x=1"), "GET /overlays?token=<redacted>&x=1");
  assert.equal(scrub("?controlToken=ct_abc"), "?controlToken=<redacted>");
});

test("the api parameter that goes with a token is redacted too", () => {
  assert.equal(scrub("&api=https://studio.example/api"), "&api=<redacted>");
});

test("a bearer header keeps the word and loses the token", () => {
  assert.equal(
    scrub("Authorization: Bearer ct_abc.def-123"),
    "Authorization: Bearer <redacted>",
  );
});

test("the RTMP key in the last path segment still goes", () => {
  assert.equal(scrub("rtmp://host:1935/live/sk_live_123"), "rtmp://host:1935/live/<key>");
  assert.equal(scrub("rtmps://host/sk_live_123"), "rtmps://host/<key>");
});

test("an SRT endpoint loses the encoded stream id", () => {
  const out = scrub("srt://host:8890?streamid=publish%3Alive%2Fsk_live_123&latency=2000000");
  assert.ok(!out.includes("sk_live_123"));
  assert.match(out, /streamid=<redacted>/);
  // Latency is a setting, not a credential, and it is what a support reply asks about.
  assert.match(out, /latency=2000000/);
});

test("ordinary text is left exactly as it was", () => {
  const line = "Connected at 2500 kbps, H264; the token bucket is full";
  assert.equal(scrub(line), line);
});

test("the account-link token is redacted wherever it turns up", () => {
  const out = scrub('claim answered {"device":{"token":"fvd_AbC-12_xyz","name":"Hall"}}');
  assert.ok(!out.includes("AbC-12_xyz"));
  assert.ok(out.includes("fvd_<redacted>"));
  assert.equal(scrub("Authorization: Bearer fvd_AbC"), "Authorization: Bearer <redacted>");
});

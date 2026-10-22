import assert from "node:assert/strict";
import { test } from "node:test";

import { plainFailure, UNKNOWN_FAILURE } from "./failure.ts";
import { topBanner } from "./banners.ts";
import { formatKbps } from "./units.ts";

/**
 * The sentences the failure banner says instead of an exception. The inputs
 * are the shapes RootEncoder and Android actually produce; the raw text still
 * goes to the log, which is not tested here because it never passes through
 * this file.
 */

test("a refused socket is the server not listening, even when the line mentions auth", () => {
  const raw =
    "Connection failed: java.net.ConnectException: failed to connect to /203.0.113.4 (port 1935) after 5000ms: isConnected failed: ECONNREFUSED (Connection refused)";
  assert.match(plainFailure(raw), /turned the connection away/);
});

test("the common causes each get their own sentence", () => {
  assert.match(plainFailure("java.net.SocketTimeoutException: timeout"), /did not answer in time/);
  assert.match(plainFailure("No response from server"), /did not answer in time/);
  assert.match(
    plainFailure("java.net.UnknownHostException: Unable to resolve host \"live.example\": No address associated with hostname"),
    /name could not be found/,
  );
  assert.match(plainFailure("connect failed: ENETUNREACH (Network is unreachable)"), /no route/);
  assert.match(plainFailure("no route to host"), /no route/);
  assert.match(plainFailure("Endpoint malformed, should be: rtmp://ip:port/appname/streamname"), /not one this app can use/);
  assert.match(plainFailure("Auth error"), /stream key/);
  assert.match(plainFailure("Handshake failed"), /would not finish connecting/);
});

test("anything unrecognised says so and points at the log, never at the raw words", () => {
  assert.equal(plainFailure(""), UNKNOWN_FAILURE);
  assert.equal(plainFailure("java.lang.IllegalStateException: something new"), UNKNOWN_FAILURE);
});

test("one banner, ranked by what the audience is losing", () => {
  assert.equal(topBanner({}), null);
  assert.equal(topBanner({ congestion: true, guard: true }), "guard");
  assert.equal(topBanner({ congestion: true, micSilence: true, stall: true }), "stall");
  assert.equal(topBanner({ stall: true, failure: true }), "failure");
  assert.equal(topBanner({ guard: false, congestion: true }), "congestion");
});

test("every bitrate reads in kbps", () => {
  assert.equal(formatKbps(800_000), "800 kbps");
  assert.equal(formatKbps(2_480_123), "2480 kbps");
  assert.equal(formatKbps(0), "0 kbps");
  assert.equal(formatKbps(Number.NaN), "0 kbps");
});

test("a server that keeps dropping the broadcast is named as such, not as one more blip", () => {
  const text = plainFailure(
    "The server keeps dropping the broadcast seconds after accepting it, so the phone has stopped retrying",
  );
  assert.match(text, /stopped retrying/);
  assert.notEqual(text, UNKNOWN_FAILURE);
});

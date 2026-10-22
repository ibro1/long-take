/**
 * Why a broadcast failed, in a sentence an operator can act on.
 *
 * The banner used to print whatever the encoder said, which is a Java
 * exception: "Connection failed: java.net.ConnectException: failed to connect
 * to /203.0.113.4 (port 1935) after 5000ms: isConnected failed: ECONNREFUSED
 * (Connection refused)". Accurate, and useless to someone holding a camera in
 * front of a waiting class - the one word that matters is at the end of a
 * line they will not read to the end of.
 *
 * So the common causes are recognised and said plainly, with the thing to
 * check. The raw words are not lost: the native side and `start` both write
 * them into the log, and the banner offers the log beside its retry. Anything
 * not recognised here says so and points there, rather than guessing.
 *
 * Pure, so the mapping is tested without a phone - and ordered, because one
 * exception can carry two of these words and the first match is the more
 * specific cause.
 */

import { en } from "../i18n/en.ts";
import { type StringKey, t } from "../i18n/translate.ts";

/**
 * The sentences themselves live in the string table (lib/i18n), so the banner
 * can say them in Hausa or Arabic; what is decided here is which one.
 */
type Cause = { test: RegExp; key: StringKey };

const CAUSES: Cause[] = [
  {
    // The phone's own verdict, not an encoder's: it gave up on a server that
    // kept accepting the connection and dropping it. First, so that no rule
    // below written for an encoder's words can claim it.
    test: /keeps dropping the broadcast/i,
    key: "failure.flapping",
  },
  {
    // Before the auth rule: a refused socket is the server not listening, not
    // the server judging the key.
    test: /econnrefused|connection refused/i,
    key: "failure.refused",
  },
  {
    test: /unable to resolve host|unknownhost|no address associated|eai_|nodename|invalid host/i,
    key: "failure.dns",
  },
  {
    test: /network is unreachable|enetunreach|no route to host|ehostunreach/i,
    key: "failure.unreachable",
  },
  {
    test: /timed? ?out|timeout|no response from server/i,
    key: "failure.timeout",
  },
  {
    test: /auth|unauthori[sz]ed|forbidden|denied|stream ?key|bad key|invalid key|rejected|\b40[13]\b/i,
    key: "failure.auth",
  },
  {
    test: /endpoint malformed|malformed|invalid protocol|invalid path/i,
    key: "failure.malformed",
  },
  {
    test: /handshake/i,
    key: "failure.handshake",
  },
  {
    test: /connection reset|econnreset|broken pipe|epipe/i,
    key: "failure.reset",
  },
  {
    test: /configure/i,
    key: "failure.configure",
  },
];

/**
 * Said when nothing above matches - honest about not knowing, and where to
 * look. The English, for tests and for anything that compares against it.
 */
export const UNKNOWN_FAILURE: string = en["failure.unknown"];

export function plainFailure(detail: string): string {
  const raw = detail.trim();
  if (!raw) return t("failure.unknown");
  for (const cause of CAUSES) {
    if (cause.test.test(raw)) return t(cause.key);
  }
  return t("failure.unknown");
}

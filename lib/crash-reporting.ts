import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";

import { scrub } from "@/lib/scrub";

/**
 * Crash reporting, and the one rule that shapes how it is set up here.
 *
 * A broadcaster fails on someone else's phone, in a hall, while something is
 * going out live - and the operator is not going to run adb. Without this, a
 * crash in the field is simply invisible: the app closes and the only record
 * is that the stream stopped.
 *
 * It is deliberately optional. No DSN means no reporting and no error, because
 * a build of this app must not depend on an account with a third party - this
 * is a self-hosted project and someone should be able to build it without
 * signing up for anything.
 */
const dsn =
  process.env.EXPO_PUBLIC_SENTRY_DSN ??
  (Constants.expoConfig?.extra as { sentryDsn?: string } | undefined)?.sentryDsn;

export const crashReportingEnabled = Boolean(dsn) && !__DEV__;

export function startCrashReporting(): void {
  if (!crashReportingEnabled) return;

  Sentry.init({
    dsn,
    /**
     * Native crashes as well as JavaScript ones. The hard failures on this
     * project have all been native - a thread killed by an uncaught
     * InterruptedException, a camera that would not open - and those are
     * exactly the ones no JavaScript handler ever sees.
     */
    enableNative: true,
    // The whole point is the field, so name which build a report came from.
    release: Constants.expoConfig?.version ?? "unknown",
    /**
     * No performance tracing. It samples continuously, and this app spends its
     * life holding a camera and a radio open on a battery that is already the
     * constraint.
     */
    tracesSampleRate: 0,
    /**
     * A stream key is a credential and it lives in a URL this app handles
     * constantly. Anything carrying one is scrubbed before it leaves the
     * phone - a crash report is not worth handing someone the ability to
     * broadcast as you.
     */
    beforeSend(event) {
      return redact(event) as typeof event;
    },
    beforeBreadcrumb(crumb) {
      return redact(crumb) as typeof crumb;
    },
  });
}

/**
 * A copy of the event with anything that looks like a stream key or passphrase
 * taken out of it.
 *
 * A copy, and not in place, because this runs on the app's own live objects:
 * `beforeBreadcrumb` is handed the breadcrumb the app is still using, and
 * rewriting its strings would mean a failed upload quietly edited the state
 * the screen reads from. Only plain objects and arrays are rebuilt - anything
 * with a prototype of its own is left alone rather than flattened into an
 * empty object, which is what copying a Date this way would produce.
 */
function redact<T>(value: T): T {
  const copies = new Map<object, unknown>();
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return scrub(node);
    if (!node || typeof node !== "object") return node;
    // Set before descending, so a graph that points back at itself terminates.
    const seen = copies.get(node);
    if (seen !== undefined) return seen;

    if (Array.isArray(node)) {
      const copy: unknown[] = [];
      copies.set(node, copy);
      for (const item of node) copy.push(walk(item));
      return copy;
    }

    const prototype = Object.getPrototypeOf(node);
    if (prototype !== Object.prototype && prototype !== null) return node;

    const copy: Record<string, unknown> = {};
    copies.set(node, copy);
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      copy[k] = walk(v);
    }
    return copy;
  };
  return walk(value) as T;
}

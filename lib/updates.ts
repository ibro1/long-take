import * as Updates from "expo-updates";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import * as Broadcaster from "@/modules/framevane-broadcaster";

/**
 * Over-the-air updates, on the terms a broadcaster can live with.
 *
 * `fallbackToCacheTimeout: 0` means the app never waits on the network to
 * start - it launches from the bundle it already has and looks for a new one
 * behind the scenes. That is the only acceptable behaviour for an app someone
 * opens seconds before going live, and it is why this hook exists: the update
 * arrives quietly, and the decision to apply it is the operator's.
 *
 * Two rules decide everything here:
 *
 *   1. Nothing happens during a broadcast. Applying an update means reloading
 *      the JS bundle, which tears the encoder down and takes the stream off
 *      air - and a recording to the phone with it. So while either is running
 *      this hook does not download, does not prompt, and above all does not
 *      reload - it waits for both to end and picks up where it left off.
 *   2. "Later" means later. A dismissal holds for the rest of the session; the
 *      next launch asks again, and by then the update is already downloaded.
 */

export type UpdateStatus = "idle" | "checking" | "downloading" | "ready" | "error";

export type UpdatePrompt = {
  /** `ready` is the only state the UI draws anything for. */
  status: UpdateStatus;
  /** Whatever `expo-updates` refused to do, for the rare case it is worth showing. */
  error: Error | null;
  /** Apply the downloaded update by reloading. Does nothing while live. */
  accept: () => void;
  /** Not now, and not again this session. */
  dismiss: () => void;
};

/** Long enough that returning to the app repeatedly is not a network habit. */
const RECHECK_AFTER_MS = 5 * 60 * 1000;

/**
 * How often to look at whether the broadcast we are waiting on has ended.
 *
 * A minute, not two seconds. Nobody is waiting on the answer - the prompt only
 * appears once the operator is off air, and a minute's delay after a class is
 * invisible - while a two-second timer was a JS wake-up and two native calls
 * thirty times a minute for the whole of a broadcast.
 */
const BROADCAST_POLL_MS = 60_000;

/**
 * The camera, the encoder and the first render all want the phone at once on
 * launch. An update check can wait a couple of seconds for them.
 */
const FIRST_CHECK_DELAY_MS = 2_500;

/**
 * In development the bundle comes from Metro and `expo-updates` has nothing to
 * fetch; in Expo Go it is not there at all. Either way the whole flow turns
 * into a no-op rather than an exception in a release-only code path.
 */
const ENABLED = !__DEV__ && Updates.isEnabled;

/**
 * True while the encoder is pushing frames or the recorder is writing a take.
 * Synchronous and safe to call at any time - each answers false when no
 * preview is mounted - but they reach into the native module, so a build
 * without them must not take the update flow down.
 *
 * Recording counts on its own, off air included. A reload tears the encoder
 * down whatever it is feeding, and a take cut off by one is a file whose
 * muxer never wrote its index - an MP4 that plays nowhere. Asking only about
 * the stream offered the reload to an operator recording a lesson to the
 * phone, and the button that took it was labelled as harmless.
 *
 * Asked separately, so a module that throws on one still answers the other.
 */
function broadcasting(): boolean {
  let streaming = false;
  let recording = false;
  try {
    streaming = Broadcaster.isStreaming();
  } catch {
    // No preview, or no such function in this build: nothing is going out.
  }
  try {
    recording = Broadcaster.isRecording();
  } catch {
    // The same, for the recorder.
  }
  return streaming || recording;
}

export function useUpdatePrompt(): UpdatePrompt {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [error, setError] = useState<Error | null>(null);

  // Policy state. None of it belongs in React state: changing it must not
  // re-render a camera viewfinder, and the async work below reads it as it goes.
  const dismissed = useRef(false);
  const downloaded = useRef(false);
  const working = useRef(false);
  const lastCheck = useRef(0);
  const waitingOnBroadcast = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ENABLED) return;

    const stopWaiting = () => {
      if (waitingOnBroadcast.current) {
        clearInterval(waitingOnBroadcast.current);
        waitingOnBroadcast.current = null;
      }
    };

    /**
     * Hold until the broadcast ends, then carry on. Polling is the right shape
     * here: the encoder reports its own state changes to the screen that owns
     * the preview, and an update prompt has no business subscribing to those.
     */
    const waitForBroadcastToEnd = () => {
      if (waitingOnBroadcast.current) return;
      waitingOnBroadcast.current = setInterval(() => {
        if (!mounted.current || dismissed.current) {
          stopWaiting();
          return;
        }
        if (broadcasting()) return;
        stopWaiting();
        void run();
      }, BROADCAST_POLL_MS);
    };

    /** An update is in hand. Show it now, or once the phone is off air. */
    const offer = () => {
      if (!mounted.current || dismissed.current) return;
      if (broadcasting()) {
        setStatus("idle");
        waitForBroadcastToEnd();
        return;
      }
      setStatus("ready");
    };

    const run = async () => {
      if (!mounted.current || dismissed.current) return;
      if (downloaded.current) {
        offer();
        return;
      }
      if (working.current) return;
      if (broadcasting()) {
        waitForBroadcastToEnd();
        return;
      }
      if (Date.now() - lastCheck.current < RECHECK_AFTER_MS) return;

      working.current = true;
      lastCheck.current = Date.now();
      setStatus("checking");
      try {
        const check = await Updates.checkForUpdateAsync();
        if (!mounted.current || dismissed.current) return;
        if (!check.isAvailable) {
          setStatus("idle");
          return;
        }

        // The operator may well have gone live in the second that took. A
        // download competes with the uplink for the same radio, so it waits
        // too - and the throttle is cleared so the retry is not deferred.
        if (broadcasting()) {
          lastCheck.current = 0;
          setStatus("idle");
          waitForBroadcastToEnd();
          return;
        }

        setStatus("downloading");
        const fetched = await Updates.fetchUpdateAsync();
        if (!mounted.current || dismissed.current) return;
        if (!fetched.isNew) {
          setStatus("idle");
          return;
        }
        downloaded.current = true;
        offer();
      } catch (caught) {
        if (!mounted.current) return;
        // A failed check is not worth much noise: the app is running fine on
        // the bundle it has, and the next foreground tries again.
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        setStatus("error");
      } finally {
        working.current = false;
      }
    };

    const first = setTimeout(() => void run(), FIRST_CHECK_DELAY_MS);

    // Coming back to the app is the moment an update is least in the way: the
    // operator has just picked the phone up and has not started anything yet.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void run();
    });

    return () => {
      clearTimeout(first);
      stopWaiting();
      subscription.remove();
    };
  }, []);

  const accept = useCallback(() => {
    if (!ENABLED || !downloaded.current) return;
    // Last line of defence. The prompt cannot be on screen during a broadcast,
    // but a tap already in flight when the encoder started must not land.
    if (broadcasting()) {
      setStatus("idle");
      return;
    }
    Updates.reloadAsync().catch((caught: unknown) => {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught : new Error(String(caught)));
      setStatus("error");
    });
  }, []);

  const dismiss = useCallback(() => {
    dismissed.current = true;
    setStatus("idle");
    setError(null);
  }, []);

  return { status, error, accept, dismiss };
}

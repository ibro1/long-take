/**
 * The microphone level, kept outside React state on purpose.
 *
 * The level arrives about eight times a second and exactly one small component
 * draws it. Holding it in `useBroadcast`'s state made every sample re-render
 * the whole broadcast screen - viewfinder, control rail, every panel - and the
 * cost showed: measured over ten minutes on a real phone, samples arrived at a
 * flat 8.2/s throughout while the share of them React actually committed fell
 * from 83% to 56%. The microphone was fine; the screen was falling behind, and
 * a bar that updates more and more slowly is what "the meter froze" looks like
 * before it looks like anything else.
 *
 * So the level is published here and read by the meter alone. Nothing else
 * re-renders when it changes.
 */

let peak = 0;
let painted = 0;
const listeners = new Set<() => void>();

/** Called from the native level event, several times a second. */
export function publishLevel(next: number): void {
  // Identical values are not worth a render; React would bail out anyway, and
  // this saves waking every listener to find that out.
  if (next === peak) return;
  peak = next;
  for (const listener of listeners) listener();
}

export function subscribeLevel(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function levelSnapshot(): number {
  return peak;
}

/**
 * Counts renders of the meter, so the diagnostic in `useBroadcast` can still
 * say how many arriving samples reached the screen. That comparison is what
 * separates "the microphone stopped" from "the screen stopped", and moving the
 * level out of React state must not cost it.
 */
export function notePainted(): void {
  painted += 1;
}

export function takePainted(): number {
  const since = painted;
  painted = 0;
  return since;
}

/**
 * How often the broadcast screen itself re-renders.
 *
 * Kept beside the meter counters because it answers the question they raise: a
 * screen that renders many times a second is doing the work of laying out a
 * viewfinder, its controls and a native camera view over and over, and that is
 * felt as the app being slow rather than seen as anything in particular.
 */
let renders = 0;

export function noteRender(): void {
  renders += 1;
}

export function takeRenders(): number {
  const since = renders;
  renders = 0;
  return since;
}

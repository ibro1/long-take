import type { AudioDevice } from "@/modules/framevane-broadcaster";

/**
 * Which of the phone's inputs are worth offering as a microphone.
 *
 * Android lists more inputs than an app can record a lesson from, and it does
 * not say which is which - it gives a type, and this app maps the types it
 * knows onto a kind. Anything it cannot place comes back as `other`.
 *
 * `other` is not offered, and that is not tidiness. On the handset this came
 * from, the unplaceable entry - shown as "Microphone - PEGM10", the phone's own
 * model name because Android gives its model as the product name of every
 * built-in device - is selectable and then silent: the log reads "The
 * microphone started and sent nothing" on every attempt, forever, because the
 * choice is remembered across restarts. Choosing it once left the operator
 * with no audio and no way back except guessing.
 *
 * So an input this app cannot name is an input it will not recommend. The one
 * exception is an input Android says is in use right now, which is shown
 * whatever it is - a screen that hides what is actually happening is worse
 * than one that offers something odd.
 */
export function offerableInputs(devices: AudioDevice[]): AudioDevice[] {
  return devices.filter((device) => device.kind !== "other" || device.current);
}

/**
 * Whether a remembered choice is still worth applying.
 *
 * A preference outlives the device it names: the lapel microphone is unplugged,
 * the headset is off, or - the case that prompted this - the device turned out
 * not to carry audio at all. Re-applying it on every cold start is how one bad
 * tap becomes a phone that has no sound until somebody works out why.
 */
export function stillOfferable(devices: AudioDevice[], id: number): boolean {
  if (id < 0) return true;
  return offerableInputs(devices).some((device) => device.id === id);
}

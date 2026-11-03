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

/**
 * Which external microphone to take when the operator has not pinned one.
 *
 * Android will route a broadcast to the phone's own microphone while a
 * transmitter sits switched on in the operator's pocket - it does not prefer an
 * accessory, it keeps whatever the recorder already had. The failure that
 * follows is the quiet one this whole file exists to prevent: a lesson goes out
 * on the handset's microphone, picked up off the room, and nobody knows until
 * it is heard back.
 *
 * The order is a judgement about what carries a voice best, best first:
 *
 * - USB is a receiver - a wireless lavalier kit, a lapel into a dongle - and it
 *   hands over the cleanest signal without Android doing anything to it.
 * - Wired is a lapel or a handheld straight into the jack, and is next for the
 *   same reason.
 * - Bluetooth is last of the three because the phone negotiates a call-grade
 *   SCO link for it, which is narrower and noisier than the other two, but it
 *   is still a microphone in front of the teacher and beats the one across the
 *   room.
 *
 * A remembered microphone wins over all of it. `usualMic` is matched on kind
 * and name rather than by Android's id, because a Bluetooth headset comes back
 * with a new id every time it reconnects - see the note on `Preferences`.
 *
 * Returns the device to switch to, or null when there is nothing to do: no
 * external microphone is attached, or the best one is already the one in use.
 * The second half is not an optimisation. Selecting a microphone that is
 * already selected stops and restarts it, and this is called on every device
 * report - including the ones that arrive mid-broadcast.
 */
export function autoPickInput(
  devices: AudioDevice[],
  usualMic: { kind: string; name: string } | null,
): AudioDevice | null {
  const external = offerableInputs(devices).filter((device) => hasRank(device.kind));
  if (external.length === 0) return null;

  const usual = usualMic
    ? external.find(
        (device) => device.kind === usualMic.kind && device.name === usualMic.name,
      ) ?? null
    : null;
  const pick = usual ?? external.reduce((best, device) =>
        audioRank(device.kind) < audioRank(best.kind) ? device : best,
      );

  return pick.current ? null : pick;
}

const AUDIO_RANK: Partial<Record<string, number>> = {
  usb: 0,
  wired: 1,
  bluetooth: 2,
};

/** Whether a kind is an external microphone at all, and where it ranks. */
function hasRank(kind: string): boolean {
  return AUDIO_RANK[kind] !== undefined;
}

function audioRank(kind: string): number {
  return AUDIO_RANK[kind] ?? Number.MAX_SAFE_INTEGER;
}

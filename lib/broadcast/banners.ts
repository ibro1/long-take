/**
 * Which one banner the viewfinder draws.
 *
 * Five conditions each had a banner of their own, and on a bad night three of
 * them were true at once - a stall, the microphone going quiet with it, and the
 * phone warm from trying - so the top of the frame became a stack of red and
 * amber boxes covering the face being filmed, with the update prompt floating
 * over the lot. Two banners is the same as none: the operator reads neither.
 *
 * So the same rule `guardFor` applies to its own three is applied across all
 * of them: ranked by how much the audience is losing right now, and only the
 * winner drawn. The others are still true and still in the log; when the
 * winner clears, the next one up takes its place.
 *
 * - `failure`: off air, or never got there. Viewers have nothing.
 * - `stall`: on air in name, nothing leaving the phone.
 * - `micSilence`: the picture is going out with no sound.
 * - `guard`: the phone itself - heat, room, battery - which ends the
 *   broadcast later rather than now.
 * - `congestion`: going out, at less than asked for, and already being dealt
 *   with by the encoder.
 */
export type BannerId = "failure" | "stall" | "micSilence" | "guard" | "congestion";

export const BANNER_RANK: readonly BannerId[] = [
  "failure",
  "stall",
  "micSilence",
  "guard",
  "congestion",
];

export function topBanner(showing: Partial<Record<BannerId, boolean>>): BannerId | null {
  return BANNER_RANK.find((id) => showing[id]) ?? null;
}

/**
 * Bitrates, in the one unit this app speaks.
 *
 * The same number was written three ways: "800k" on the editor's chips, "2.5
 * Mbps" on the head-up display, "2500 kbps" on the destination card and in the
 * check before going live. An operator comparing what they set against what is
 * leaving had to convert between them in their head, mid-broadcast - and a
 * figure that changes unit between two screens reads as two different figures.
 * So everything goes through here, and everything says kbps.
 */
export function formatKbps(bitsPerSecond: number): string {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return "0 kbps";
  return `${Math.round(bitsPerSecond / 1000)} kbps`;
}

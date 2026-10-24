/**
 * Minutes of battery left, from how fast it is actually falling.
 *
 * A percentage is a number the operator has to turn into time while holding
 * a camera, and the conversion depends on what the phone is doing: the same
 * 30% is two hours idle and forty minutes on air with the screen up. So the
 * estimate is the drain over the last five minutes, which is the load the
 * broadcast is putting on it now.
 *
 * A least-squares slope rather than first-minus-last: Android reports level in
 * whole percent, and over a few minutes a two-point difference is mostly
 * rounding.
 */

/** How much history the slope is taken over. */
export const WINDOW_MS = 5 * 60_000;

/** Less than this and one percent step swings the answer by an hour. */
export const MIN_SPAN_MS = 2 * 60_000;

type Sample = { level: number; at: number };

export class DrainEstimator {
  private samples: Sample[] = [];
  private charging = false;

  sample(level: number, charging: boolean, at: number): void {
    this.charging = charging;
    if (charging) {
      // A drain measured across a charge describes neither.
      this.samples = [];
      return;
    }
    const last = this.samples[this.samples.length - 1];
    // A rise off the charger is a charge the flag missed; start again.
    if (last && level > last.level) this.samples = [];
    this.samples.push({ level, at });
    const from = at - WINDOW_MS;
    while (this.samples.length > 0 && this.samples[0].at < from) this.samples.shift();
  }

  minutesLeft(): number | null {
    if (this.charging || this.samples.length < 2) return null;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (last.at - first.at < MIN_SPAN_MS) return null;

    const n = this.samples.length;
    let sumT = 0;
    let sumL = 0;
    for (const s of this.samples) {
      sumT += s.at - first.at;
      sumL += s.level;
    }
    const meanT = sumT / n;
    const meanL = sumL / n;
    let num = 0;
    let den = 0;
    for (const s of this.samples) {
      const dt = s.at - first.at - meanT;
      num += dt * (s.level - meanL);
      den += dt * dt;
    }
    if (den === 0) return null;
    const drainPerMs = -num / den;
    if (drainPerMs <= 0) return null;
    // Rounded, not floored: it is "about", and float noise would otherwise
    // turn a clean 55 into 54.
    return Math.round(last.level / drainPerMs / 60_000);
  }
}

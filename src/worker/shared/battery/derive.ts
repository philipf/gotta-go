// Derives the battery indicator state from a raw millivolt reading: the OCV
// discharge curve (mV → %), quantisation to 5 fill segments, and the stateless
// charging threshold. Pure and stateless — a single reading in, no history.

export type BatteryIndicatorState = {
  segments: number; // 0–5 filled fill-cells
  charging: boolean;
};

// Generic single-cell LiPo open-circuit-voltage curve as descending
// [millivolts, percent] breakpoints — high and flat in the middle, steep at the
// ends, so a linear map would over-report a nearly-flat pack. The radiator
// samples mV before Wi-Fi starts (low load), so a resting-voltage table is a
// fair fit. First-pass numbers — tune live on the panel per ADR-0009; the curve
// is display-only, never a contract.
const OCV: ReadonlyArray<readonly [mv: number, pct: number]> = [
  [4200, 100],
  [4100, 87],
  [4000, 75],
  [3900, 60],
  [3800, 45],
  [3700, 28],
  [3600, 13],
  [3500, 5],
  [3300, 0],
];

// Linear interpolation across the OCV breakpoints, clamped to 0–100 outside the
// table's ends (above full reads 100; below cutoff reads 0).
export function percentFromMv(mv: number): number {
  if (mv >= OCV[0][0]) return OCV[0][1];
  const last = OCV[OCV.length - 1];
  if (mv <= last[0]) return last[1];

  for (let i = 1; i < OCV.length; i++) {
    const [loMv, loPct] = OCV[i];
    if (mv >= loMv) {
      const [hiMv, hiPct] = OCV[i - 1];
      const t = (mv - loMv) / (hiMv - loMv);
      return loPct + t * (hiPct - loPct);
    }
  }
  return last[1];
}

// The number of discrete fill cells in the glyph. Coarse on purpose: with no
// previous reading we cannot apply hysteresis, so few boundaries keep ADC jitter
// from flapping the bucket (and the ETag) near a threshold.
export const SEGMENT_COUNT = 5;

// Stateless wall-power detection: a reading at or above this rests too high for
// an unplugged pack, so we read it as charging. Tuned down from 4250 → 4200
// after a live LilyGO read 4229 mV on USB-C (#131 fast-follow): the charger on
// this board barely lifts a near-full pack above its resting voltage, so 4250
// never tripped. Blind spot is now the inverse: a freshly-unplugged full battery
// can briefly settle ~4.2 V and read as charging until it sags. Closing both
// ends needs a rose-since-last-wake trend (GH #133), which needs the previous
// reading we deliberately do not keep here.
const CHARGING_MV = 4200;

// An absent reading (failed ADC read, or firmware that does not send the header)
// is not an empty battery, so the indicator is hidden rather than shown empty.
export function deriveBatteryIndicator(mv: number | undefined): BatteryIndicatorState | null {
  if (mv === undefined) return null;
  const pct = percentFromMv(mv);
  const segments = clamp(Math.round((pct / 100) * SEGMENT_COUNT), 0, SEGMENT_COUNT);
  return { segments, charging: mv >= CHARGING_MV };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

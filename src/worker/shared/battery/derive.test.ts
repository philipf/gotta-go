import { describe, it, expect } from 'vitest';
import { deriveBatteryIndicator, percentFromMv } from './derive';

describe('deriveBatteryIndicator', () => {
  it('returns null when the reading is absent (hide the indicator)', () => {
    expect(deriveBatteryIndicator(undefined)).toBeNull();
  });

  it('quantises the curve percentage to 0-5 fill segments', () => {
    expect(deriveBatteryIndicator(4200)?.segments).toBe(5); // 100% → full
    expect(deriveBatteryIndicator(3300)?.segments).toBe(0); // 0% → empty
    expect(deriveBatteryIndicator(3800)?.segments).toBe(2); // 45% → round(2.25)
  });

  it('flags charging at/above the wall-power threshold, not below', () => {
    expect(deriveBatteryIndicator(4250)?.charging).toBe(true);
    expect(deriveBatteryIndicator(4300)?.charging).toBe(true);
    expect(deriveBatteryIndicator(4100)?.charging).toBe(false);
    expect(deriveBatteryIndicator(3700)?.charging).toBe(false);
  });
});

describe('percentFromMv (OCV discharge curve)', () => {
  it('clamps to 100% at and above a full LiPo, 0% at and below the cutoff', () => {
    expect(percentFromMv(4200)).toBe(100);
    expect(percentFromMv(4500)).toBe(100); // above full (e.g. on charger)
    expect(percentFromMv(3300)).toBe(0);
    expect(percentFromMv(3000)).toBe(0); // below cutoff
  });

  it('rises monotonically with voltage and interpolates between breakpoints', () => {
    const samples = [3300, 3450, 3600, 3750, 3900, 4050, 4200];
    const pcts = samples.map(percentFromMv);
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i]).toBeGreaterThan(pcts[i - 1]);
    }
    // A mid-range voltage between two breakpoints lands strictly between them,
    // not snapped to either — i.e. the curve actually interpolates.
    const mid = percentFromMv(3850); // between 3800→45 and 3900→60
    expect(mid).toBeGreaterThan(45);
    expect(mid).toBeLessThan(60);
  });
});

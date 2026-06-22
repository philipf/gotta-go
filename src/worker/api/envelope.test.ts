import { describe, it, expect } from 'vitest';
import { buildFrameEnvelope } from './envelope';

const baseInit = {
  profilePhase: 'morning_school_run',
  layout: 'priority_split_v2',
  serverTime: new Date('2026-05-23T06:48:12Z'),
  viewModel: { wall_clock: '07:30', columns: [{ mode: 'bus' }] },
};

describe('api.envelope.buildFrameEnvelope', () => {
  it('leads with the diagnostics fields then spreads the view model', () => {
    const envelope = buildFrameEnvelope({ ...baseInit, bmp: null });

    expect(envelope).toEqual({
      profile_phase: 'morning_school_run',
      layout: 'priority_split_v2',
      server_time: '2026-05-23T06:48:12.000Z',
      wall_clock: '07:30',
      columns: [{ mode: 'bus' }],
    });
  });

  it('omits frame_bmp_base64 when no BMP was rendered', () => {
    const envelope = buildFrameEnvelope({ ...baseInit, bmp: null });
    expect(envelope).not.toHaveProperty('frame_bmp_base64');
  });

  it('encodes frame_bmp_base64 so it decodes byte-identically to the BMP', () => {
    // A short stand-in for the raw BMP bytes a sibling image/bmp call returns.
    const bmp = new Uint8Array([0x42, 0x4d, 0x00, 0xff, 0x10, 0x80]);

    const envelope = buildFrameEnvelope({ ...baseInit, bmp });

    const b64 = envelope.frame_bmp_base64 as string;
    const decoded = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bmp);
  });
});

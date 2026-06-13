import { describe, it, expect } from 'vitest';
import { modeIcon, modeIconSvg, MODE_GRIDS, onCells } from './mode-icon';

// The Satori/resvg/yoga-wasm raster path is blocked in the workers-pool sandbox
// (ADR-0005), so these tests cover the pure SVG-building logic. Crisp
// rasterisation is proven in poc/satori-mode-icons and verified live via
// `wrangler dev`.
describe('modeIconSvg', () => {
  it('renders the bus grid as integer-snapped 5:8 cells (Ph=8 -> 70x80 px)', () => {
    const svg = modeIconSvg('bus', 8); // Pw = round(8 * 5/8) = 5
    expect(svg).toContain('viewBox="0 0 14 10"');
    expect(svg).toContain('preserveAspectRatio="none"');
    expect(svg).toContain('width="70"'); // 14 cols × Pw(5)
    expect(svg).toContain('height="80"'); // 10 rows × Ph(8)
    const rects = svg.match(/<rect /g)?.length ?? 0;
    expect(rects).toBe(onCells(MODE_GRIDS.bus));
  });

  it('snaps the 5:8 cell width to a whole device pixel (Ph=10 -> Pw=6, not 6.25)', () => {
    const svg = modeIconSvg('bus', 10); // 10 * 5/8 = 6.25 -> rounds to 6
    expect(svg).toContain('width="84"'); // 14 cols x Pw(6)
    expect(svg).toContain('height="100"'); // 10 rows x Ph(10)
    expect(svg).not.toMatch(/\d\.\d/); // no fractional coordinates anywhere
  });
});

describe('modeIcon', () => {
  it('returns an <img> sized to the grid with the SVG inlined as a base64 data URI', () => {
    const el = modeIcon({ mode: 'train', height: 8 });
    const props = el.props as { src: string; width: number; height: number };
    expect(el.type).toBe('img');
    expect(props.width).toBe(70); // 14 cols x Pw(5)
    expect(props.height).toBe(96); // 12 rows x Ph(8)
    expect(props.src).toMatch(/^data:image\/svg\+xml;base64,/);
    const decoded = atob(props.src.split(',')[1]);
    expect(decoded).toBe(modeIconSvg('train', 8));
  });
});

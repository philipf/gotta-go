// The battery indicator glyph: a phone-style battery outline with a 5-cell fill
// and, when charging, a lightning bolt knocked out over it. A pure, fixed-size
// React/JSX box that self-positions in the frame's top-right corner — features
// just drop {battery ? batteryIndicator(battery) : null} into their layout root;
// the null guard at the call site is the hide-when-absent behaviour.
//
// 1-bit e-ink: pure black on white, no greys. Filled cells are solid black; the
// charging bolt carries a white stroke so it reads over both filled (black) and
// empty (white) cells — the smartphone knock-out look. Geometry is a first pass;
// tune live on the panel per ADR-0009.

import type { ReactNode } from 'react';
import type { BatteryIndicatorState } from './derive';
import { SEGMENT_COUNT } from './derive';

const BLACK = '#000';
const WHITE = '#fff';

// Top-right inset and glyph sizing.
const INSET = 16;
const BODY_W = 60;
const BODY_H = 28;
const BORDER = 3;
const CELL_GAP = 2;
const CAP_W = 4; // the positive-terminal nub
const CAP_H = 12;

// Lightning bolt as an inline SVG data-uri: black fill for the body, a white
// stroke for the halo so it survives on top of solid-black filled cells.
const BOLT =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 32' width='24' height='32'%3E%3Cpath d='M14 1 L4 18 L11 18 L9 31 L20 12 L13 12 Z' fill='black' stroke='white' stroke-width='2.5' stroke-linejoin='round'/%3E%3C/svg%3E";
// Kept a touch shorter than the body interior so it clears both border lines;
// the viewBox is 0.75 wide, so width tracks height to avoid distortion.
const BOLT_H = 28;
const BOLT_W = Math.round(BOLT_H * 0.75);

export function batteryIndicator(state: BatteryIndicatorState): ReactNode {
  return (
    <div
      style={{
        position: 'absolute',
        top: INSET,
        right: INSET,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      {/* Body: a bordered rounded rect of SEGMENT_COUNT equal cells, the first
          `segments` filled black. position relative so the bolt can overlay it. */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'stretch',
          width: BODY_W,
          height: BODY_H,
          border: `${BORDER}px solid ${BLACK}`,
          borderRadius: 5,
          padding: BORDER,
          gap: CELL_GAP,
          backgroundColor: WHITE,
        }}
      >
        {Array.from({ length: SEGMENT_COUNT }, (_unused, i) => (
          <div
            key={i}
            style={{
              flexGrow: 1,
              flexBasis: 0,
              backgroundColor: i < state.segments ? BLACK : WHITE,
            }}
          />
        ))}
        {state.charging ? (
          // A flex overlay stretched over the body interior centres the bolt
          // regardless of the border/padding box model — manual top/left offsets
          // measured against the padding box drifted the bolt below the bottom
          // line.
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img src={BOLT} width={BOLT_W} height={BOLT_H} />
          </div>
        ) : null}
      </div>
      {/* Positive-terminal nub on the right edge. */}
      <div
        style={{
          width: CAP_W,
          height: CAP_H,
          backgroundColor: BLACK,
          borderTopRightRadius: 2,
          borderBottomRightRadius: 2,
        }}
      />
    </div>
  );
}

import type { ReactNode } from 'react';
import { WIDTH, HEIGHT } from './bmp';

const FAMILY = 'Press Start 2P';
const BLACK = '#000';
const WHITE = '#fff';

const PANEL_TOP = 70;
const PANEL_HEIGHT = 450;

type TxtProps = {
	left: number;
	baseline: number;
	size: number;
	color?: string;
	children: string;
};

// `baseline` is the SVG <text y=...> coordinate (text baseline). Satori uses
// top-left positioning, so we offset by ~0.8 of font-size to align visually
// — Press Start 2P has cap-height ≈ font-size and no descenders.
function Txt({ left, baseline, size, color = BLACK, children }: TxtProps) {
	return (
		<div
			style={{
				position: 'absolute',
				left,
				top: baseline - size,
				fontFamily: FAMILY,
				fontSize: size,
				color,
				lineHeight: 1,
			}}
		>
			{children}
		</div>
	);
}

type PanelProps = {
	left: number;
	width: number;
	headline: string;
	by: string;
	arrives: string;
	markerLocalX: number;
	lineLocalEndX: number;
	next: string;
};

function Panel({ left, width, headline, by, arrives, markerLocalX, lineLocalEndX, next }: PanelProps) {
	return (
		<div
			style={{
				position: 'absolute',
				left,
				top: PANEL_TOP,
				width,
				height: PANEL_HEIGHT,
				border: `2px solid ${BLACK}`,
				display: 'flex',
			}}
		>
			<Txt left={20} baseline={40} size={14}>LEAVE IN</Txt>
			<Txt left={20} baseline={170} size={80}>{headline}</Txt>
			<Txt left={20} baseline={230} size={14}>{by}</Txt>
			<Txt left={20} baseline={260} size={12}>{arrives}</Txt>
			<div
				style={{
					position: 'absolute',
					left: 20,
					top: 329,
					width: lineLocalEndX - 20,
					height: 2,
					backgroundColor: BLACK,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: markerLocalX - 10,
					top: 320,
					width: 20,
					height: 20,
					borderRadius: 10,
					backgroundColor: BLACK,
				}}
			/>
			<Txt left={20} baseline={380} size={14}>{next}</Txt>
		</div>
	);
}

export function buildLayout(): ReactNode {
	return (
		<div
			style={{
				width: WIDTH,
				height: HEIGHT,
				backgroundColor: WHITE,
				position: 'relative',
				display: 'flex',
			}}
		>
			<div
				style={{
					position: 'absolute',
					left: 0,
					top: 0,
					width: WIDTH,
					height: 48,
					backgroundColor: BLACK,
					display: 'flex',
					justifyContent: 'center',
					alignItems: 'center',
				}}
			>
				<div
					style={{
						fontFamily: FAMILY,
						fontSize: 16,
						color: WHITE,
						lineHeight: 1,
					}}
				>
					GOTTAGO BMP TEST
				</div>
			</div>

			<Panel
				left={20}
				width={460}
				headline="7 MIN"
				by="BY 08:14"
				arrives="ARRIVES 12 MIN  08:21"
				markerLocalX={300}
				lineLocalEndX={440}
				next="NEXT 08:42"
			/>
			<Panel
				left={500}
				width={440}
				headline="NOW"
				by="BY 08:09"
				arrives="ARRIVES 15 MIN  08:24"
				markerLocalX={420}
				lineLocalEndX={420}
				next="NEXT 09:09"
			/>
		</div>
	);
}

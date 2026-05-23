import type { ReactNode } from 'react';
import { jsxToSvg, svgToRgba } from '../../shared/satori/index';
import { rgbaTo1BitBmp, WIDTH, HEIGHT } from '../../shared/bmp/index';
import type { ViewModel } from './viewmodel';

const FAMILY = 'Press Start 2P';
const BLACK = '#000';
const WHITE = '#fff';

const TIME_SIZE = 160;
const DATE_SIZE = 60;

function layout(vm: ViewModel): ReactNode {
	return (
		<div
			style={{
				width: WIDTH,
				height: HEIGHT,
				backgroundColor: WHITE,
				color: BLACK,
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'center',
				alignItems: 'center',
				fontFamily: FAMILY,
			}}
		>
			<div style={{ fontSize: TIME_SIZE, lineHeight: 1 }}>{vm.time}</div>
			<div style={{ fontSize: DATE_SIZE, lineHeight: 1, marginTop: 48 }}>
				{vm.date}
			</div>
		</div>
	);
}

export async function renderBmp(vm: ViewModel): Promise<Uint8Array> {
	const svg = await jsxToSvg(layout(vm));
	const rgba = await svgToRgba(svg);
	return rgbaTo1BitBmp(rgba);
}

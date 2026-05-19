import { rgbaTo1BitBmp } from './bmp';
import { buildLayout } from './layout';
import { jsxToSvg, svgToRgba } from './render';

export default {
	async fetch(_request, _env, _ctx): Promise<Response> {
		const svg = await jsxToSvg(buildLayout());
		const rgba = await svgToRgba(svg);
		const bmp = rgbaTo1BitBmp(rgba);
		return new Response(bmp, {
			headers: {
				'content-type': 'image/bmp',
				'x-sleep-seconds': '120',
			},
		});
	},
} satisfies ExportedHandler<Env>;

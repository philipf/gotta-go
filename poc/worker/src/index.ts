import { rgbaTo1BitBmp } from './bmp';
import { renderSvgToRgba } from './render';
import { inputSvg } from './svg';

export default {
	async fetch(_request, _env, _ctx): Promise<Response> {
		const rgba = await renderSvgToRgba(inputSvg);
		const bmp = rgbaTo1BitBmp(rgba);
		return new Response(bmp, {
			headers: { 'content-type': 'image/bmp' },
		});
	},
} satisfies ExportedHandler<Env>;

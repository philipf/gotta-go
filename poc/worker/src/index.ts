import { rgbaTo1BitBmp } from './bmp';
import { buildCheckerboardRgba } from './pattern';

export default {
	async fetch(_request, _env, _ctx): Promise<Response> {
		const rgba = buildCheckerboardRgba();
		const bmp = rgbaTo1BitBmp(rgba);
		return new Response(bmp, {
			headers: { 'content-type': 'image/bmp' },
		});
	},
} satisfies ExportedHandler<Env>;

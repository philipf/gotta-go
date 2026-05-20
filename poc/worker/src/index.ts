import { rgbaTo1BitBmp } from './bmp';
import { buildLayout } from './layout';
import { jsxToSvg, svgToRgba } from './render';

// Per-isolate counter — reqId === 1 means cold isolate. Logged on each request
// so cold-start regressions are visible in `wrangler tail`.
let requestCount = 0;

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Response(bytes).body!.pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

export default {
	async fetch(request, _env, _ctx): Promise<Response> {
		const reqId = ++requestCount;
		console.log(`[req ${reqId}] start (isolate request #${reqId})`);

		const svg = await jsxToSvg(buildLayout());
		const rgba = await svgToRgba(svg);
		const bmp = rgbaTo1BitBmp(rgba);

		const acceptsGzip = (request.headers.get('accept-encoding') ?? '').includes('gzip');
		if (acceptsGzip) {
			const compressed = await gzip(bmp);
			// encodeBody: 'manual' tells the Workers runtime not to re-apply gzip to a body
			// we already compressed (see issue #13). Default is 'automatic', which double-gzips
			// when Content-Encoding: gzip is set on the response.
			return new Response(compressed, {
				encodeBody: 'manual',
				headers: {
					'content-type': 'image/bmp',
					'content-encoding': 'gzip',
					'x-sleep-seconds': '120',
				},
			});
		}

		return new Response(bmp, {
			headers: {
				'content-type': 'image/bmp',
				'x-sleep-seconds': '120',
			},
		});
	},
} satisfies ExportedHandler<Env>;

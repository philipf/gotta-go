// Accept-header → response format (HTTP content negotiation per ADR-0004).
// The radiator sends `Accept: image/bmp` or omits Accept entirely → 'bmp', its
// path byte-identical to before. `Accept: application/json` selects the JSON
// view-model envelope (#19); `Accept: image/svg+xml` selects the intermediate
// Satori SVG fed to the BMP encoder (#20). Both are diagnostics-only surfaces.

export type ResponseFormat = 'bmp' | 'json' | 'svg';

export function resolveResponseFormat(accept: string | null): ResponseFormat {
	if (accept?.includes('application/json')) return 'json';
	if (accept?.includes('image/svg+xml')) return 'svg';
	return 'bmp';
}

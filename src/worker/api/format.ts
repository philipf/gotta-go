// Accept-header → response format (HTTP content negotiation per ADR-0004).
// The radiator sends `Accept: image/bmp` or omits Accept entirely → 'bmp', its
// path byte-identical to before. `Accept: application/json` selects the JSON
// view-model envelope (#19). The Satori SVG variant (#20) joins this union next.

export type ResponseFormat = 'bmp' | 'json';

export function resolveResponseFormat(accept: string | null): ResponseFormat {
	if (accept?.includes('application/json')) return 'json';
	return 'bmp';
}

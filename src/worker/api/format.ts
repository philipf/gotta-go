// Accept-header → response format: 'bmp' for image/bmp or absent Accept,
// 'json' and 'svg' for the two diagnostics-only surfaces.

export type ResponseFormat = 'bmp' | 'json' | 'svg';

export function resolveResponseFormat(accept: string | null): ResponseFormat {
	if (accept?.includes('application/json')) return 'json';
	if (accept?.includes('image/svg+xml')) return 'svg';
	return 'bmp';
}

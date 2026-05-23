// Accept-header → response format. For #4 only image/bmp is implemented; the
// resolver always picks 'bmp'. Per ADR-0004 this gains 'json' and 'svg'
// branches when #19 / #20 land.

export type ResponseFormat = 'bmp';

export function resolveResponseFormat(_accept: string | null): ResponseFormat {
	return 'bmp';
}

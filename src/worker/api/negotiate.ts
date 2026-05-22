// Accept-header → renderer key. For #4 only image/bmp is implemented; the
// negotiator always picks 'bmp'. Per ADR-0004 this gains 'json' and 'svg'
// branches when #19 / #20 land.

export type RendererKey = 'bmp';

export function negotiate(_accept: string | null): RendererKey {
	return 'bmp';
}

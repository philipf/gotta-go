// Public render entry for the minimal_clock layout. Builds the view model
// then dispatches by ResponseFormat to the matching renderer.

import type { Radiator } from '../../config/lookup';
import type { ResponseFormat } from '../../api/format';
import { buildViewModel, type ViewModel } from './viewmodel';
import { renderBmp } from './bmp';

// Indexed by ResponseFormat so adding a new format to the union surfaces a
// TypeScript error here until a renderer is supplied.
const renderers: Record<ResponseFormat, (vm: ViewModel) => Promise<Uint8Array>> = {
	bmp: renderBmp,
};

export async function render(
	radiator: Radiator,
	timezone: string,
	now: Date,
	format: ResponseFormat,
): Promise<Uint8Array> {
	const vm = buildViewModel(radiator, timezone, now);
	return renderers[format](vm);
}

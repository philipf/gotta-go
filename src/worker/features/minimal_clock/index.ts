import { renderBmp } from './bmp';
import type { ViewModel } from './viewmodel';

export { resolvePhase } from './phase';
export type { PhaseResolution } from './phase';
export { buildViewModel } from './viewmodel';
export type { ViewModel } from './viewmodel';

export const renderers = {
	bmp: (vm: ViewModel): Promise<Uint8Array> => renderBmp(vm),
};

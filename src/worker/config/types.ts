import type { LayoutKey } from '../features/registry';

export type { LayoutKey };

export type Phase = {
	key: string;
	startTime: string;
	endTime: string;
	layout: LayoutKey;
	refreshIntervalMinutes: number;
};

export type Profile = {
	slug: string;
	timezone: string;
	phases: Phase[];
};

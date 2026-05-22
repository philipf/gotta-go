export type LayoutKey = 'minimal_clock';

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

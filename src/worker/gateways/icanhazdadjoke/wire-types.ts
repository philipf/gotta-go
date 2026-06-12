// Wire-format type for icanhazdadjoke's JSON response. Confined to the gateway
// folder per ADR-0005 §Verification rule 2 — only mapper.ts performs the
// wire→domain transformation; nothing outside this folder references these
// field names.

export type WireJoke = {
	id: string;
	joke: string;
	status: number;
};

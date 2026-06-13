// The raw wire shape of icanhazdadjoke's JSON response — distinct from the
// domain/contract types in fetch-joke.ts. Quarantined per ADR-0005 §rule 2: only
// mapper.ts reads these field names.

export type WireJoke = {
	id: string;
	joke: string;
	status: number;
};

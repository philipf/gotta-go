// The raw wire shapes of Metlink's /stop-predictions response — distinct from
// the domain/contract types in fetch-arrivals.ts. Quarantined per ADR-0005 §rule
// 2: only mapper.ts reads these field names.

export type WireDeparture = {
	stop_id: string;
	service_id: string;
	trip_id: string;
	// Terminus this departure runs to. A single route number can branch to
	// several termini at a shared stop, so `destination.stop_id` is the
	// discriminator the mapper filters on when a target sets destinationStopId
	// (#68). Optional because abridged payloads (e.g. scheduled-only) omit it.
	destination?: { stop_id: string; name?: string };
	trip_headsign?: string;
	name?: string;
	delay: string; // ISO 8601 duration, e.g. "PT0S", "PT6M12S"
	status: string | null; // null | "ontime" | "delayed" | "cancelled" (case may vary)
	monitored: boolean;
	arrival: { aimed?: string; expected: string | null };
	departure: { aimed?: string; expected: string | null };
};

export type WireResponse = {
	farezone?: string;
	closed: boolean;
	departures: WireDeparture[];
};

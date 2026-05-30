// Wire-format types for Metlink's /stop-predictions response. Confined to
// the gateway folder per ADR-0005 §Verification rule 2 — only mapper.ts
// performs the wire→domain transformation; nothing outside this folder
// references these field names.

export type WireDeparture = {
	stop_id: string;
	service_id: string;
	trip_id: string;
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

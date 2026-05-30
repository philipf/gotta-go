// Composes the **service name** — the column-header label that answers "which
// service is this", combining the upstream `service_id` (e.g. "1") with the
// human-readable `trip_headsign` (e.g. "Island Bay") as `1 · Island Bay`
// (glossary §2). Pure string logic, kept out of view.tsx so it can be unit-tested
// without the Satori path that is sandbox-blocked in vitest (ADR-0005).

// Padded middot: under the proportional DejaVu Sans Bold metric (ADR-0009) the
// surrounding spaces cost little and read cleanly — unlike the old mono font,
// where padding spent three full em-widths and forced a tight separator.
const SEP = ' · ';

// `tripHeadsign` is the Metlink field passed through as-is; the gateway mapper
// defaults it to '' when Metlink omits it, and a degraded column has no service
// at all. In either case drop the separator and show the id alone, rather than
// rendering a dangling "1 · ".
export function serviceName(serviceId: string, tripHeadsign: string): string {
	return tripHeadsign ? `${serviceId}${SEP}${tripHeadsign}` : serviceId;
}

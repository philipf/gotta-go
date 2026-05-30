// Composes the **service name** — the column-header label that answers "which
// service is this", combining the upstream `service_id` (e.g. "1") with the
// human-readable `trip_headsign` (e.g. "Island Bay") as `1·Island Bay`
// (glossary §2). Pure string logic, kept out of bmp.tsx so it can be unit-tested
// without the Satori path that is sandbox-blocked in vitest (ADR-0005).

// No spaces around the middot: Press Start 2P is monospace, so a padded ` · `
// spends three full em-widths on the separator and reads too loose.
const SEP = '·';

// `tripHeadsign` is the Metlink field passed through as-is; the gateway mapper
// defaults it to '' when Metlink omits it, and a degraded column has no service
// at all. In either case drop the separator and show the id alone, rather than
// rendering a dangling "1 · ".
export function serviceName(serviceId: string, tripHeadsign: string): string {
	return tripHeadsign ? `${serviceId}${SEP}${tripHeadsign}` : serviceId;
}

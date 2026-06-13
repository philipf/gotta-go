// Sample PUBLIC_HOLIDAYS KV payloads for tests — the stored shape written by
// src/tools/fetch-nz-holidays.ts (GH #83): a flat JSON array of
// { date, name }, national + Wellington-region, current and next year.

export const storedHolidays = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Wellington Anniversary Day' },
  { date: '2026-02-06', name: 'Waitangi Day' },
  { date: '2026-06-01', name: "King's Birthday" },
  { date: '2026-12-25', name: 'Christmas Day' },
  { date: '2027-01-01', name: "New Year's Day" },
];

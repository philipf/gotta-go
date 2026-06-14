// Extends the Worker's Env with our secrets/vars.
// Secrets do not show up in wrangler-generated types — we declare them here.

interface __BaseEnv_Env {
  RADIATOR_SHARED_TOKEN: string;
  METLINK_API_KEY: string;
  // Dev-only: when "true", an X-Debug-Now request header overrides server time
  // (see debug/dev-time.ts). Set in .dev.vars; never configured in production.
  DEV_TIME_OVERRIDE?: string;
  // Dev-only: when "true", priority_split_v2 pads each open stop's arrivals with
  // synthetic future departures so the THEN/LATER slots populate even when the
  // live feed is sparse (dogfooding aid for issue #108, see
  // debug/dev-pad-arrivals.ts). Set in .dev.vars; never configured in production.
  DEV_PAD_LATER?: string;
}

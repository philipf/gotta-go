// Extends the Worker's Env with our secrets/vars.
// Secrets do not show up in wrangler-generated types — we declare them here.

interface __BaseEnv_Env {
	RADIATOR_SHARED_TOKEN: string;
	METLINK_API_KEY: string;
	// Dev-only: when "true", an X-Debug-Now request header overrides server time
	// (see dev-time.ts). Set in .dev.vars; never configured in production.
	DEV_TIME_OVERRIDE?: string;
}

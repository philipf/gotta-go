// Extends the Worker's Env with our secrets/vars.
// Secrets do not show up in wrangler-generated types — we declare them here.

interface __BaseEnv_Env {
	RADIATOR_SHARED_TOKEN: string;
	METLINK_API_KEY: string;
}

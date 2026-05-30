// HTTP router. Matches GET /v1/frame to the frame handler; everything else
// returns the bare router-level 404.

import { notFound } from "./errors";
import { handleFrame } from "./frame";
import { handleTestFrame } from "./test-frame";

export async function route(
  request: Request,
  env: Env, // Injected from CloudFlare, contains environment settings such as the shared token
  now: Date,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/v1/frame") {
    // Single branch point: a test- prefixed slug renders an intent-named
    // scenario (GH #21); everything else is a real radiator. Both handlers
    // flow through the same renderFrame core.
    const slug = request.headers.get("X-Radiator-Slug") ?? "";
    return slug.startsWith("test-")
      ? handleTestFrame(request, env, now)
      : handleFrame(request, env, now);
  }
  return notFound();
}

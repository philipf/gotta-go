import { notFound } from "./errors";
import { handleFrame } from "./frame";

export async function route(
  request: Request,
  env: Env, // Injected from CloudFlare, contains environment settings such as the shared token
  now: Date,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/v1/frame") {
    return handleFrame(request, env, now);
  }
  return notFound();
}

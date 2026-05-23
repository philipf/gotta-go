import { handleFrame } from "./frame";

export async function route(
  request: Request,
  env: Env, // Injected from CloudFlare, and contains environment settings such as API keys
  now: Date,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/v1/frame") {
    return handleFrame(request, env, now);
  }
  return new Response("not found", { status: 404 });
}

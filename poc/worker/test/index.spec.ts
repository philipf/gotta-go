import {
	env,
	createExecutionContext,
	waitOnExecutionContext,
	SELF,
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("Checkerboard BMP worker", () => {
	it("returns a 1-bit BMP of the expected size (unit style)", async () => {
		const request = new IncomingRequest("http://example.com");
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.headers.get("content-type")).toBe("image/bmp");
		const body = new Uint8Array(await response.arrayBuffer());
		expect(body.length).toBe(64_862);
		expect(body[0]).toBe(0x42);
		expect(body[1]).toBe(0x4d);
	});

	it("returns a 1-bit BMP via SELF.fetch (integration style)", async () => {
		const response = await SELF.fetch("https://example.com");
		expect(response.headers.get("content-type")).toBe("image/bmp");
		const body = new Uint8Array(await response.arrayBuffer());
		expect(body.length).toBe(64_862);
		expect(body[0]).toBe(0x42);
		expect(body[1]).toBe(0x4d);
	});
});

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
	const stream = new Response(bytes).body!.pipeThrough(new CompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Thin wrapper around CompressionStream('gzip') returning a Uint8Array. Used
// to compress the BMP body when the client advertises Accept-Encoding: gzip.

export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(bytes).body!.pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

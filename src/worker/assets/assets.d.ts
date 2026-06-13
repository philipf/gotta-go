// Ambient module declarations for non-TS assets bundled at build time:
// *.wasm (Yoga, resvg), *.ttf (DejaVu Sans Bold — see ADR-0009), and *.png
// (the idle_jokes meme — embedded as a base64 data URI, see #17).

declare module '*.wasm' {
  const wasm: WebAssembly.Module;
  export default wasm;
}

declare module '*.ttf' {
  const bytes: ArrayBuffer;
  export default bytes;
}

declare module '*.png' {
  const bytes: ArrayBuffer;
  export default bytes;
}

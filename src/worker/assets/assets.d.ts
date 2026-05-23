// Ambient module declarations for non-TS assets bundled at build time:
// *.wasm (Yoga, resvg) and *.ttf (Press Start 2P).

declare module '*.wasm' {
	const wasm: WebAssembly.Module;
	export default wasm;
}

declare module '*.ttf' {
	const bytes: ArrayBuffer;
	export default bytes;
}

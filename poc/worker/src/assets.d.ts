declare module '*.wasm' {
	const wasm: WebAssembly.Module;
	export default wasm;
}

declare module '*.ttf' {
	const bytes: ArrayBuffer;
	export default bytes;
}

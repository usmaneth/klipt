declare module "@jitsi/rnnoise-wasm" {
	export interface RNNWasmModule {
		ready: Promise<void>;
		_rnnoise_create: () => number;
		_rnnoise_destroy: (state: number) => void;
		_rnnoise_process_frame: (
			state: number,
			outPtr: number,
			inPtr: number,
		) => number;
		_malloc: (bytes: number) => number;
		_free: (ptr: number) => void;
		HEAPF32: Float32Array;
	}

	export function createRNNWasmModule(): Promise<RNNWasmModule>;
	export function createRNNWasmModuleSync(): RNNWasmModule;
}

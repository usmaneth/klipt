/**
 * Studio Sound: one-click audio enhancement using RNNoise WASM.
 *
 * Pipeline:
 *   1. Fetch video blob -> decode audio via AudioContext
 *   2. Resample to 48 kHz if needed (RNNoise requirement)
 *   3. Denoise every 480-sample frame through RNNoise
 *   4. Encode the cleaned buffer as a 16-bit PCM WAV blob
 */

import type { RNNWasmModule } from "@jitsi/rnnoise-wasm";

const RNNOISE_SAMPLE_RATE = 48_000;
const RNNOISE_FRAME_SIZE = 480; // 10 ms @ 48 kHz

type RNNoiseModule = RNNWasmModule;

async function loadRNNoiseModule(): Promise<RNNoiseModule> {
	const { createRNNWasmModule } = await import("@jitsi/rnnoise-wasm");
	const module = await createRNNWasmModule();
	await module.ready;
	return module;
}

/**
 * Resample an AudioBuffer to 48 kHz mono using an OfflineAudioContext.
 */
async function resampleTo48kMono(buffer: AudioBuffer): Promise<Float32Array> {
	const monoLength = buffer.length;
	const numChannels = buffer.numberOfChannels;
	const sourceSampleRate = buffer.sampleRate;

	// Mix to mono
	const mono = new Float32Array(monoLength);
	for (let ch = 0; ch < numChannels; ch++) {
		const channelData = buffer.getChannelData(ch);
		for (let i = 0; i < monoLength; i++) {
			mono[i] += channelData[i];
		}
	}
	if (numChannels > 1) {
		for (let i = 0; i < monoLength; i++) {
			mono[i] /= numChannels;
		}
	}

	if (sourceSampleRate === RNNOISE_SAMPLE_RATE) {
		return mono;
	}

	// Resample via OfflineAudioContext
	const outLength = Math.ceil((monoLength * RNNOISE_SAMPLE_RATE) / sourceSampleRate);
	const offlineCtx = new OfflineAudioContext(1, outLength, RNNOISE_SAMPLE_RATE);
	const srcBuffer = offlineCtx.createBuffer(1, monoLength, sourceSampleRate);
	srcBuffer.copyToChannel(mono, 0);

	const src = offlineCtx.createBufferSource();
	src.buffer = srcBuffer;
	src.connect(offlineCtx.destination);
	src.start();

	const rendered = await offlineCtx.startRendering();
	return rendered.getChannelData(0);
}

/**
 * Run RNNoise denoising on a mono 48 kHz Float32Array.
 */
function denoiseBuffer(
	module: RNNoiseModule,
	samples: Float32Array,
	onProgress?: (percent: number) => void,
): Float32Array {
	const state = module._rnnoise_create();
	const bytesPerFrame = RNNOISE_FRAME_SIZE * 4; // float32
	const inPtr = module._malloc(bytesPerFrame);
	const outPtr = module._malloc(bytesPerFrame);

	const output = new Float32Array(samples.length);
	const totalFrames = Math.ceil(samples.length / RNNOISE_FRAME_SIZE);

	try {
		for (let i = 0; i < totalFrames; i++) {
			const offset = i * RNNOISE_FRAME_SIZE;
			const remaining = Math.min(RNNOISE_FRAME_SIZE, samples.length - offset);

			// Copy input frame, zero-pad if needed
			const heapOffset = inPtr / 4;
			module.HEAPF32.fill(0, heapOffset, heapOffset + RNNOISE_FRAME_SIZE);
			for (let j = 0; j < remaining; j++) {
				// RNNoise expects values in range [-32768, 32767] (int16 scale)
				module.HEAPF32[heapOffset + j] = samples[offset + j] * 32768;
			}

			module._rnnoise_process_frame(state, outPtr, inPtr);

			// Copy output, converting back to float [-1, 1]
			const outHeapOffset = outPtr / 4;
			for (let j = 0; j < remaining; j++) {
				output[offset + j] = module.HEAPF32[outHeapOffset + j] / 32768;
			}

			if (onProgress && i % 100 === 0) {
				onProgress(Math.round(((i + 1) / totalFrames) * 80) + 10); // 10-90%
			}
		}
	} finally {
		module._free(inPtr);
		module._free(outPtr);
		module._rnnoise_destroy(state);
	}

	return output;
}

/**
 * Encode a mono Float32Array at the given sample rate as a 16-bit PCM WAV Blob.
 */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
	const numChannels = 1;
	const bitsPerSample = 16;
	const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
	const blockAlign = (numChannels * bitsPerSample) / 8;
	const dataSize = samples.length * blockAlign;
	const headerSize = 44;
	const totalSize = headerSize + dataSize;

	const buffer = new ArrayBuffer(totalSize);
	const view = new DataView(buffer);

	// RIFF header
	writeString(view, 0, "RIFF");
	view.setUint32(4, totalSize - 8, true);
	writeString(view, 8, "WAVE");

	// fmt chunk
	writeString(view, 12, "fmt ");
	view.setUint32(16, 16, true); // chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	// data chunk
	writeString(view, 36, "data");
	view.setUint32(40, dataSize, true);

	// PCM samples
	let offset = headerSize;
	for (let i = 0; i < samples.length; i++) {
		const clamped = Math.max(-1, Math.min(1, samples[i]));
		const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
		view.setInt16(offset, int16, true);
		offset += 2;
	}

	return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}

/**
 * Try native macOS audio denoising via the klipt-audio binary.
 * Returns a WAV Blob if the native binary is available, or null to signal fallback.
 */
async function tryNativeDenoise(
	videoUrl: string,
	onProgress?: (percent: number) => void,
): Promise<Blob | null> {
	if (!window.electronAPI?.nativeDenoiseAudio) {
		return null;
	}

	try {
		// The native binary needs a file path. Extract it from the URL.
		let inputPath = videoUrl;
		if (/^(file|klipt-media):\/\//.test(videoUrl)) {
			inputPath = decodeURIComponent(videoUrl.replace(/^(file|klipt-media):\/\//, ""));
		} else if (videoUrl.startsWith("blob:")) {
			// Cannot pass blob URLs to native binary — need a real file path
			return null;
		}

		onProgress?.(10);
		const result = await window.electronAPI.nativeDenoiseAudio(inputPath);
		onProgress?.(80);

		if (!result.success || !result.path) {
			console.warn("[audioEnhancer] Native denoise failed:", result.error);
			return null;
		}

		// Read the output WAV file back as a Blob
		const fileResult = await window.electronAPI.readLocalFile(result.path);
		onProgress?.(90);

		if (!fileResult.success || !fileResult.data) {
			console.warn("[audioEnhancer] Failed to read native output file");
			return null;
		}

		const blob = new Blob([new Uint8Array(fileResult.data)], { type: "audio/wav" });
		onProgress?.(100);
		return blob;
	} catch (err) {
		console.warn("[audioEnhancer] Native denoise unavailable, will fall back:", err);
		return null;
	}
}

/**
 * WASM-based audio enhancement using RNNoise (fallback path).
 */
async function wasmDenoise(
	videoUrl: string,
	onProgress?: (percent: number) => void,
): Promise<Blob> {
	onProgress?.(0);

	// 1. Fetch and decode audio
	const response = await fetch(videoUrl);
	const arrayBuffer = await response.arrayBuffer();
	onProgress?.(5);

	const audioCtx = new AudioContext({ sampleRate: RNNOISE_SAMPLE_RATE });
	let audioBuffer: AudioBuffer;
	try {
		audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
	} finally {
		await audioCtx.close();
	}
	onProgress?.(10);

	// 2. Resample to 48 kHz mono
	const mono48k = await resampleTo48kMono(audioBuffer);

	// 3. Load RNNoise and denoise
	const module = await loadRNNoiseModule();
	const denoised = denoiseBuffer(module, mono48k, onProgress);
	onProgress?.(90);

	// 4. Encode as WAV
	const wavBlob = encodeWav(denoised, RNNOISE_SAMPLE_RATE);
	onProgress?.(100);

	return wavBlob;
}

/**
 * High-level API: enhance audio from a video URL.
 *
 * Tries native macOS denoising first (klipt-audio binary using Accelerate framework).
 * Falls back to WASM-based RNNoise if native is unavailable (e.g., binary not built,
 * blob: URL input, or non-macOS platform).
 *
 * Returns a WAV Blob with denoised audio at 48 kHz mono.
 */
export async function enhanceAudio(
	videoUrl: string,
	onProgress?: (percent: number) => void,
): Promise<Blob> {
	onProgress?.(0);

	// Try native binary first
	const nativeResult = await tryNativeDenoise(videoUrl, onProgress);
	if (nativeResult) {
		console.log("[audioEnhancer] Used native denoiser");
		return nativeResult;
	}

	// Fall back to WASM
	console.log("[audioEnhancer] Falling back to WASM denoiser");
	return wasmDenoise(videoUrl, onProgress);
}

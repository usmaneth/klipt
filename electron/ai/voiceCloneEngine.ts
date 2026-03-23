/**
 * Chatterbox-Turbo ONNX voice cloning engine.
 *
 * Uses onnxruntime-node to run the Chatterbox-Turbo model (q4f16 quantization)
 * for zero-shot voice cloning via a two-stage speech-to-speech pipeline.
 *
 * Pipeline:
 *   Stage 1 (external): Generate TTS audio from translated text (macOS `say`)
 *   Stage 2 (this engine):
 *     1. Speech Encoder  – extract speaker identity from REFERENCE audio (user's voice)
 *     2. Speech Encoder  – extract audio features from SOURCE audio (TTS output)
 *     3. Language Model   – auto-regressive generation of speech tokens conditioned on source audio
 *     4. Conditional Decoder – convert speech tokens → waveform using reference speaker embeddings
 */

import { createRequire } from "node:module";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { app } from "electron";

// onnxruntime-node is a native module — use createRequire so bundlers don't choke
const nodeRequire = createRequire(import.meta.url);

// ── Constants ──────────────────────────────────────────────────────────
const MODEL_ID = "ResembleAI/chatterbox-turbo-ONNX";
const QUANT = "q4f16";
const SAMPLE_RATE = 24000;
const START_SPEECH_TOKEN = 6561;
const STOP_SPEECH_TOKEN = 6562;
const SILENCE_TOKEN = 4299;
const NUM_KV_HEADS = 16;
const NUM_KV_LAYERS = 24;
const HEAD_DIM = 64;
const MAX_NEW_TOKENS = 1024;
const REPETITION_PENALTY = 1.2;
/** Per-step inference timeout (ms). */
const STEP_TIMEOUT_MS = 30_000;
/** Minimum free memory (bytes) before warning. */
const MIN_FREE_MEMORY_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

// ── Node 25 Float16Array compat patch for onnxruntime-node ──────────
// onnxruntime-node 1.x checks V8 TypedArray type-id to validate float16
// tensors. Node 25 ships native Float16Array which shifts the V8 enum so
// the check fails. We monkey-patch Tensor.prototype.data to return
// Uint16Array (same binary layout) which satisfies the native binding.
let _float16PatchApplied = false;
function ensureFloat16Compat(): void {
	if (_float16PatchApplied) return;
	if (typeof Float16Array === "undefined") {
		_float16PatchApplied = true;
		return; // Node < 25 – no patch needed
	}
	try {
		const ort = nodeRequire("onnxruntime-node") as typeof import("onnxruntime-node");
		const desc = Object.getOwnPropertyDescriptor(ort.Tensor.prototype, "data");
		if (!desc?.get) {
			_float16PatchApplied = true;
			return;
		}
		const origGet = desc.get;
		Object.defineProperty(ort.Tensor.prototype, "data", {
			get(this: InstanceType<typeof ort.Tensor>) {
				const d = origGet.call(this);
				if (this.type === "float16" && d instanceof Float16Array) {
					return new Uint16Array(d.buffer, d.byteOffset, d.length);
				}
				return d;
			},
			configurable: true,
			enumerable: true,
		});
	} catch {
		// If patch fails, continue anyway — error will surface at inference time
	}
	_float16PatchApplied = true;
}

/**
 * Run an async function with a timeout. Rejects with a clear message if
 * the operation exceeds `ms` milliseconds.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`[voice-clone] ${label} timed out after ${ms}ms`)),
			ms,
		);
		promise.then(
			(val) => { clearTimeout(timer); resolve(val); },
			(err) => { clearTimeout(timer); reject(err); },
		);
	});
}

/**
 * Log a warning if available system memory is below the threshold.
 */
function checkMemory(): void {
	try {
		const os = require("node:os");
		const free = os.freemem();
		if (free < MIN_FREE_MEMORY_BYTES) {
			const freeGb = (free / (1024 * 1024 * 1024)).toFixed(1);
			console.warn(
				`[voice-clone] Low memory warning: ${freeGb} GB free (recommend >= 4 GB)`,
			);
		}
	} catch {
		// non-critical
	}
}

/** Base directory for downloaded model files inside userData. */
export function getVoiceCloneModelsDir(): string {
	return path.join(app.getPath("userData"), "voice-clone-models");
}

/** List of ONNX model files needed (q4f16 quantisation). */
const MODEL_FILES = [
	{ name: "conditional_decoder", suffix: "_q4f16" },
	{ name: "embed_tokens", suffix: "_q4f16" },
	{ name: "language_model", suffix: "_q4f16" },
	{ name: "speech_encoder", suffix: "_q4f16" },
] as const;

/** HuggingFace URLs for each model file + its weight blob. */
function getModelDownloadUrls(): Array<{ url: string; dest: string; size: number }> {
	const base = `https://huggingface.co/${MODEL_ID}/resolve/main/onnx`;
	const dir = getVoiceCloneModelsDir();
	const files: Array<{ url: string; dest: string; size: number }> = [];
	for (const m of MODEL_FILES) {
		const onnxFile = `${m.name}${m.suffix}.onnx`;
		const dataFile = `${onnxFile}_data`;
		files.push({ url: `${base}/${onnxFile}`, dest: path.join(dir, onnxFile), size: 0 });
		files.push({ url: `${base}/${dataFile}`, dest: path.join(dir, dataFile), size: 0 });
	}
	return files;
}

// ── Model status ───────────────────────────────────────────────────────

export interface VoiceCloneModelStatus {
	installed: boolean;
	/** Total bytes downloaded so far (during install) */
	downloadedBytes: number;
	/** Total bytes expected */
	totalBytes: number;
}

/**
 * Check whether all model files are present on disk.
 */
export async function getVoiceCloneModelStatus(): Promise<VoiceCloneModelStatus> {
	const dir = getVoiceCloneModelsDir();
	const manifestPath = path.join(dir, "manifest.json");

	try {
		await fs.access(manifestPath);
		const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
		if (manifest.complete === true) {
			return { installed: true, downloadedBytes: 0, totalBytes: 0 };
		}
	} catch {
		// not installed
	}

	return { installed: false, downloadedBytes: 0, totalBytes: 0 };
}

// ── Download ───────────────────────────────────────────────────────────

export type DownloadProgressCallback = (downloaded: number, total: number, file: string) => void;

/**
 * Download all model files. Idempotent — skips files that already exist on disk.
 */
export async function downloadVoiceCloneModel(
	onProgress?: DownloadProgressCallback,
): Promise<void> {
	const dir = getVoiceCloneModelsDir();
	await fs.mkdir(dir, { recursive: true });

	const files = getModelDownloadUrls();

	// First pass: determine total size with HEAD requests
	const https = await import("node:https");
	const http = await import("node:http");

	async function getContentLength(url: string): Promise<number> {
		return new Promise((resolve) => {
			const mod = url.startsWith("https") ? https : http;
			const req = mod.request(url, { method: "HEAD" }, (res) => {
				if (res.statusCode === 302 || res.statusCode === 301) {
					const loc = res.headers.location;
					if (loc) {
						getContentLength(loc).then(resolve);
						return;
					}
				}
				const len = parseInt(res.headers["content-length"] ?? "0", 10);
				resolve(len);
			});
			req.on("error", () => resolve(0));
			req.end();
		});
	}

	// Check which files need downloading
	const toDownload: Array<{ url: string; dest: string; expectedSize: number }> = [];
	let totalSize = 0;
	let alreadyDownloaded = 0;

	for (const f of files) {
		try {
			const stat = await fs.stat(f.dest);
			alreadyDownloaded += stat.size;
			totalSize += stat.size;
		} catch {
			const size = await getContentLength(f.url);
			toDownload.push({ ...f, expectedSize: size });
			totalSize += size;
		}
	}

	if (toDownload.length === 0) {
		// All files present — write manifest
		await fs.writeFile(
			path.join(dir, "manifest.json"),
			JSON.stringify({ complete: true, quant: QUANT, modelId: MODEL_ID }, null, "\t"),
			"utf8",
		);
		return;
	}

	let downloadedSoFar = alreadyDownloaded;

	for (const f of toDownload) {
		const fileName = path.basename(f.dest);
		onProgress?.(downloadedSoFar, totalSize, fileName);
		await downloadFile(f.url, f.dest, (chunk) => {
			downloadedSoFar += chunk;
			onProgress?.(downloadedSoFar, totalSize, fileName);
		});
	}

	// Write manifest
	await fs.writeFile(
		path.join(dir, "manifest.json"),
		JSON.stringify({ complete: true, quant: QUANT, modelId: MODEL_ID }, null, "\t"),
		"utf8",
	);
}

async function downloadFile(
	url: string,
	dest: string,
	onChunk: (bytes: number) => void,
): Promise<void> {
	const https = await import("node:https");

	return new Promise((resolve, reject) => {
		const request = (currentUrl: string, redirectCount = 0) => {
			const req = https.get(currentUrl, (res) => {
				const statusCode = res.statusCode ?? 0;
				const location = res.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					res.resume();
					if (redirectCount >= 10) {
						reject(new Error(`[voice-clone] Too many redirects for ${url}`));
						return;
					}
					request(new URL(location, currentUrl).toString(), redirectCount + 1);
					return;
				}

				if (statusCode < 200 || statusCode >= 300) {
					res.resume();
					reject(new Error(`[voice-clone] HTTP ${statusCode} downloading ${url}`));
					return;
				}

				const ws = fsSync.createWriteStream(dest);
				res.on("data", (chunk: Buffer) => onChunk(chunk.length));
				res.pipe(ws);
				ws.on("finish", resolve);
				ws.on("error", reject);
				res.on("error", reject);
			});
			req.on("error", reject);
		};

		request(url);
	});
}

// ── ONNX Inference ─────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OrtSession = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OrtTensor = any;

let _sessions: {
	speechEncoder: OrtSession;
	embedTokens: OrtSession;
	languageModel: OrtSession;
	conditionalDecoder: OrtSession;
} | null = null;

async function loadSessions(): Promise<NonNullable<typeof _sessions>> {
	if (_sessions) return _sessions;

	ensureFloat16Compat();
	checkMemory();

	const ort = nodeRequire("onnxruntime-node") as typeof import("onnxruntime-node");
	const dir = getVoiceCloneModelsDir();

	const suffix = "_q4f16";

	console.log("[voice-clone] Loading ONNX sessions from", dir);

	const [speechEncoder, embedTokens, languageModel, conditionalDecoder] = await Promise.all([
		ort.InferenceSession.create(path.join(dir, `speech_encoder${suffix}.onnx`)),
		ort.InferenceSession.create(path.join(dir, `embed_tokens${suffix}.onnx`)),
		ort.InferenceSession.create(path.join(dir, `language_model${suffix}.onnx`)),
		ort.InferenceSession.create(path.join(dir, `conditional_decoder${suffix}.onnx`)),
	]);

	console.log("[voice-clone] All sessions loaded");
	_sessions = { speechEncoder, embedTokens, languageModel, conditionalDecoder };
	return _sessions;
}

/**
 * Release all cached ONNX sessions to free memory.
 */
export async function disposeSessions(): Promise<void> {
	if (!_sessions) return;
	await Promise.all([
		_sessions.speechEncoder.release(),
		_sessions.embedTokens.release(),
		_sessions.languageModel.release(),
		_sessions.conditionalDecoder.release(),
	]);
	_sessions = null;
}

// ── Audio I/O helpers ──────────────────────────────────────────────────

/**
 * Read a mono 24 kHz float32 PCM from a WAV file.
 * Uses ffmpeg to normalise any input format.
 */
async function readAudioAsFloat32(
	audioPath: string,
	ffmpegPath: string,
): Promise<Float32Array> {
	const tmpRaw = path.join(
		app.getPath("temp"),
		`klipt-vc-ref-${Date.now()}.raw`,
	);

	await new Promise<void>((resolve, reject) => {
		const proc = spawn(
			ffmpegPath,
			[
				"-i", audioPath,
				"-ar", String(SAMPLE_RATE),
				"-ac", "1",
				"-f", "f32le",
				"-acodec", "pcm_f32le",
				"-y", tmpRaw,
			],
			{ stdio: "pipe" },
		);
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg exited with code ${code}`));
		});
		proc.on("error", reject);
	});

	const buf = await fs.readFile(tmpRaw);
	await fs.unlink(tmpRaw).catch(() => {});
	return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

/**
 * Write a float32 PCM array to a WAV file (24 kHz mono 16-bit).
 */
async function writeWav(samples: Float32Array, outPath: string): Promise<void> {
	const numSamples = samples.length;
	const bytesPerSample = 2; // 16-bit
	const dataSize = numSamples * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataSize);

	// WAV header
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + dataSize, 4);
	buffer.write("WAVE", 8);
	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16); // fmt chunk size
	buffer.writeUInt16LE(1, 20); // PCM
	buffer.writeUInt16LE(1, 22); // mono
	buffer.writeUInt32LE(SAMPLE_RATE, 24);
	buffer.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28);
	buffer.writeUInt16LE(bytesPerSample, 32);
	buffer.writeUInt16LE(16, 34); // bits per sample
	buffer.write("data", 36);
	buffer.writeUInt32LE(dataSize, 40);

	// Convert float32 → int16
	for (let i = 0; i < numSamples; i++) {
		const s = Math.max(-1, Math.min(1, samples[i]));
		const val = s < 0 ? s * 0x8000 : s * 0x7fff;
		buffer.writeInt16LE(Math.round(val), 44 + i * 2);
	}

	await fs.writeFile(outPath, buffer);
}

// ── Numpy-style helpers ────────────────────────────────────────────────

function argmax(arr: Float32Array | Float64Array | number[]): number {
	let maxIdx = 0;
	let maxVal = -Infinity;
	for (let i = 0; i < arr.length; i++) {
		if (arr[i] > maxVal) {
			maxVal = arr[i];
			maxIdx = i;
		}
	}
	return maxIdx;
}

function applyRepetitionPenalty(
	logits: Float32Array,
	generatedTokens: number[],
	penalty: number,
): Float32Array {
	const result = new Float32Array(logits);
	for (const tokenId of generatedTokens) {
		if (tokenId >= 0 && tokenId < result.length) {
			if (result[tokenId] < 0) {
				result[tokenId] *= penalty;
			} else {
				result[tokenId] /= penalty;
			}
		}
	}
	return result;
}

// ── Main generation ────────────────────────────────────────────────────

export interface VoiceCloneOptions {
	/** Path to reference audio — the user's ORIGINAL voice (5-10s for speaker identity). */
	referenceAudioPath: string;
	/** Path to source audio — TTS output in the target language (the words to say). */
	sourceAudioPath: string;
	/** Output WAV path. */
	outputPath: string;
	/** Path to ffmpeg binary. */
	ffmpegPath: string;
	/** Optional progress callback (0..1). */
	onProgress?: (fraction: number) => void;
}

/**
 * Generate speech in the cloned voice using a speech-to-speech pipeline.
 *
 * Two-input approach:
 *   - referenceAudioPath: user's original voice (provides speaker identity)
 *   - sourceAudioPath: TTS-generated audio in target language (provides the words)
 *
 * Model I/O (verified against actual ONNX files):
 *   speech_encoder:      in {audio_values}        → out {audio_features, audio_tokens, speaker_embeddings, speaker_features}
 *   embed_tokens:        in {input_ids}            → out {inputs_embeds}  (speech token IDs 0-6562 only)
 *   language_model:      in {inputs_embeds(f32), attention_mask, position_ids, past_key_values.N.key/value(f16)} → out {logits, present.N.key/value(f16)}
 *   conditional_decoder: in {speech_tokens, speaker_embeddings, speaker_features} → out {waveform}
 */
export async function generateClonedSpeech(opts: VoiceCloneOptions): Promise<void> {
	const { referenceAudioPath, sourceAudioPath, outputPath, ffmpegPath, onProgress } = opts;

	const ort = nodeRequire("onnxruntime-node") as typeof import("onnxruntime-node");
	const OrtTensor = ort.Tensor;

	onProgress?.(0.05);

	// 1. Load ONNX sessions
	const sessions = await loadSessions();

	onProgress?.(0.1);

	// 2. Read BOTH audio files as float32 (24kHz mono)
	const [refSamples, srcSamples] = await Promise.all([
		readAudioAsFloat32(referenceAudioPath, ffmpegPath),
		readAudioAsFloat32(sourceAudioPath, ffmpegPath),
	]);

	if (refSamples.length === 0) {
		throw new Error("[voice-clone] Reference audio is empty — cannot extract speaker embedding");
	}
	if (srcSamples.length === 0) {
		throw new Error("[voice-clone] Source TTS audio is empty — nothing to voice-convert");
	}

	console.log(`[voice-clone] Reference audio: ${refSamples.length} samples (${(refSamples.length / SAMPLE_RATE).toFixed(1)}s)`);
	console.log(`[voice-clone] Source TTS audio: ${srcSamples.length} samples (${(srcSamples.length / SAMPLE_RATE).toFixed(1)}s)`);

	onProgress?.(0.15);

	// 3. Encode REFERENCE audio → speaker identity
	const refAudioValues = new OrtTensor("float32", refSamples, [1, refSamples.length]);
	const refEncoderResult = await withTimeout(
		sessions.speechEncoder.run({ audio_values: refAudioValues }),
		STEP_TIMEOUT_MS,
		"speech encoder (reference)",
	) as Record<string, OrtTensor>;

	const refSpeakerEmbeddings = refEncoderResult["speaker_embeddings"];
	const refSpeakerFeatures = refEncoderResult["speaker_features"];

	if (!refSpeakerEmbeddings || !refSpeakerFeatures) {
		const got = Object.keys(refEncoderResult).join(", ");
		throw new Error(`[voice-clone] Speech encoder (reference) missing speaker outputs. Got: [${got}]`);
	}

	console.log(
		"[voice-clone] Reference encoder →",
		`speaker_embeddings ${JSON.stringify(refSpeakerEmbeddings.dims)},`,
		`speaker_features ${JSON.stringify(refSpeakerFeatures.dims)}`,
	);

	onProgress?.(0.2);

	// 4. Encode SOURCE (TTS) audio → audio features + tokens for conditioning
	const srcAudioValues = new OrtTensor("float32", srcSamples, [1, srcSamples.length]);
	const srcEncoderResult = await withTimeout(
		sessions.speechEncoder.run({ audio_values: srcAudioValues }),
		STEP_TIMEOUT_MS,
		"speech encoder (source)",
	) as Record<string, OrtTensor>;

	const srcAudioFeatures = srcEncoderResult["audio_features"];
	const srcAudioTokens = srcEncoderResult["audio_tokens"];

	if (!srcAudioFeatures || !srcAudioTokens) {
		const got = Object.keys(srcEncoderResult).join(", ");
		throw new Error(`[voice-clone] Speech encoder (source) missing audio outputs. Got: [${got}]`);
	}

	console.log(
		"[voice-clone] Source encoder →",
		`audio_features ${JSON.stringify(srcAudioFeatures.dims)},`,
		`audio_tokens ${JSON.stringify(srcAudioTokens.dims)}`,
	);

	onProgress?.(0.3);

	// 5. Embed source audio_tokens via embed_tokens to get proper LM input
	//    audio_tokens [1, K] are discrete speech codec IDs (0-6562) — must be
	//    projected through embed_tokens so the LM receives embeddings from the
	//    same representation space it was trained on. Using audio_features
	//    (continuous encoder activations) directly would produce garbage.
	const srcEmbedResult = await withTimeout(
		sessions.embedTokens.run({ input_ids: srcAudioTokens }),
		STEP_TIMEOUT_MS,
		"embed_tokens (source audio_tokens)",
	) as Record<string, OrtTensor>;
	const inputsEmbeds = srcEmbedResult["inputs_embeds"] as OrtTensor;
	const seqLen = inputsEmbeds.dims[1] as number;
	const hiddenDim = inputsEmbeds.dims[2] as number;
	console.log(`[voice-clone] LM conditioning: embed_tokens(audio_tokens) → [1, ${seqLen}, ${hiddenDim}]`);

	// 6. Initialise KV cache (float16) and attention mask
	const kvCache: Record<string, OrtTensor> = {};
	for (let layer = 0; layer < NUM_KV_LAYERS; layer++) {
		kvCache[`past_key_values.${layer}.key`] = new OrtTensor(
			"float16",
			new Uint16Array(0),
			[1, NUM_KV_HEADS, 0, HEAD_DIM],
		);
		kvCache[`past_key_values.${layer}.value`] = new OrtTensor(
			"float16",
			new Uint16Array(0),
			[1, NUM_KV_HEADS, 0, HEAD_DIM],
		);
	}

	let attentionMask = new OrtTensor(
		"int64",
		BigInt64Array.from(Array(seqLen).fill(1n)),
		[1, seqLen],
	);
	let positionIds = new OrtTensor(
		"int64",
		BigInt64Array.from(Array.from({ length: seqLen }, (_, i) => BigInt(i))),
		[1, seqLen],
	);

	// 7. Auto-regressive generation loop
	const generatedTokens: number[] = [START_SPEECH_TOKEN];
	let currentEmbeds: OrtTensor = inputsEmbeds;

	console.log("[voice-clone] Starting LM generation (max", MAX_NEW_TOKENS, "tokens)...");

	for (let step = 0; step < MAX_NEW_TOKENS; step++) {
		const feeds: Record<string, OrtTensor> = {
			inputs_embeds: currentEmbeds,
			attention_mask: attentionMask,
			position_ids: positionIds,
			...kvCache,
		};

		const lmResult = await withTimeout(
			sessions.languageModel.run(feeds),
			STEP_TIMEOUT_MS,
			`LM step ${step}`,
		) as Record<string, OrtTensor>;

		// Extract logits (last position)
		const logitsTensor = lmResult["logits"] as OrtTensor;
		const logitsData = logitsTensor.data as Float32Array;
		const vocabSize = logitsTensor.dims[2] as number;
		const lastTokenLogits = logitsData.slice(-vocabSize);

		// Apply repetition penalty
		const penalisedLogits = applyRepetitionPenalty(
			lastTokenLogits,
			generatedTokens,
			REPETITION_PENALTY,
		);

		// Greedy decode
		const nextToken = argmax(penalisedLogits);
		generatedTokens.push(nextToken);

		if (nextToken === STOP_SPEECH_TOKEN) {
			console.log(`[voice-clone] STOP token at step ${step}`);
			break;
		}

		// Update KV cache: present.N.key → past_key_values.N.key
		for (let layer = 0; layer < NUM_KV_LAYERS; layer++) {
			const keyOut = lmResult[`present.${layer}.key`];
			const valOut = lmResult[`present.${layer}.value`];
			if (keyOut) kvCache[`past_key_values.${layer}.key`] = keyOut as OrtTensor;
			if (valOut) kvCache[`past_key_values.${layer}.value`] = valOut as OrtTensor;
		}

		// Prepare next step input: embed the newly generated speech token
		const nextTokenTensor = new OrtTensor(
			"int64",
			BigInt64Array.from([BigInt(nextToken)]),
			[1, 1],
		);
		const nextEmbedResult = await sessions.embedTokens.run({ input_ids: nextTokenTensor });
		currentEmbeds = nextEmbedResult["inputs_embeds"] as OrtTensor;

		// Update attention mask (extend by 1)
		const prevMaskLen = attentionMask.dims[1] as number;
		const newMaskData = BigInt64Array.from(Array(prevMaskLen + 1).fill(1n));
		attentionMask = new OrtTensor("int64", newMaskData, [1, prevMaskLen + 1]);

		// Update position ids (next position)
		const lastPos = positionIds.data[positionIds.data.length - 1] as bigint;
		positionIds = new OrtTensor("int64", BigInt64Array.from([lastPos + 1n]), [1, 1]);

		// Report progress (generation is 30%→80% of total)
		const genProgress = 0.3 + (step / MAX_NEW_TOKENS) * 0.5;
		if (step % 10 === 0) onProgress?.(Math.min(genProgress, 0.8));
	}

	const speechTokenCount = generatedTokens.length - 1;
	console.log(`[voice-clone] Generated ${speechTokenCount} speech tokens`);

	if (speechTokenCount === 0) {
		throw new Error("[voice-clone] LM produced zero speech tokens — model may have failed to generate");
	}

	onProgress?.(0.8);

	// 8. Decode speech tokens → waveform
	const speechTokens = generatedTokens.slice(1); // remove START token
	// Remove trailing STOP token if present
	if (speechTokens[speechTokens.length - 1] === STOP_SPEECH_TOKEN) {
		speechTokens.pop();
	}

	// Prepend source audio_tokens (prompt context), append silence padding
	const srcTokenData = srcAudioTokens.data as BigInt64Array;
	const srcTokenArr = Array.from(srcTokenData).map(Number);
	const silencePad = Array(3).fill(SILENCE_TOKEN) as number[];
	const fullSpeechTokens = [...srcTokenArr, ...speechTokens, ...silencePad];

	console.log(`[voice-clone] Decoder input: ${srcTokenArr.length} source + ${speechTokens.length} generated + 3 silence = ${fullSpeechTokens.length} tokens`);

	const speechTokensTensor = new OrtTensor(
		"int64",
		BigInt64Array.from(fullSpeechTokens.map(BigInt)),
		[1, fullSpeechTokens.length],
	);

	// Decode using REFERENCE speaker embeddings (voice identity) + generated speech tokens
	const decoderResult = await withTimeout(
		sessions.conditionalDecoder.run({
			speech_tokens: speechTokensTensor,
			speaker_embeddings: refSpeakerEmbeddings,
			speaker_features: refSpeakerFeatures,
		}),
		STEP_TIMEOUT_MS,
		"conditional decoder",
	) as Record<string, OrtTensor>;

	onProgress?.(0.9);

	// 9. Write output WAV
	const waveformTensor = decoderResult["waveform"];
	if (!waveformTensor) {
		const got = Object.keys(decoderResult).join(", ");
		throw new Error(`[voice-clone] Conditional decoder missing 'waveform' output. Got: [${got}]`);
	}
	const wavSamples = new Float32Array((waveformTensor as OrtTensor).data as Float32Array);
	console.log(`[voice-clone] Waveform: ${wavSamples.length} samples (${(wavSamples.length / SAMPLE_RATE).toFixed(2)}s)`);

	if (wavSamples.length === 0) {
		throw new Error("[voice-clone] Decoder produced empty waveform");
	}

	await writeWav(wavSamples, outputPath);
	console.log(`[voice-clone] WAV written to ${outputPath}`);

	onProgress?.(1.0);
}

/**
 * Extract a short voice reference sample from a video file.
 * Takes the first 10 seconds of audio from the video.
 */
export async function extractVoiceReference(
	videoPath: string,
	ffmpegPath: string,
): Promise<string> {
	const refPath = path.join(
		app.getPath("temp"),
		`klipt-voice-ref-${Date.now()}.wav`,
	);

	await new Promise<void>((resolve, reject) => {
		const proc = spawn(
			ffmpegPath,
			[
				"-i", videoPath,
				"-vn",
				"-ar", String(SAMPLE_RATE),
				"-ac", "1",
				"-t", "10", // first 10 seconds
				"-f", "wav",
				"-y", refPath,
			],
			{ stdio: "pipe" },
		);
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`ffmpeg voice reference extraction failed (code ${code})`));
		});
		proc.on("error", reject);
	});

	return refPath;
}

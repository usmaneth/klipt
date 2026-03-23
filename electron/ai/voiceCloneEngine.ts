/**
 * Chatterbox-Turbo ONNX voice cloning engine.
 *
 * Uses onnxruntime-node to run the Chatterbox-Turbo model (q4f16 quantization)
 * for zero-shot voice cloning from a short reference audio clip.
 *
 * Pipeline:
 *   1. Speech Encoder  – extracts speaker embeddings from reference audio
 *   2. Embed Tokens    – converts tokenised text to embeddings
 *   3. Language Model   – auto-regressive generation of speech tokens
 *   4. Conditional Decoder – converts speech tokens → waveform
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
const HEAD_DIM = 64;
const MAX_NEW_TOKENS = 1024;
const REPETITION_PENALTY = 1.2;

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
	// Also need the tokenizer files
	files.push({
		url: `https://huggingface.co/${MODEL_ID}/resolve/main/tokenizer.json`,
		dest: path.join(dir, "tokenizer.json"),
		size: 0,
	});
	files.push({
		url: `https://huggingface.co/${MODEL_ID}/resolve/main/tokenizer_config.json`,
		dest: path.join(dir, "tokenizer_config.json"),
		size: 0,
	});
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

// ── Tokeniser (minimal BPE from tokenizer.json) ───────────────────────

interface TokenizerData {
	model: {
		vocab: Record<string, number>;
		merges: string[];
	};
	added_tokens: Array<{ id: number; content: string }>;
}

let _cachedTokenizer: { encode: (text: string) => number[] } | null = null;

async function loadTokenizer(): Promise<{ encode: (text: string) => number[] }> {
	if (_cachedTokenizer) return _cachedTokenizer;

	const tokenizerPath = path.join(getVoiceCloneModelsDir(), "tokenizer.json");
	const raw = await fs.readFile(tokenizerPath, "utf8");
	const data: TokenizerData = JSON.parse(raw);

	const vocab = data.model.vocab;

	// Build byte-to-unicode mapping (GPT-2 style)
	const byteEncoder = bytesToUnicode();
	const merges = data.model.merges.map((m) => m.split(" ") as [string, string]);
	const bpeRanks = new Map<string, number>();
	for (let i = 0; i < merges.length; i++) {
		bpeRanks.set(merges[i].join(" "), i);
	}

	function getPairs(word: string[]): Set<string> {
		const pairs = new Set<string>();
		for (let i = 0; i < word.length - 1; i++) {
			pairs.add(word[i] + " " + word[i + 1]);
		}
		return pairs;
	}

	const bpeCache = new Map<string, string>();

	function bpe(token: string): string {
		if (bpeCache.has(token)) return bpeCache.get(token)!;

		let word = token.split("");
		let pairs = getPairs(word);

		if (pairs.size === 0) {
			bpeCache.set(token, token);
			return token;
		}

		// biome-ignore lint/suspicious/noConstantCondition: BPE merge loop
		while (true) {
			let minRank = Infinity;
			let bigram = "";
			for (const pair of pairs) {
				const rank = bpeRanks.get(pair);
				if (rank !== undefined && rank < minRank) {
					minRank = rank;
					bigram = pair;
				}
			}
			if (minRank === Infinity) break;

			const [first, second] = bigram.split(" ");
			const newWord: string[] = [];
			let i = 0;
			while (i < word.length) {
				const j = word.indexOf(first, i);
				if (j === -1) {
					newWord.push(...word.slice(i));
					break;
				}
				newWord.push(...word.slice(i, j));
				if (j < word.length - 1 && word[j] === first && word[j + 1] === second) {
					newWord.push(first + second);
					i = j + 2;
				} else {
					newWord.push(word[j]);
					i = j + 1;
				}
			}
			word = newWord;
			if (word.length === 1) break;
			pairs = getPairs(word);
		}

		const result = word.join(" ");
		bpeCache.set(token, result);
		return result;
	}

	// GPT-2 pre-tokenisation regex
	const pat = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+/gu;

	function encode(text: string): number[] {
		const tokens: number[] = [];
		const matches = text.match(pat) ?? [];
		for (const piece of matches) {
			const encoded = Array.from(piece)
				.map((b) => {
					const bytes = new TextEncoder().encode(b);
					return Array.from(bytes)
						.map((byte) => byteEncoder[byte])
						.join("");
				})
				.join("");
			const bpeTokens = bpe(encoded).split(" ");
			for (const bt of bpeTokens) {
				const id = vocab[bt];
				if (id !== undefined) {
					tokens.push(id);
				}
			}
		}
		return tokens;
	}

	_cachedTokenizer = { encode };
	return _cachedTokenizer;
}

function bytesToUnicode(): Record<number, string> {
	const bs: number[] = [];
	const cs: number[] = [];
	// printable ASCII ranges
	for (let i = 33; i <= 126; i++) {
		bs.push(i);
		cs.push(i);
	}
	for (let i = 161; i <= 172; i++) {
		bs.push(i);
		cs.push(i);
	}
	for (let i = 174; i <= 255; i++) {
		bs.push(i);
		cs.push(i);
	}
	let n = 0;
	for (let b = 0; b < 256; b++) {
		if (!bs.includes(b)) {
			bs.push(b);
			cs.push(256 + n);
			n++;
		}
	}
	const result: Record<number, string> = {};
	for (let i = 0; i < bs.length; i++) {
		result[bs[i]] = String.fromCodePoint(cs[i]);
	}
	return result;
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

	const ort = nodeRequire("onnxruntime-node") as typeof import("onnxruntime-node");
	const dir = getVoiceCloneModelsDir();

	const suffix = "_q4f16";

	const [speechEncoder, embedTokens, languageModel, conditionalDecoder] = await Promise.all([
		ort.InferenceSession.create(path.join(dir, `speech_encoder${suffix}.onnx`)),
		ort.InferenceSession.create(path.join(dir, `embed_tokens${suffix}.onnx`)),
		ort.InferenceSession.create(path.join(dir, `language_model${suffix}.onnx`)),
		ort.InferenceSession.create(path.join(dir, `conditional_decoder${suffix}.onnx`)),
	]);

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
	/** Path to reference audio (5-15 seconds of the speaker). */
	referenceAudioPath: string;
	/** Text to synthesise in the cloned voice. */
	text: string;
	/** Output WAV path. */
	outputPath: string;
	/** Path to ffmpeg binary. */
	ffmpegPath: string;
	/** Optional progress callback (0..1). */
	onProgress?: (fraction: number) => void;
}

/**
 * Generate speech in the cloned voice.
 *
 * Runs the full Chatterbox-Turbo pipeline:
 *   encode reference → tokenise text → LM generation → decode to waveform
 */
export async function generateClonedSpeech(opts: VoiceCloneOptions): Promise<void> {
	const { referenceAudioPath, text, outputPath, ffmpegPath, onProgress } = opts;

	const ort = nodeRequire("onnxruntime-node") as typeof import("onnxruntime-node");
	const OrtTensor = ort.Tensor;

	onProgress?.(0.05);

	// 1. Load sessions + tokenizer
	const [sessions, tokenizer] = await Promise.all([loadSessions(), loadTokenizer()]);

	onProgress?.(0.1);

	// 2. Read reference audio
	const audioSamples = await readAudioAsFloat32(referenceAudioPath, ffmpegPath);
	const audioValues = new OrtTensor("float32", audioSamples, [1, audioSamples.length]);

	onProgress?.(0.15);

	// 3. Encode reference voice
	const speechEncoderResult = await sessions.speechEncoder.run({ audio_values: audioValues });
	const condEmb = speechEncoderResult["cond_emb"] as OrtTensor;
	const promptToken = speechEncoderResult["prompt_token"] as OrtTensor;
	const speakerEmbeddings = speechEncoderResult["speaker_embeddings"] as OrtTensor;
	const speakerFeatures = speechEncoderResult["speaker_features"] as OrtTensor;

	onProgress?.(0.25);

	// 4. Tokenise text
	const inputIds = tokenizer.encode(text);
	const inputIdsTensor = new OrtTensor("int64", BigInt64Array.from(inputIds.map(BigInt)), [1, inputIds.length]);

	// 5. Get text embeddings
	const embedResult = await sessions.embedTokens.run({ input_ids: inputIdsTensor });
	let inputsEmbeds = embedResult["inputs_embeds"] as OrtTensor;

	onProgress?.(0.3);

	// 6. Concatenate cond_emb + inputs_embeds along sequence dimension
	const condData = condEmb.data as Float32Array;
	const embedData = inputsEmbeds.data as Float32Array;
	const hiddenDim = condEmb.dims[2];
	const condSeqLen = condEmb.dims[1];
	const embedSeqLen = inputsEmbeds.dims[1];
	const totalSeqLen = condSeqLen + embedSeqLen;

	const concatData = new Float32Array(totalSeqLen * hiddenDim);
	concatData.set(condData, 0);
	concatData.set(embedData, condSeqLen * hiddenDim);
	inputsEmbeds = new OrtTensor("float32", concatData, [1, totalSeqLen, hiddenDim]);

	// 7. Initialise KV cache and attention mask
	const lmInputs: string[] = sessions.languageModel.inputNames;
	const kvNames = lmInputs.filter((n: string) => n.includes("past_key_values"));

	// Use float32 for KV cache (safe default; the model will cast internally if needed)
	const kvCache: Record<string, OrtTensor> = {};
	for (const name of kvNames) {
		kvCache[name] = new OrtTensor(
			"float32",
			new Float32Array(0),
			[1, NUM_KV_HEADS, 0, HEAD_DIM],
		);
	}

	let attentionMask = new OrtTensor(
		"int64",
		BigInt64Array.from(Array(totalSeqLen).fill(1n)),
		[1, totalSeqLen],
	);
	let positionIds = new OrtTensor(
		"int64",
		BigInt64Array.from(Array.from({ length: totalSeqLen }, (_, i) => BigInt(i))),
		[1, totalSeqLen],
	);

	// 8. Auto-regressive generation loop
	const generatedTokens: number[] = [START_SPEECH_TOKEN];
	let currentEmbeds = inputsEmbeds;

	for (let step = 0; step < MAX_NEW_TOKENS; step++) {
		const feeds: Record<string, OrtTensor> = {
			inputs_embeds: currentEmbeds,
			attention_mask: attentionMask,
			position_ids: positionIds,
			...kvCache,
		};

		const lmResult = await sessions.languageModel.run(feeds);

		// Extract logits (last position)
		const logitsTensor = lmResult["logits"] as OrtTensor;
		const logitsData = logitsTensor.data as Float32Array;
		const vocabSize = logitsTensor.dims[2];
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

		if (nextToken === STOP_SPEECH_TOKEN) break;

		// Update KV cache
		for (const name of kvNames) {
			const newKv = lmResult[name.replace("past_key_values", "present")] ?? lmResult[name];
			if (newKv) {
				kvCache[name] = newKv as OrtTensor;
			}
		}

		// Prepare next step input: embed the new token
		const nextTokenTensor = new OrtTensor(
			"int64",
			BigInt64Array.from([BigInt(nextToken)]),
			[1, 1],
		);
		const nextEmbedResult = await sessions.embedTokens.run({ input_ids: nextTokenTensor });
		currentEmbeds = nextEmbedResult["inputs_embeds"] as OrtTensor;

		// Update attention mask (extend by 1)
		const prevMaskLen = attentionMask.dims[1];
		const newMaskData = BigInt64Array.from(Array(prevMaskLen + 1).fill(1n));
		attentionMask = new OrtTensor("int64", newMaskData, [1, prevMaskLen + 1]);

		// Update position ids (next position)
		const lastPos = positionIds.data[positionIds.data.length - 1] as bigint;
		positionIds = new OrtTensor("int64", BigInt64Array.from([lastPos + 1n]), [1, 1]);

		// Report progress (generation is 30%→80% of total)
		const genProgress = 0.3 + (step / MAX_NEW_TOKENS) * 0.5;
		if (step % 10 === 0) onProgress?.(Math.min(genProgress, 0.8));
	}

	onProgress?.(0.8);

	// 9. Decode speech tokens → waveform
	const speechTokens = generatedTokens.slice(1); // remove START token
	// Remove trailing STOP token if present
	if (speechTokens[speechTokens.length - 1] === STOP_SPEECH_TOKEN) {
		speechTokens.pop();
	}

	// Prepend prompt tokens from speech encoder, append silence padding
	const promptTokenData = promptToken.data as BigInt64Array;
	const promptTokenArr = Array.from(promptTokenData).map(Number);
	const silencePad = Array(3).fill(SILENCE_TOKEN);
	const fullSpeechTokens = [...promptTokenArr, ...speechTokens, ...silencePad];

	const speechTokensTensor = new OrtTensor(
		"int64",
		BigInt64Array.from(fullSpeechTokens.map(BigInt)),
		[1, fullSpeechTokens.length],
	);

	const decoderResult = await sessions.conditionalDecoder.run({
		speech_tokens: speechTokensTensor,
		speaker_embeddings: speakerEmbeddings,
		speaker_features: speakerFeatures,
	});

	onProgress?.(0.9);

	// 10. Write output WAV
	const wavData = decoderResult["wav"] ?? decoderResult[Object.keys(decoderResult)[0]];
	const wavSamples = new Float32Array((wavData as OrtTensor).data as Float32Array);

	await writeWav(wavSamples, outputPath);

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

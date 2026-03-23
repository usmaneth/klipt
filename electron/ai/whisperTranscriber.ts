import { spawn } from "node:child_process";
import fs from "node:fs/promises";

export interface TranscriptionWord {
	text: string;
	start: number;
	end: number;
	confidence: number;
}

export interface TranscriptionResult {
	words: TranscriptionWord[];
	fullText: string;
	language: string;
}

/**
 * Find the whisper-cli binary. Checks:
 * 1. Bundled binary in electron/native/bin/
 * 2. Homebrew installation
 * 3. System PATH
 */
async function findWhisperCli(): Promise<string> {
	const candidates = [
		// Homebrew (Apple Silicon)
		"/opt/homebrew/bin/whisper-cli",
		// Homebrew (Intel)
		"/usr/local/bin/whisper-cli",
		// System PATH
		"whisper-cli",
	];

	for (const candidate of candidates) {
		try {
			if (candidate.startsWith("/")) {
				await fs.access(candidate);
				return candidate;
			}
		} catch {
			continue;
		}
	}

	// Try which as last resort
	return "whisper-cli";
}

/**
 * Transcribes an audio file using whisper-cli (whisper.cpp CLI).
 * Outputs JSON with word-level timestamps.
 */
export async function transcribeAudio(
	audioPath: string,
	modelPath: string,
	language = "en",
): Promise<TranscriptionResult> {
	const whisperBin = await findWhisperCli();
	const outputBase = audioPath.replace(/\.[^.]+$/, "");

	// Run whisper-cli with JSON output for word-level timing
	const args = [
		"-m", modelPath,
		"-f", audioPath,
		"-l", language === "auto" ? "auto" : language,
		"-ojf", // JSON output with word timestamps
		"-of", outputBase, // Output file prefix
		"-np", // No prints to stdout
	];

	await new Promise<void>((resolve, reject) => {
		const proc = spawn(whisperBin, args, { stdio: "pipe" });
		let stderr = "";

		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`whisper-cli failed (code ${code}): ${stderr.slice(-500)}`));
			}
		});

		proc.on("error", (err) => {
			reject(new Error(`whisper-cli not found. Install via: brew install whisper-cpp\n${err.message}`));
		});
	});

	// Try to read JSON output (word-level timing)
	const jsonPath = `${outputBase}.json`;
	let words: TranscriptionWord[] = [];
	let fullText = "";

	try {
		const jsonContent = await fs.readFile(jsonPath, "utf-8");
		const data = JSON.parse(jsonContent);

		if (data.transcription && Array.isArray(data.transcription)) {
			for (const segment of data.transcription) {
				const segText = (segment.text ?? "").trim();
				if (!segText) continue;

				if (segment.tokens && Array.isArray(segment.tokens)) {
					// Word-level timing from tokens
					for (const token of segment.tokens) {
						const tokenText = (token.text ?? "").trim();
						if (!tokenText || tokenText.startsWith("[")) continue;
						words.push({
							text: tokenText,
							start: (token.offsets?.from ?? segment.offsets?.from ?? 0) / 1000,
							end: (token.offsets?.to ?? segment.offsets?.to ?? 0) / 1000,
							confidence: token.p ?? 0.9,
						});
					}
				} else {
					// Segment-level only — distribute evenly
					const startSec = (segment.offsets?.from ?? 0) / 1000;
					const endSec = (segment.offsets?.to ?? 0) / 1000;
					const segWords = segText.split(/\s+/).filter(Boolean);
					const dur = endSec - startSec;
					const wordDur = segWords.length > 0 ? dur / segWords.length : 0;

					for (let i = 0; i < segWords.length; i++) {
						words.push({
							text: segWords[i]!,
							start: startSec + i * wordDur,
							end: startSec + (i + 1) * wordDur,
							confidence: 0.9,
						});
					}
				}

				fullText += (fullText ? " " : "") + segText;
			}
		}

		// Clean up JSON file
		await fs.unlink(jsonPath).catch(() => {});
	} catch {
		// JSON failed — try SRT fallback
		const srtPath = `${outputBase}.srt`;
		try {
			const srtContent = await fs.readFile(srtPath, "utf-8");
			const segments = parseSRT(srtContent);
			for (const seg of segments) {
				const segWords = seg.text.split(/\s+/).filter(Boolean);
				const dur = seg.end - seg.start;
				const wordDur = segWords.length > 0 ? dur / segWords.length : 0;

				for (let i = 0; i < segWords.length; i++) {
					words.push({
						text: segWords[i]!,
						start: seg.start + i * wordDur,
						end: seg.start + (i + 1) * wordDur,
						confidence: 0.9,
					});
				}
				fullText += (fullText ? " " : "") + seg.text;
			}
			await fs.unlink(srtPath).catch(() => {});
		} catch {
			throw new Error("Failed to parse whisper output — no JSON or SRT produced");
		}
	}

	return { words, fullText, language };
}

function parseSRT(content: string): Array<{ start: number; end: number; text: string }> {
	const blocks = content.trim().split(/\n\n+/);
	const results: Array<{ start: number; end: number; text: string }> = [];

	for (const block of blocks) {
		const lines = block.split("\n");
		if (lines.length < 3) continue;
		const timeLine = lines[1];
		if (!timeLine) continue;
		const match = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
		if (!match) continue;

		const start = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
		const end = Number(match[5]) * 3600 + Number(match[6]) * 60 + Number(match[7]) + Number(match[8]) / 1000;
		const text = lines.slice(2).join(" ").trim();
		if (text) results.push({ start, end, text });
	}

	return results;
}

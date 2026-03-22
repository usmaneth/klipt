import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

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

type WhisperSegment = [string, string, string];

interface WhisperOptions {
	language: string;
	model: string;
	fname_inp: string;
	use_gpu: boolean;
	no_prints: boolean;
	comma_in_time: boolean;
	translate: boolean;
	no_timestamps: boolean;
}

/**
 * Parses a whisper.cpp timestamp string like "[00:00:00.000" or "00:00:05.320]"
 * into seconds.
 */
function parseTimestamp(raw: string): number {
	const cleaned = raw.replace(/[[\]]/g, "").trim();
	const parts = cleaned.split(":");
	if (parts.length !== 3) {
		return 0;
	}
	const hours = Number.parseFloat(parts[0] ?? "0");
	const minutes = Number.parseFloat(parts[1] ?? "0");
	const seconds = Number.parseFloat(parts[2] ?? "0");
	return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Transcribes an audio file using whisper.cpp via native Node addon.
 *
 * @param audioPath - Path to the WAV file (16kHz mono)
 * @param modelPath - Path to the GGML model file
 * @param language - Language code (default: "en")
 * @returns Transcription result with word-level timing
 */
export async function transcribeAudio(
	audioPath: string,
	modelPath: string,
	language = "en",
): Promise<TranscriptionResult> {
	const whisperModule = nodeRequire("whisper-node-addon/dist") as {
		transcribe: (options: WhisperOptions) => Promise<WhisperSegment[]>;
	};

	const segments: WhisperSegment[] = await whisperModule.transcribe({
		language,
		model: modelPath,
		fname_inp: audioPath,
		use_gpu: true,
		no_prints: true,
		comma_in_time: false,
		translate: false,
		no_timestamps: false,
	});

	const words: TranscriptionWord[] = [];
	const textParts: string[] = [];

	for (const segment of segments) {
		const startTime = parseTimestamp(segment[0]);
		const endTime = parseTimestamp(segment[1]);
		const text = (segment[2] ?? "").trim();

		if (!text) {
			continue;
		}

		textParts.push(text);

		// Split segment text into individual words and distribute time evenly
		const segmentWords = text.split(/\s+/).filter(Boolean);
		const segmentDuration = endTime - startTime;
		const wordDuration = segmentWords.length > 0 ? segmentDuration / segmentWords.length : 0;

		for (let i = 0; i < segmentWords.length; i++) {
			const word = segmentWords[i];
			if (!word) {
				continue;
			}
			words.push({
				text: word,
				start: startTime + i * wordDuration,
				end: startTime + (i + 1) * wordDuration,
				confidence: 0.9, // whisper.cpp does not expose per-word confidence
			});
		}
	}

	return {
		words,
		fullText: textParts.join(" "),
		language,
	};
}

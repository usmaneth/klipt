// ElevenLabs text-to-speech provider. Used as a high-quality alternative to
// the default Edge TTS voice for dubbing. Only active when the user has
// supplied an ElevenLabs API key.

import { getApiKey, hasApiKey } from "./apiKeys";

export interface ElevenLabsVoice {
	voice_id: string;
	name: string;
	labels?: Record<string, string>;
	preview_url?: string;
}

export interface ElevenLabsSynthesizeOptions {
	voiceId: string;
	text: string;
	/** ISO language code, used to bias multilingual models. */
	languageCode?: string;
	stability?: number;
	similarityBoost?: number;
	style?: number;
	speakerBoost?: boolean;
	/** Output format. Default `mp3_44100_128` is widely compatible. */
	outputFormat?: string;
	modelId?: string;
	abortSignal?: AbortSignal;
}

const API_BASE = "https://api.elevenlabs.io/v1";

export function isElevenLabsConfigured(): boolean {
	return hasApiKey("elevenlabs");
}

/** Fetch the list of voices available on the caller's ElevenLabs account. */
export async function listElevenLabsVoices(signal?: AbortSignal): Promise<ElevenLabsVoice[]> {
	const apiKey = getApiKey("elevenlabs");
	if (!apiKey) throw new Error("ElevenLabs API key not configured");

	const res = await fetch(`${API_BASE}/voices`, {
		headers: { "xi-api-key": apiKey, Accept: "application/json" },
		signal,
	});
	if (!res.ok) {
		throw new Error(`ElevenLabs voices request failed: ${res.status} ${await res.text()}`);
	}
	const data = (await res.json()) as { voices?: ElevenLabsVoice[] };
	return data.voices ?? [];
}

/** Synthesize speech and return the raw audio bytes. */
export async function synthesizeElevenLabs(
	options: ElevenLabsSynthesizeOptions,
): Promise<ArrayBuffer> {
	const apiKey = getApiKey("elevenlabs");
	if (!apiKey) throw new Error("ElevenLabs API key not configured");

	const format = options.outputFormat ?? "mp3_44100_128";
	const modelId = options.modelId ?? "eleven_multilingual_v2";

	const body = {
		text: options.text,
		model_id: modelId,
		language_code: options.languageCode,
		voice_settings: {
			stability: options.stability ?? 0.5,
			similarity_boost: options.similarityBoost ?? 0.75,
			style: options.style ?? 0,
			use_speaker_boost: options.speakerBoost ?? true,
		},
	};

	const url = `${API_BASE}/text-to-speech/${encodeURIComponent(options.voiceId)}?output_format=${encodeURIComponent(format)}`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			"xi-api-key": apiKey,
			"Content-Type": "application/json",
			Accept: "audio/mpeg",
		},
		body: JSON.stringify(body),
		signal: options.abortSignal,
	});

	if (!res.ok) {
		throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);
	}
	return res.arrayBuffer();
}

/**
 * A handful of curated, cleanly multilingual voice IDs. These are ElevenLabs'
 * "premade" voices which are available on every account and work with the
 * multilingual_v2 model across 30+ languages. Users with a paid account can
 * override these via `listElevenLabsVoices()`.
 */
export const ELEVENLABS_DEFAULT_VOICES: Array<{ id: string; name: string; gender: "f" | "m" }> = [
	{ id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "f" },
	{ id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", gender: "f" },
	{ id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", gender: "f" },
	{ id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", gender: "f" },
	{ id: "pNInz6obpgDQGcFmaJgB", name: "Adam", gender: "m" },
	{ id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", gender: "m" },
	{ id: "VR6AewLTigWG4xSOukaG", name: "Arnold", gender: "m" },
	{ id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", gender: "m" },
];

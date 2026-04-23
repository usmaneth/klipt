// Minimal Google Gemini REST client used by klipt's AI features.
// We intentionally avoid bundling @google/genai to keep the Electron build lean:
// Gemini's generateContent REST surface is small and stable enough to call directly.

import { getApiKey } from "./apiKeys";

const DEFAULT_MODEL = "gemini-2.5-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiUnavailableError extends Error {
	constructor() {
		super("Gemini API key not configured");
		this.name = "GeminiUnavailableError";
	}
}

export interface GenerateOptions {
	model?: string;
	systemInstruction?: string;
	temperature?: number;
	maxOutputTokens?: number;
	/** If true, enforces JSON response. */
	responseJson?: boolean;
	abortSignal?: AbortSignal;
}

export interface GeminiImagePart {
	mimeType: string;
	/** Base64-encoded data (no `data:` prefix). */
	data: string;
}

interface GeminiResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		finishReason?: string;
	}>;
	error?: { message?: string };
}

/**
 * Low-level: call Gemini generateContent with arbitrary parts (text + inline images).
 */
export async function generateContent(
	parts: Array<{ text: string } | { inlineData: GeminiImagePart }>,
	options: GenerateOptions = {},
): Promise<string> {
	const apiKey = getApiKey("gemini");
	if (!apiKey) throw new GeminiUnavailableError();

	const model = options.model ?? DEFAULT_MODEL;
	const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

	const body: Record<string, unknown> = {
		contents: [{ role: "user", parts }],
		generationConfig: {
			temperature: options.temperature ?? 0.4,
			maxOutputTokens: options.maxOutputTokens ?? 2048,
			...(options.responseJson ? { responseMimeType: "application/json" } : {}),
		},
	};
	if (options.systemInstruction) {
		body.systemInstruction = { role: "system", parts: [{ text: options.systemInstruction }] };
	}

	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: options.abortSignal,
	});

	if (!res.ok) {
		const detail = await res.text().catch(() => res.statusText);
		throw new Error(`Gemini ${res.status}: ${detail.slice(0, 500)}`);
	}

	const data = (await res.json()) as GeminiResponse;
	if (data.error?.message) throw new Error(data.error.message);

	const text = data.candidates?.[0]?.content?.parts
		?.map((p) => p.text ?? "")
		.join("")
		.trim();

	return text ?? "";
}

/** Convenience: send a single text prompt and get text back. */
export async function generateText(prompt: string, options: GenerateOptions = {}): Promise<string> {
	return generateContent([{ text: prompt }], options);
}

/**
 * Convenience: prompt Gemini for structured JSON. Throws if the reply can't
 * be parsed. Strips common ```json fences Gemini occasionally emits.
 */
export async function generateJson<T>(
	prompt: string,
	options: Omit<GenerateOptions, "responseJson"> = {},
): Promise<T> {
	const raw = await generateText(prompt, { ...options, responseJson: true });
	return parseJsonReply<T>(raw);
}

export function parseJsonReply<T>(raw: string): T {
	let text = raw.trim();
	// Strip triple-backtick fences if present.
	const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
	if (fence) text = fence[1]!.trim();
	// If the model emitted prose + JSON, grab the first top-level object/array.
	if (!text.startsWith("{") && !text.startsWith("[")) {
		const idx = text.search(/[{[]/);
		if (idx >= 0) text = text.slice(idx);
	}
	return JSON.parse(text) as T;
}

export function isGeminiConfigured(): boolean {
	return getApiKey("gemini") !== undefined;
}

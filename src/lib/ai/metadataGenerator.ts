// AI metadata generator — produces YouTube/Shorts-ready titles, descriptions,
// hashtags, and chapter-stamped descriptions from a transcript + optional
// chapter list. Gemini-backed; throws when the API key isn't configured so
// the UI can surface a clear call-to-action.

import type { Chapter } from "./chapterDetector";
import { generateJson, isGeminiConfigured } from "./geminiClient";

export interface VideoMetadata {
	title: string;
	/** Five alternative titles ranked from strongest to weakest. */
	titleVariants: string[];
	description: string;
	hashtags: string[];
	tags: string[];
}

export interface MetadataOptions {
	/** Plain transcript text, or a list of words. */
	transcript: string | Array<{ text: string; start: number; end: number }>;
	chapters?: Chapter[];
	/** Target platform — biases tone and length. */
	platform?: "youtube" | "shorts" | "tiktok" | "instagram";
	/** Topic or niche hint from the user. */
	topicHint?: string;
	/** Abort for cancellation. */
	signal?: AbortSignal;
}

export function isMetadataGeneratorAvailable(): boolean {
	return isGeminiConfigured();
}

export async function generateVideoMetadata(options: MetadataOptions): Promise<VideoMetadata> {
	if (!isGeminiConfigured()) {
		throw new Error("Gemini API key required for metadata generation");
	}

	const platform = options.platform ?? "youtube";
	const transcriptText =
		typeof options.transcript === "string"
			? options.transcript
			: options.transcript.map((w) => w.text).join(" ");

	// Cap transcript length so we don't blow up the prompt on multi-hour videos.
	const MAX_CHARS = 12_000;
	const trimmed =
		transcriptText.length > MAX_CHARS
			? `${transcriptText.slice(0, MAX_CHARS)}\n[truncated...]`
			: transcriptText;

	const toneGuidance: Record<NonNullable<MetadataOptions["platform"]>, string> = {
		youtube:
			"Long-form. Title max 70 chars, SEO-driven. Description 3-4 short paragraphs, ends with 5-10 hashtags.",
		shorts:
			"Vertical short. Title max 50 chars, punchy hook. Description under 200 chars, 5 hashtags.",
		tiktok:
			"TikTok-native. Title max 60 chars, uses hook words (POV:, Why, How). Description under 250 chars, 8 hashtags including trending.",
		instagram:
			"Reels-style. Title/caption max 60 chars, emotional hook. Description under 400 chars, 10 hashtags mixing broad + niche.",
	};

	const chapterBlock =
		options.chapters && options.chapters.length > 0
			? `\n\nDetected chapters (timestamps in seconds):\n${options.chapters
					.map((c) => `- ${(c.startMs / 1000).toFixed(0)}s: ${c.title}`)
					.join("\n")}`
			: "";

	const hintBlock = options.topicHint ? `\nTopic hint: ${options.topicHint}` : "";

	const prompt = `You are writing metadata for a ${platform} video so it performs well on launch day.

Tone & length: ${toneGuidance[platform]}

Requirements:
- Never invent facts not present in the transcript.
- Description must include chapter timestamps in \`MM:SS Title\` format if chapters exist.
- Tags are single words or short phrases (no "#" prefix), 10-15 items.
- Hashtags are platform-native (#camelCase), 5-10 items.
- Return 5 alternative titles that try different hooks (question, benefit, curiosity gap, contrarian, list).${hintBlock}${chapterBlock}

Transcript:
${trimmed}

Respond with JSON:
{
  "title": string,
  "title_variants": string[5],
  "description": string,
  "hashtags": string[],
  "tags": string[]
}`;

	interface GeminiMetadata {
		title: string;
		title_variants?: string[];
		description: string;
		hashtags?: string[];
		tags?: string[];
	}

	const parsed = await generateJson<GeminiMetadata>(prompt, {
		temperature: 0.7,
		maxOutputTokens: 2048,
		abortSignal: options.signal,
	});

	return {
		title: (parsed.title ?? "").trim(),
		titleVariants: Array.isArray(parsed.title_variants)
			? parsed.title_variants
					.map((t) => t.trim())
					.filter(Boolean)
					.slice(0, 5)
			: [],
		description: (parsed.description ?? "").trim(),
		hashtags: Array.isArray(parsed.hashtags)
			? parsed.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 15)
			: [],
		tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 20) : [],
	};
}

/**
 * Render a chapter block (YouTube-style) that can be appended to any
 * description. Safe to call with an empty chapter list.
 */
export function formatChapterBlock(chapters: Chapter[]): string {
	if (chapters.length === 0) return "";
	const lines = chapters.map((c) => {
		const totalSec = Math.max(0, Math.round(c.startMs / 1000));
		const h = Math.floor(totalSec / 3600);
		const m = Math.floor((totalSec % 3600) / 60);
		const s = totalSec % 60;
		const stamp =
			h > 0
				? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
				: `${m}:${String(s).padStart(2, "0")}`;
		return `${stamp} ${c.title}`;
	});
	return lines.join("\n");
}

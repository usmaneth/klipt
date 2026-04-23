// Highlight / "viral moment" detection — find the most engaging segments in a
// long-form video. Two backends are available:
//
//   1. Gemini-powered backend (when a Gemini API key is configured): asks the
//      model to rank candidate clips from the transcript using the same kind of
//      reasoning OpenShorts uses (hook strength, emotional payoff, self-contained
//      context, audience-relevant keywords).
//   2. Heuristic backend: speech density + keyword hits + question patterns +
//      silence snapping. Used as fallback and remains the default when the user
//      has no Gemini key.

import { generateJson, isGeminiConfigured } from "./geminiClient";

export interface HighlightCandidate {
	id: string;
	startMs: number;
	endMs: number;
	score: number; // 0-100
	reason: string; // "Dense speech", "Hook + Q&A", etc.
	title?: string; // short caption-ready title when available
	source?: "heuristic" | "gemini";
}

export interface HighlightOptions {
	minDurationMs?: number;
	maxDurationMs?: number;
	maxHighlights?: number;
	/**
	 * Prefer Gemini when a key is configured. Defaults to true.
	 * Set false to force the heuristic backend.
	 */
	useGemini?: boolean;
	/** Optional abort signal for the Gemini request. */
	signal?: AbortSignal;
}

// Words that signal engaging / important moments
const EXCLAMATORY_KEYWORDS = new Set([
	"amazing",
	"incredible",
	"wow",
	"important",
	"key",
	"secret",
	"but",
	"however",
	"unbelievable",
	"insane",
	"crazy",
	"actually",
	"literally",
	"exactly",
	"absolutely",
	"listen",
	"look",
	"surprise",
	"shocking",
	"breaking",
	"crucial",
	"hack",
	"tip",
	"trick",
	"never",
	"always",
	"best",
	"worst",
	"biggest",
	"number one",
	"first",
	"finally",
	"game changer",
]);

interface TranscriptionWord {
	text: string;
	start: number; // seconds
	end: number; // seconds
}

interface ScoredWindow {
	startMs: number;
	endMs: number;
	score: number;
	reasons: string[];
}

/**
 * Public entry point. Picks the best backend (Gemini if configured + allowed)
 * and falls back to the heuristic algorithm on any failure.
 */
export async function detectHighlights(
	totalDurationMs: number,
	transcriptionWords: TranscriptionWord[],
	options?: HighlightOptions,
): Promise<HighlightCandidate[]> {
	const wantGemini = options?.useGemini !== false && isGeminiConfigured();
	if (wantGemini) {
		try {
			const gemini = await detectHighlightsGemini(totalDurationMs, transcriptionWords, options);
			if (gemini.length > 0) return gemini;
		} catch (err) {
			console.warn("[highlightDetector] Gemini backend failed, falling back:", err);
		}
	}
	return detectHighlightsHeuristic(totalDurationMs, transcriptionWords, options);
}

/**
 * Synchronous heuristic-only detection. Useful for tests, offline mode, and
 * as the deterministic fallback.
 *
 * Algorithm:
 * 1. Slide a window (minDuration–maxDuration, step 5s) across the transcript
 * 2. Score each window: speech density + keyword density + question patterns
 * 3. Snap boundaries to nearby silence gaps
 * 4. Take top N non-overlapping windows
 */
export function detectHighlightsHeuristic(
	totalDurationMs: number,
	transcriptionWords: TranscriptionWord[],
	options?: HighlightOptions,
): HighlightCandidate[] {
	const minDurationMs = options?.minDurationMs ?? 15_000;
	const maxDurationMs = options?.maxDurationMs ?? 60_000;
	const maxHighlights = options?.maxHighlights ?? 10;
	const stepMs = 5_000;

	if (transcriptionWords.length === 0 || totalDurationMs <= 0) return [];

	// Pre-compute silence gaps (gaps > 500ms between consecutive words)
	const silenceGaps: Array<{ startMs: number; endMs: number }> = [];
	for (let i = 1; i < transcriptionWords.length; i++) {
		const prev = transcriptionWords[i - 1]!;
		const curr = transcriptionWords[i]!;
		const gapMs = (curr.start - prev.end) * 1000;
		if (gapMs > 500) {
			silenceGaps.push({
				startMs: Math.round(prev.end * 1000),
				endMs: Math.round(curr.start * 1000),
			});
		}
	}

	// Try multiple window sizes
	const windowSizes = [15_000, 30_000, 45_000, 60_000].filter(
		(s) => s >= minDurationMs && s <= maxDurationMs,
	);
	if (windowSizes.length === 0) windowSizes.push(minDurationMs);

	const allWindows: ScoredWindow[] = [];

	for (const windowMs of windowSizes) {
		for (let startMs = 0; startMs + windowMs <= totalDurationMs; startMs += stepMs) {
			const endMs = startMs + windowMs;
			const windowWords = getWordsInRange(transcriptionWords, startMs, endMs);

			if (windowWords.length < 3) continue;

			const { score, reasons } = scoreWindow(windowWords, windowMs);
			allWindows.push({ startMs, endMs, score, reasons });
		}
	}

	// Sort by score descending
	allWindows.sort((a, b) => b.score - a.score);

	// Pick top N non-overlapping, snapping boundaries to silence gaps
	const selected: HighlightCandidate[] = [];
	for (const win of allWindows) {
		if (selected.length >= maxHighlights) break;

		// Check overlap with already selected
		const overlaps = selected.some((s) => win.startMs < s.endMs && win.endMs > s.startMs);
		if (overlaps) continue;

		// Snap start to nearest silence gap
		const snappedStart = snapToSilence(win.startMs, silenceGaps, "start");
		const snappedEnd = snapToSilence(win.endMs, silenceGaps, "end");

		// Ensure duration stays within bounds after snapping
		const actualDuration = snappedEnd - snappedStart;
		if (actualDuration < minDurationMs * 0.8 || actualDuration > maxDurationMs * 1.2) {
			// Use unsnapped boundaries
			selected.push({
				id: `highlight-${selected.length}`,
				startMs: win.startMs,
				endMs: win.endMs,
				score: Math.round(win.score),
				reason: win.reasons.join(", "),
				source: "heuristic",
			});
		} else {
			selected.push({
				id: `highlight-${selected.length}`,
				startMs: snappedStart,
				endMs: snappedEnd,
				score: Math.round(win.score),
				reason: win.reasons.join(", "),
				source: "heuristic",
			});
		}
	}

	// Sort by time for display
	selected.sort((a, b) => a.startMs - b.startMs);
	return selected;
}

// ── Gemini backend ───────────────────────────────────────────────────────────

interface GeminiClip {
	start_sec: number;
	end_sec: number;
	score: number; // 0-100
	title: string;
	reason: string;
}

async function detectHighlightsGemini(
	totalDurationMs: number,
	words: TranscriptionWord[],
	options?: HighlightOptions,
): Promise<HighlightCandidate[]> {
	if (words.length === 0 || totalDurationMs <= 0) return [];

	const minDur = (options?.minDurationMs ?? 15_000) / 1000;
	const maxDur = (options?.maxDurationMs ?? 60_000) / 1000;
	const maxClips = options?.maxHighlights ?? 10;

	// Compress transcript into ~5s segments to keep the prompt tractable.
	const segments = groupWordsIntoSegments(words, 5);
	const transcriptBlock = segments
		.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}s] ${s.text}`)
		.join("\n");

	const prompt = `You are a viral short-form video editor. Read the transcript below and extract the MOST engaging clips that work as standalone TikTok/Reels/Shorts.

Rules:
- Each clip must be ${minDur.toFixed(0)}–${maxDur.toFixed(0)} seconds long.
- Return at most ${maxClips} clips.
- Prefer segments with a strong hook in the first 3 seconds, clear payoff, self-contained context (no dangling references), and emotional or informational density.
- Timestamps must align to the [start-end] brackets in the transcript — do not invent times.
- Score each clip 0-100 for viral potential.
- Title each clip in 6 words or fewer, punchy, no clickbait emojis.

Transcript:
${transcriptBlock}

Respond with JSON: { "clips": [{ "start_sec": number, "end_sec": number, "score": number, "title": string, "reason": string }] }`;

	const parsed = await generateJson<{ clips: GeminiClip[] }>(prompt, {
		temperature: 0.5,
		maxOutputTokens: 2048,
		abortSignal: options?.signal,
	});

	const clips = Array.isArray(parsed?.clips) ? parsed.clips : [];
	return clips
		.map((c, i): HighlightCandidate | null => {
			const startMs = Math.max(0, Math.round(c.start_sec * 1000));
			const endMs = Math.min(totalDurationMs, Math.round(c.end_sec * 1000));
			if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
			if (endMs - startMs < Math.min(5_000, minDur * 1000 * 0.5)) return null;
			return {
				id: `highlight-gemini-${i}`,
				startMs,
				endMs,
				score: Math.max(0, Math.min(100, Math.round(c.score ?? 50))),
				reason: c.reason?.slice(0, 160) ?? "Gemini-selected",
				title: c.title?.slice(0, 80),
				source: "gemini",
			};
		})
		.filter((c): c is HighlightCandidate => c !== null)
		.sort((a, b) => a.startMs - b.startMs);
}

function groupWordsIntoSegments(
	words: TranscriptionWord[],
	windowSec: number,
): Array<{ start: number; end: number; text: string }> {
	if (words.length === 0) return [];
	const segments: Array<{ start: number; end: number; text: string }> = [];
	let bucketStart = words[0]!.start;
	let bucketWords: TranscriptionWord[] = [];

	for (const w of words) {
		if (w.start - bucketStart >= windowSec && bucketWords.length > 0) {
			segments.push({
				start: bucketStart,
				end: bucketWords[bucketWords.length - 1]!.end,
				text: bucketWords.map((x) => x.text).join(" "),
			});
			bucketStart = w.start;
			bucketWords = [];
		}
		bucketWords.push(w);
	}
	if (bucketWords.length > 0) {
		segments.push({
			start: bucketStart,
			end: bucketWords[bucketWords.length - 1]!.end,
			text: bucketWords.map((x) => x.text).join(" "),
		});
	}
	return segments;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function getWordsInRange(
	words: TranscriptionWord[],
	startMs: number,
	endMs: number,
): TranscriptionWord[] {
	const startSec = startMs / 1000;
	const endSec = endMs / 1000;
	return words.filter((w) => w.start >= startSec && w.end <= endSec);
}

function scoreWindow(
	words: TranscriptionWord[],
	windowMs: number,
): { score: number; reasons: string[] } {
	let score = 0;
	const reasons: string[] = [];
	const windowSec = windowMs / 1000;

	// 1. Speech density — words per second (max contribution: 40 pts)
	const wps = words.length / windowSec;
	const densityScore = Math.min(40, (wps / 3.5) * 40); // 3.5 wps is "very fast"
	if (densityScore > 20) reasons.push("Dense speech");
	score += densityScore;

	// 2. Keyword density (max contribution: 30 pts)
	let keywordHits = 0;
	for (const w of words) {
		const lower = w.text.toLowerCase().replace(/[.,!?;:'"]/g, "");
		if (EXCLAMATORY_KEYWORDS.has(lower)) keywordHits++;
	}
	const keywordScore = Math.min(30, (keywordHits / words.length) * 150);
	if (keywordHits > 0) reasons.push(`Key phrases (${keywordHits})`);
	score += keywordScore;

	// 3. Question patterns (max contribution: 20 pts)
	const fullText = words.map((w) => w.text).join(" ");
	const questionCount = (fullText.match(/\?/g) ?? []).length;
	const questionScore = Math.min(20, questionCount * 7);
	if (questionCount > 0) reasons.push("Q&A segment");
	score += questionScore;

	// 4. Variety bonus — many unique words signal informational content (max: 10 pts)
	const uniqueWords = new Set(words.map((w) => w.text.toLowerCase().replace(/[.,!?;:'"]/g, "")));
	const varietyRatio = uniqueWords.size / words.length;
	const varietyScore = Math.min(10, varietyRatio * 12);
	score += varietyScore;

	if (reasons.length === 0) reasons.push("Moderate engagement");

	return { score: Math.min(100, score), reasons };
}

function snapToSilence(
	timeMs: number,
	gaps: Array<{ startMs: number; endMs: number }>,
	side: "start" | "end",
): number {
	const SNAP_RANGE_MS = 3000; // snap up to 3s
	let bestGap: { startMs: number; endMs: number } | null = null;
	let bestDist = SNAP_RANGE_MS + 1;

	for (const gap of gaps) {
		// For start snapping, snap to gap.endMs (just after silence)
		// For end snapping, snap to gap.startMs (just before silence)
		const snapTarget = side === "start" ? gap.endMs : gap.startMs;
		const dist = Math.abs(snapTarget - timeMs);
		if (dist < bestDist) {
			bestDist = dist;
			bestGap = gap;
		}
	}

	if (bestGap && bestDist <= SNAP_RANGE_MS) {
		return side === "start" ? bestGap.endMs : bestGap.startMs;
	}
	return timeMs;
}

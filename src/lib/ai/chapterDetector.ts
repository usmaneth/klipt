// Chapter detection — auto-generate chapter markers from transcript cues
// using topic shift detection, keyword triggers, silence gaps, and TF-IDF title generation.

export interface Chapter {
	startMs: number;
	endMs: number;
	title: string;
	confidence: number; // 0-1
}

interface ChapterOptions {
	minDurationMs?: number;
	maxChapters?: number;
	silenceGaps?: Array<{ startMs: number; endMs: number }>;
}

interface Cue {
	startMs: number;
	endMs: number;
	text: string;
}

// Phrases that signal a topic transition
const KEYWORD_TRIGGERS = [
	"next",
	"moving on",
	"let's talk about",
	"so now",
	"another thing",
	"first",
	"second",
	"third",
	"finally",
	"in conclusion",
	"let me show you",
	"the next step",
	"now let's",
	"alright so",
	"okay so",
	"on to",
	"switching to",
	"let's move on",
	"the last thing",
	"to wrap up",
	"to summarize",
	"one more thing",
	"before we start",
	"let's begin",
	"getting started",
];

// Common stop words to exclude from title generation
const STOP_WORDS = new Set([
	"the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
	"have", "has", "had", "do", "does", "did", "will", "would", "could",
	"should", "may", "might", "shall", "can", "need", "dare", "ought",
	"used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
	"as", "into", "through", "during", "before", "after", "above", "below",
	"between", "out", "off", "over", "under", "again", "further", "then",
	"once", "here", "there", "when", "where", "why", "how", "all", "both",
	"each", "few", "more", "most", "other", "some", "such", "no", "nor",
	"not", "only", "own", "same", "so", "than", "too", "very", "just",
	"don't", "should", "now", "and", "but", "or", "if", "while", "that",
	"this", "it", "its", "i", "you", "he", "she", "we", "they", "me",
	"him", "her", "us", "them", "my", "your", "his", "our", "their",
	"what", "which", "who", "whom", "these", "those", "am", "about",
	"up", "like", "also", "really", "actually", "going", "gonna", "thing",
	"things", "get", "got", "know", "think", "say", "said", "make",
	"right", "well", "okay", "oh", "um", "uh", "yeah", "yes", "no",
]);

/**
 * Detect chapter boundaries from caption cues.
 *
 * Algorithm:
 * 1. Group cues into sliding windows and compute topic shift scores
 *    using Jaccard similarity between adjacent windows.
 * 2. Boost boundaries near keyword triggers and silence gaps.
 * 3. Select top boundaries that respect minimum duration constraints.
 * 4. Generate chapter titles using TF-IDF-style scoring.
 */
export function detectChapters(
	cues: Cue[],
	options?: ChapterOptions,
): Chapter[] {
	const minDurationMs = options?.minDurationMs ?? 30_000;
	const maxChapters = options?.maxChapters ?? 12;
	const silenceGaps = options?.silenceGaps ?? [];

	if (cues.length === 0) return [];

	const totalStart = cues[0]!.startMs;
	const totalEnd = cues[cues.length - 1]!.endMs;
	const totalDuration = totalEnd - totalStart;

	// Too short for chapters
	if (totalDuration < minDurationMs * 2) return [];

	// ── Step 1: Score every cue boundary for topic shift ──────────────────

	const WINDOW_SIZE = 8; // number of cues per window
	const boundaryScores: Array<{ cueIndex: number; score: number }> = [];

	for (let i = WINDOW_SIZE; i < cues.length - WINDOW_SIZE; i++) {
		const leftCues = cues.slice(Math.max(0, i - WINDOW_SIZE), i);
		const rightCues = cues.slice(i, Math.min(cues.length, i + WINDOW_SIZE));

		const leftWords = extractWordSet(leftCues);
		const rightWords = extractWordSet(rightCues);

		// Jaccard distance = 1 - Jaccard similarity (higher = more different = stronger boundary)
		const jaccardDist = 1 - jaccardSimilarity(leftWords, rightWords);

		// Keyword trigger bonus
		const keywordBonus = hasKeywordTrigger(rightCues.slice(0, 3)) ? 0.3 : 0;

		// Silence gap bonus — check if there's a silence gap near this cue boundary
		const boundaryTime = cues[i]!.startMs;
		const silenceBonus = hasSilenceNear(boundaryTime, silenceGaps, 2000) ? 0.2 : 0;

		const score = jaccardDist + keywordBonus + silenceBonus;
		boundaryScores.push({ cueIndex: i, score });
	}

	if (boundaryScores.length === 0) return [];

	// ── Step 2: Select top boundaries respecting min duration ─────────────

	// Sort by score descending
	boundaryScores.sort((a, b) => b.score - a.score);

	const selectedBoundaryIndices: number[] = [];

	for (const candidate of boundaryScores) {
		if (selectedBoundaryIndices.length >= maxChapters - 1) break;

		const candidateTime = cues[candidate.cueIndex]!.startMs;

		// Check distance from already-selected boundaries
		const tooClose = selectedBoundaryIndices.some((idx) => {
			const existingTime = cues[idx]!.startMs;
			return Math.abs(candidateTime - existingTime) < minDurationMs;
		});

		// Also check distance from start/end
		if (tooClose) continue;
		if (candidateTime - totalStart < minDurationMs) continue;
		if (totalEnd - candidateTime < minDurationMs) continue;

		selectedBoundaryIndices.push(candidate.cueIndex);
	}

	// Sort boundaries by time
	selectedBoundaryIndices.sort((a, b) => a - b);

	if (selectedBoundaryIndices.length === 0) return [];

	// ── Step 3: Build chapter segments ───────────────────────────────────

	interface Segment {
		startMs: number;
		endMs: number;
		cues: Cue[];
		boundaryScore: number;
	}

	const segments: Segment[] = [];
	let segStart = 0;

	for (let i = 0; i <= selectedBoundaryIndices.length; i++) {
		const segEnd = i < selectedBoundaryIndices.length ? selectedBoundaryIndices[i]! : cues.length;
		const segCues = cues.slice(segStart, segEnd);

		if (segCues.length > 0) {
			const boundaryScore = i < selectedBoundaryIndices.length
				? (boundaryScores.find((b) => b.cueIndex === selectedBoundaryIndices[i])?.score ?? 0)
				: 0;

			segments.push({
				startMs: segCues[0]!.startMs,
				endMs: segCues[segCues.length - 1]!.endMs,
				cues: segCues,
				boundaryScore,
			});
		}

		segStart = segEnd;
	}

	if (segments.length <= 1) return [];

	// ── Step 4: Generate titles using TF-IDF ─────────────────────────────

	// Compute document frequencies across all segments
	const segmentWordSets = segments.map((seg) =>
		extractContentWords(seg.cues),
	);
	const docFreq = new Map<string, number>();
	for (const wordSet of segmentWordSets) {
		for (const word of wordSet) {
			docFreq.set(word, (docFreq.get(word) ?? 0) + 1);
		}
	}

	const numSegments = segments.length;

	const chapters: Chapter[] = segments.map((seg, idx) => {
		const wordCounts = countWords(seg.cues);
		const wordSet = segmentWordSets[idx]!;

		// TF-IDF scoring
		const scored: Array<{ word: string; tfidf: number }> = [];
		for (const word of wordSet) {
			if (STOP_WORDS.has(word)) continue;
			if (word.length < 3) continue;

			const tf = (wordCounts.get(word) ?? 0) / Math.max(1, seg.cues.length);
			const df = docFreq.get(word) ?? 1;
			const idf = Math.log((numSegments + 1) / (df + 1)) + 1;
			scored.push({ word, tfidf: tf * idf });
		}

		scored.sort((a, b) => b.tfidf - a.tfidf);

		// Take top 3-5 distinctive words for the title
		const titleWords = scored.slice(0, 4).map((s) => s.word);
		const title = titleWords.length > 0
			? capitalizeTitle(titleWords.join(" "))
			: `Chapter ${idx + 1}`;

		// Confidence based on boundary score (normalize)
		const maxScore = boundaryScores.length > 0 ? boundaryScores[0]!.score : 1;
		const confidence = idx === 0
			? 0.8 // First chapter always gets decent confidence
			: Math.min(1, Math.max(0.2, seg.boundaryScore / Math.max(0.01, maxScore)));

		return {
			startMs: seg.startMs,
			endMs: seg.endMs,
			title,
			confidence: Math.round(confidence * 100) / 100,
		};
	});

	return chapters;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s'-]/g, "")
		.split(/\s+/)
		.filter((w) => w.length > 0);
}

function extractWordSet(cues: Cue[]): Set<string> {
	const words = new Set<string>();
	for (const cue of cues) {
		for (const token of tokenize(cue.text)) {
			if (!STOP_WORDS.has(token) && token.length > 2) {
				words.add(token);
			}
		}
	}
	return words;
}

function extractContentWords(cues: Cue[]): Set<string> {
	const words = new Set<string>();
	for (const cue of cues) {
		for (const token of tokenize(cue.text)) {
			words.add(token);
		}
	}
	return words;
}

function countWords(cues: Cue[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const cue of cues) {
		for (const token of tokenize(cue.text)) {
			counts.set(token, (counts.get(token) ?? 0) + 1);
		}
	}
	return counts;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 1;

	let intersection = 0;
	for (const word of a) {
		if (b.has(word)) intersection++;
	}

	const union = a.size + b.size - intersection;
	return union === 0 ? 1 : intersection / union;
}

function hasKeywordTrigger(cues: Cue[]): boolean {
	const text = cues.map((c) => c.text).join(" ").toLowerCase();
	return KEYWORD_TRIGGERS.some((trigger) => text.includes(trigger));
}

function hasSilenceNear(
	timeMs: number,
	gaps: Array<{ startMs: number; endMs: number }>,
	thresholdMs: number,
): boolean {
	return gaps.some(
		(gap) =>
			Math.abs(gap.startMs - timeMs) < thresholdMs ||
			Math.abs(gap.endMs - timeMs) < thresholdMs,
	);
}

function capitalizeTitle(text: string): string {
	return text
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

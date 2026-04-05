// Highlight detection — find the most engaging segments in a long-form video
// based on transcription data alone (speech density, keywords, questions, pauses).

export interface HighlightCandidate {
	id: string;
	startMs: number;
	endMs: number;
	score: number; // 0-100
	reason: string; // "High audio energy", "Dense speech", etc.
}

export interface HighlightOptions {
	minDurationMs?: number;
	maxDurationMs?: number;
	maxHighlights?: number;
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
 * Detect highlight candidates from transcription data.
 *
 * Algorithm:
 * 1. Slide a window (minDuration–maxDuration, step 5s) across the transcript
 * 2. Score each window: speech density + keyword density + question patterns
 * 3. Snap boundaries to nearby silence gaps
 * 4. Take top N non-overlapping windows
 */
export function detectHighlights(
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
		const overlaps = selected.some(
			(s) => win.startMs < s.endMs && win.endMs > s.startMs,
		);
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
			});
		} else {
			selected.push({
				id: `highlight-${selected.length}`,
				startMs: snappedStart,
				endMs: snappedEnd,
				score: Math.round(win.score),
				reason: win.reasons.join(", "),
			});
		}
	}

	// Sort by time for display
	selected.sort((a, b) => a.startMs - b.startMs);
	return selected;
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

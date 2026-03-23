// Caption layout engine — cost-based line breaking, word flattening, pagination

export interface CaptionCue {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	words?: CaptionWord[];
}

export interface CaptionWord {
	text: string;
	startMs: number;
	endMs: number;
}

export interface CaptionLine {
	words: CaptionWord[];
	startMs: number;
	endMs: number;
}

export interface CaptionPage {
	lines: CaptionLine[];
	startMs: number;
	endMs: number;
}

export type WordAnimationState = "active" | "upcoming" | "spoken";

export interface AnimatedWord {
	text: string;
	startMs: number;
	endMs: number;
	state: WordAnimationState;
}

export interface ActiveCaptionLayout {
	page: CaptionPage | null;
	words: AnimatedWord[];
}

/**
 * Merges cues into a flat, time-ordered word array.
 * If a cue has word-level timing, use it directly; otherwise evenly
 * distribute the cue's time span across its whitespace-split tokens.
 */
export function flattenCaptionWords(cues: CaptionCue[]): CaptionWord[] {
	const words: CaptionWord[] = [];

	for (const cue of cues) {
		if (cue.words && cue.words.length > 0) {
			for (const w of cue.words) {
				words.push({ text: w.text, startMs: w.startMs, endMs: w.endMs });
			}
		} else {
			const tokens = cue.text.split(/\s+/).filter(Boolean);
			if (tokens.length === 0) continue;
			const span = cue.endMs - cue.startMs;
			const wordDur = span / tokens.length;
			for (let i = 0; i < tokens.length; i++) {
				words.push({
					text: tokens[i],
					startMs: cue.startMs + i * wordDur,
					endMs: cue.startMs + (i + 1) * wordDur,
				});
			}
		}
	}

	return words;
}

/**
 * Measures the pixel width of a string using a shared offscreen canvas.
 * Font must be specified as a CSS font shorthand (e.g. "bold 30px Inter").
 */
let measureCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let measureCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

function measureText(text: string, font: string): number {
	if (!measureCanvas) {
		if (typeof OffscreenCanvas !== "undefined") {
			measureCanvas = new OffscreenCanvas(1, 1);
		} else {
			measureCanvas = document.createElement("canvas");
		}
		measureCtx = measureCanvas.getContext("2d") as
			| OffscreenCanvasRenderingContext2D
			| CanvasRenderingContext2D;
	}
	if (!measureCtx) return text.length * 12;
	measureCtx.font = font;
	return measureCtx.measureText(text).width;
}

/**
 * Cost-based (Knuth-Plass-lite) line breaking.
 * Minimises the sum of squared slack per line instead of greedily
 * filling each line.  Falls back to greedy when the DP table would be
 * too large (> 500 words).
 */
export function buildCaptionLines(
	words: CaptionWord[],
	maxWidth: number,
	fontSize: number,
	fontFamily = "Inter, system-ui, sans-serif",
): CaptionLine[] {
	if (words.length === 0) return [];

	const font = `bold ${fontSize}px ${fontFamily}`;
	const spaceWidth = measureText(" ", font);

	// Pre-measure every word
	const widths = words.map((w) => measureText(w.text, font));

	const n = words.length;

	// For very long transcripts fall back to greedy to avoid O(n^2) blowup
	if (n > 500) {
		return greedyBreak(words, widths, maxWidth, spaceWidth);
	}

	// cost[i] = minimum total cost for words[i..n-1]
	const cost = new Float64Array(n + 1);
	const breaks = new Int32Array(n + 1); // breaks[i] = first word of next line
	cost[n] = 0;

	for (let i = n - 1; i >= 0; i--) {
		let lineWidth = 0;
		let bestCost = Infinity;
		let bestBreak = n;

		for (let j = i; j < n; j++) {
			lineWidth += widths[j] + (j > i ? spaceWidth : 0);
			if (lineWidth > maxWidth && j > i) break; // stop extending once exceeded (except single-word lines)

			const slack = maxWidth - lineWidth;
			const lineCost = slack * slack;
			const total = lineCost + cost[j + 1];

			if (total < bestCost) {
				bestCost = total;
				bestBreak = j + 1;
			}
		}

		cost[i] = bestCost;
		breaks[i] = bestBreak;
	}

	// Reconstruct lines
	const lines: CaptionLine[] = [];
	let idx = 0;
	while (idx < n) {
		const end = breaks[idx];
		const lineWords = words.slice(idx, end);
		lines.push({
			words: lineWords,
			startMs: lineWords[0].startMs,
			endMs: lineWords[lineWords.length - 1].endMs,
		});
		idx = end;
	}
	return lines;
}

function greedyBreak(
	words: CaptionWord[],
	widths: number[],
	maxWidth: number,
	spaceWidth: number,
): CaptionLine[] {
	const lines: CaptionLine[] = [];
	let lineStart = 0;
	let lineWidth = 0;

	for (let i = 0; i < words.length; i++) {
		const addedWidth = i === lineStart ? widths[i] : spaceWidth + widths[i];
		if (lineWidth + addedWidth > maxWidth && i > lineStart) {
			const lineWords = words.slice(lineStart, i);
			lines.push({
				words: lineWords,
				startMs: lineWords[0].startMs,
				endMs: lineWords[lineWords.length - 1].endMs,
			});
			lineStart = i;
			lineWidth = widths[i];
		} else {
			lineWidth += addedWidth;
		}
	}

	if (lineStart < words.length) {
		const lineWords = words.slice(lineStart);
		lines.push({
			words: lineWords,
			startMs: lineWords[0].startMs,
			endMs: lineWords[lineWords.length - 1].endMs,
		});
	}

	return lines;
}

/**
 * Splits lines into pages that contain at most `maxRows` lines each.
 */
export function buildCaptionPages(lines: CaptionLine[], maxRows: number): CaptionPage[] {
	if (lines.length === 0) return [];
	const pages: CaptionPage[] = [];

	for (let i = 0; i < lines.length; i += maxRows) {
		const pageLines = lines.slice(i, i + maxRows);
		pages.push({
			lines: pageLines,
			startMs: pageLines[0].startMs,
			endMs: pageLines[pageLines.length - 1].endMs,
		});
	}

	return pages;
}

/**
 * Given the current playback time, returns the visible page and per-word
 * animation states (active / upcoming / spoken).
 */
export function buildActiveCaptionLayout(
	pages: CaptionPage[],
	currentTimeMs: number,
): ActiveCaptionLayout {
	// Find the page whose time range contains the current time
	let activePage: CaptionPage | null = null;
	for (const page of pages) {
		if (currentTimeMs >= page.startMs && currentTimeMs <= page.endMs) {
			activePage = page;
			break;
		}
	}

	if (!activePage) {
		return { page: null, words: [] };
	}

	const animatedWords: AnimatedWord[] = [];
	for (const line of activePage.lines) {
		for (const word of line.words) {
			let state: WordAnimationState;
			if (currentTimeMs >= word.startMs && currentTimeMs <= word.endMs) {
				state = "active";
			} else if (currentTimeMs > word.endMs) {
				state = "spoken";
			} else {
				state = "upcoming";
			}
			animatedWords.push({
				text: word.text,
				startMs: word.startMs,
				endMs: word.endMs,
				state,
			});
		}
	}

	return { page: activePage, words: animatedWords };
}

import { describe, expect, it } from "vitest";
import { detectHighlightsHeuristic } from "./highlightDetector";

function mkWords(text: string, startSec = 0, perWordSec = 0.4) {
	return text.split(/\s+/).map((t, i) => ({
		text: t,
		start: startSec + i * perWordSec,
		end: startSec + (i + 1) * perWordSec,
	}));
}

describe("detectHighlightsHeuristic", () => {
	it("returns empty when transcript is empty", () => {
		expect(detectHighlightsHeuristic(60_000, [])).toEqual([]);
	});

	it("returns empty when total duration is zero", () => {
		const words = mkWords("hello world this is a test");
		expect(detectHighlightsHeuristic(0, words)).toEqual([]);
	});

	it("marks heuristic source on every candidate it returns", () => {
		// Build ~30s of dense speech so the algorithm has something to rank.
		const filler = Array.from({ length: 80 }, () => "amazing insight incredible secret").join(" ");
		const words = mkWords(filler, 0, 0.35);
		const results = detectHighlightsHeuristic(45_000, words, { maxHighlights: 3 });
		expect(results.length).toBeGreaterThan(0);
		for (const r of results) {
			expect(r.source).toBe("heuristic");
			expect(r.id).toMatch(/^highlight-/);
			expect(r.score).toBeGreaterThanOrEqual(0);
			expect(r.score).toBeLessThanOrEqual(100);
		}
	});

	it("produces highlights in strictly chronological order", () => {
		const filler = Array.from({ length: 120 }, () => "amazing secret never before").join(" ");
		const words = mkWords(filler, 0, 0.35);
		const results = detectHighlightsHeuristic(120_000, words, { maxHighlights: 5 });
		for (let i = 1; i < results.length; i++) {
			expect(results[i]!.startMs).toBeGreaterThanOrEqual(results[i - 1]!.startMs);
		}
	});

	it("respects maxHighlights", () => {
		const filler = Array.from({ length: 200 }, () => "wow amazing insane crazy").join(" ");
		const words = mkWords(filler, 0, 0.3);
		const results = detectHighlightsHeuristic(180_000, words, { maxHighlights: 2 });
		expect(results.length).toBeLessThanOrEqual(2);
	});
});

import { describe, expect, it } from "vitest";
import type { Chapter } from "./chapterDetector";
import { formatChapterBlock } from "./metadataGenerator";

describe("formatChapterBlock", () => {
	it("returns empty string when chapters list is empty", () => {
		expect(formatChapterBlock([])).toBe("");
	});

	it("formats short videos with M:SS timestamps", () => {
		const chapters: Chapter[] = [
			{ startMs: 0, endMs: 30_000, title: "Intro", confidence: 1 },
			{ startMs: 30_000, endMs: 600_000, title: "Setup", confidence: 1 },
			{ startMs: 600_000, endMs: 900_000, title: "Demo", confidence: 1 },
		];
		expect(formatChapterBlock(chapters)).toBe("0:00 Intro\n0:30 Setup\n10:00 Demo");
	});

	it("formats long videos using H:MM:SS when duration crosses an hour", () => {
		const chapters: Chapter[] = [
			{ startMs: 0, endMs: 3_600_000, title: "Part 1", confidence: 1 },
			{ startMs: 3_600_000, endMs: 7_200_000, title: "Part 2", confidence: 1 },
			{ startMs: 7_265_000, endMs: 9_000_000, title: "Part 3", confidence: 1 },
		];
		expect(formatChapterBlock(chapters)).toBe("0:00 Part 1\n1:00:00 Part 2\n2:01:05 Part 3");
	});

	it("clamps negative timestamps to 0", () => {
		const chapters: Chapter[] = [{ startMs: -500, endMs: 5000, title: "Pre-roll", confidence: 1 }];
		expect(formatChapterBlock(chapters)).toBe("0:00 Pre-roll");
	});
});

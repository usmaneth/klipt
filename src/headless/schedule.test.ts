import { describe, expect, it } from "vitest";
import {
	CAPTION_MAX_MS,
	CAPTION_MIN_MS,
	captionDurationMs,
	captionsToCues,
	MAX_CAPTION_CHARS,
	MAX_ZOOM_SEC,
	MIN_ZOOM_SEC,
	ScheduleError,
	scaleToDepth,
	zoomsToRegions,
} from "./schedule";

const zoom = (over: Partial<Parameters<typeof zoomsToRegions>[0][number]> = {}) => ({
	t: 1,
	x: 0.5,
	y: 0.5,
	scale: 1.5,
	dur: 2,
	...over,
});

describe("scaleToDepth", () => {
	it("picks the nearest editor depth", () => {
		expect(scaleToDepth(1.25)).toBe(1);
		expect(scaleToDepth(1.5)).toBe(2);
		expect(scaleToDepth(1.7)).toBe(3);
		expect(scaleToDepth(2.2)).toBe(4);
	});

	it("caps a large scale at the 2.5 limit, which is depth 4", () => {
		expect(scaleToDepth(9)).toBe(4);
	});

	it("returns null for a scale that is no zoom", () => {
		expect(scaleToDepth(1)).toBeNull();
		expect(scaleToDepth(1.1)).toBeNull();
		expect(scaleToDepth(Number.NaN)).toBeNull();
	});
});

describe("zoomsToRegions", () => {
	it("converts seconds to milliseconds and keeps the focus", () => {
		const [region] = zoomsToRegions([zoom({ t: 1.5, x: 0.5, y: 0.5, scale: 1.5, dur: 2 })]);
		expect(region).toMatchObject({ startMs: 1500, endMs: 3500, depth: 2 });
		expect(region.focus).toEqual({ cx: 0.5, cy: 0.5 });
	});

	it("moves a focus near the edge inside the area the depth can show", () => {
		const [region] = zoomsToRegions([zoom({ x: 0, y: 1, scale: 1.5 })]);
		expect(region.focus.cx).toBeCloseTo(1 / 3, 5);
		expect(region.focus.cy).toBeCloseTo(2 / 3, 5);
	});

	it("clamps x and y into the frame", () => {
		const [region] = zoomsToRegions([zoom({ x: -4, y: 9, scale: 1.25 })]);
		expect(region.focus.cx).toBeGreaterThanOrEqual(0);
		expect(region.focus.cy).toBeLessThanOrEqual(1);
	});

	it("limits the length of a keyframe", () => {
		const [short] = zoomsToRegions([zoom({ dur: 0.01 })]);
		expect(short.endMs - short.startMs).toBe(MIN_ZOOM_SEC * 1000);
		const [long] = zoomsToRegions([zoom({ dur: 99 })]);
		expect(long.endMs - long.startMs).toBe(MAX_ZOOM_SEC * 1000);
	});

	it("sorts keyframes and ends one where the next starts", () => {
		const regions = zoomsToRegions([zoom({ t: 4, dur: 2 }), zoom({ t: 1, dur: 5 })]);
		expect(regions.map((r) => [r.startMs, r.endMs])).toEqual([
			[1000, 4000],
			[4000, 6000],
		]);
		expect(regions.map((r) => r.id)).toEqual(["zoom-0", "zoom-1"]);
	});

	it("drops a keyframe with no zoom and one that the next keyframe leaves too short", () => {
		expect(zoomsToRegions([zoom({ scale: 1 })])).toEqual([]);
		const regions = zoomsToRegions([zoom({ t: 1, dur: 2 }), zoom({ t: 1.1, dur: 2 })]);
		expect(regions).toHaveLength(1);
		expect(regions[0].startMs).toBe(1100);
	});

	it("rejects a value that is not a finite number", () => {
		expect(() => zoomsToRegions([zoom({ t: Number.NaN })])).toThrow(ScheduleError);
		expect(() => zoomsToRegions([zoom({ x: "0.5" as unknown as number })])).toThrow(
			/zooms\[0\]\.x/,
		);
		expect(() => zoomsToRegions([zoom({ t: -1 })])).toThrow(/negative/);
	});
});

describe("captionsToCues", () => {
	it("ends a cue where the next cue starts", () => {
		const cues = captionsToCues([
			{ t: 0, text: "open the group chat and ask anuma to add" },
			{ t: 2, text: "tap a card" },
		]);
		expect(cues.map((c) => [c.startMs, c.endMs])).toEqual([
			[0, 2000],
			[2000, 2000 + captionDurationMs("tap a card")],
		]);
	});

	it("keeps a short caption on screen for at least the minimum time", () => {
		expect(captionDurationMs("hi")).toBe(CAPTION_MIN_MS);
		expect(captionDurationMs("x".repeat(500))).toBe(CAPTION_MAX_MS);
	});

	it("sorts by time, drops empty text and numbers the ids", () => {
		const cues = captionsToCues([
			{ t: 5, text: "second" },
			{ t: 1, text: "first" },
			{ t: 3, text: "   " },
		]);
		expect(cues.map((c) => c.text)).toEqual(["first", "second"]);
		expect(cues.map((c) => c.id)).toEqual(["caption-0", "caption-1"]);
	});

	it("gives each cue its whole text as one word with the timing of the cue", () => {
		const cues = captionsToCues([
			{ t: 0, text: "ask anuma who to add" },
			{ t: 3, text: "tap a card" },
		]);
		for (const cue of cues) {
			expect(cue.words).toEqual([{ text: cue.text, startMs: cue.startMs, endMs: cue.endMs }]);
		}
	});

	it("rejects a caption that would not fit on one line", () => {
		expect(() => captionsToCues([{ t: 0, text: "x".repeat(MAX_CAPTION_CHARS + 1) }])).toThrow(
			/longer than 40 characters/,
		);
		expect(() => captionsToCues([{ t: 0, text: "x".repeat(MAX_CAPTION_CHARS) }])).not.toThrow();
	});

	it("lowercases the copy when asked", () => {
		const [cue] = captionsToCues([{ t: 0, text: "Ask @Anuma" }], { lowercase: true });
		expect(cue.text).toBe("ask @anuma");
	});

	it("bounds the last cue to the video length", () => {
		const [cue] = captionsToCues([{ t: 1, text: "last step" }], { totalMs: 1500 });
		expect(cue.endMs).toBe(1500);
	});

	it("drops a cue that starts after the video ends", () => {
		expect(captionsToCues([{ t: 9, text: "late" }], { totalMs: 5000 })).toEqual([]);
	});

	it("rejects a bad time and a bad text", () => {
		expect(() => captionsToCues([{ t: Number.NaN, text: "x" }])).toThrow(ScheduleError);
		expect(() => captionsToCues([{ t: -1, text: "x" }])).toThrow(/negative/);
		expect(() => captionsToCues([{ t: 1, text: 7 as unknown as string }])).toThrow(/string/);
	});
});

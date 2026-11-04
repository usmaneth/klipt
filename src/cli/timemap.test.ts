import { describe, expect, it } from "vitest";
import {
	buildTimeMap,
	cutSelectExpr,
	scheduleCaptions,
	setptsExpr,
	toOutput,
	VOICE_GAP,
} from "./timemap.ts";

describe("buildTimeMap", () => {
	it("is the identity with no cuts, speed ranges or holds", () => {
		const map = buildTimeMap(10, [], []);
		expect(map.pieces).toEqual([{ from: 0, to: 10, factor: 1, out: 0 }]);
		expect(map.total).toBe(10);
		expect(toOutput(map, 4.2)).toBeCloseTo(4.2);
	});

	it("removes cuts and compresses speed ranges", () => {
		const map = buildTimeMap(20, [{ from: 2, to: 5 }], [{ from: 10, to: 18, factor: 4 }]);
		expect(map.total).toBeCloseTo(20 - 3 - 8 + 2);
		expect(toOutput(map, 1)).toBe(1);
		expect(toOutput(map, 3)).toBeUndefined();
		expect(toOutput(map, 6)).toBeCloseTo(3);
		expect(toOutput(map, 14)).toBeCloseTo(7 + 1);
		expect(toOutput(map, 19)).toBeCloseTo(9 + 1);
	});

	it("freezes the frame at a hold, and moves a hold inside a cut to the end of the cut", () => {
		const map = buildTimeMap(
			10,
			[{ from: 4, to: 6 }],
			[],
			[
				{ at: 2, seconds: 1.5 },
				{ at: 5, seconds: 1 },
			],
		);
		expect(toOutput(map, 1.9)).toBeCloseTo(1.9);
		expect(toOutput(map, 2)).toBeCloseTo(3.5);
		expect(toOutput(map, 6)).toBeCloseTo(4 + 1.5 + 1);
		expect(map.total).toBeCloseTo(8 + 2.5);
	});

	it("puts a hold at the end of the video into endHold", () => {
		const map = buildTimeMap(10, [], [], [{ at: 10, seconds: 2 }]);
		expect(map.endHold).toBe(2);
		expect(map.total).toBe(12);
	});
});

describe("ffmpeg expressions", () => {
	it("maps T piece by piece in setpts", () => {
		const map = buildTimeMap(10, [{ from: 2, to: 4 }], []);
		expect(setptsExpr(map)).toBe("(if(lt(T,2),0+(T-0)/1,2+(T-4)/1))/TB");
	});

	it("selects the frames outside the cuts", () => {
		expect(cutSelectExpr([])).toBeUndefined();
		expect(cutSelectExpr([{ from: 1, to: 2 }])).toBe("not(between(t,1,1.999999))");
	});
});

describe("scheduleCaptions", () => {
	const base = { duration: 20, cuts: [], speed: [] };

	it("shows a caption until the next one or for its reading time, with no voice", () => {
		const s = scheduleCaptions(
			[
				{ t: 1, text: "first" },
				{ t: 2, text: "second" },
				{ t: 10, text: "third", dur: 3 },
			],
			base,
		);
		expect(s.holds).toEqual([]);
		expect(s.captions).toEqual([
			{ text: "first", start: 1, end: 2 },
			{ text: "second", start: 2, end: 4 },
			{ text: "third", start: 10, end: 13 },
		]);
	});

	it("stretches a spoken caption past its reading time until the audio ends", () => {
		const s = scheduleCaptions([{ t: 1, text: "ok" }], { ...base, audio: [4] });
		expect(s.holds).toEqual([]);
		expect(s.captions[0]).toEqual({ text: "ok", start: 1, end: 1 + 4 + VOICE_GAP, audio: 4 });
	});

	it("freezes the frame before the next caption when the audio runs into it", () => {
		const s = scheduleCaptions(
			[
				{ t: 1, text: "a long spoken step" },
				{ t: 3, text: "next step" },
			],
			{ ...base, audio: [3.5, 1] },
		);
		// The first clip needs 1 + 3.5 + gap = 4.8 s; the next caption was at 3 s, so 1.8 s of hold at t=3.
		expect(s.holds).toEqual([{ at: 3, seconds: 1.8 }]);
		expect(s.captions[0]).toMatchObject({ start: 1, end: 4.8 });
		expect(s.captions[1]).toMatchObject({ start: 4.8 });
		expect(s.map.total).toBeCloseTo(21.8);
	});

	it("holds the last frame when the last spoken caption runs past the end", () => {
		const s = scheduleCaptions([{ t: 8, text: "the end" }], {
			duration: 10,
			cuts: [],
			speed: [],
			audio: [4],
		});
		expect(s.holds).toEqual([{ at: 10, seconds: 2.3 }]);
		expect(s.map.endHold).toBe(2.3);
		expect(s.captions[0]).toMatchObject({ start: 8, end: 12.3 });
	});

	it("places captions in body time after cuts and speed ranges, and drops a caption inside a cut", () => {
		const s = scheduleCaptions(
			[
				{ t: 1, text: "kept" },
				{ t: 3, text: "cut away" },
				{ t: 12, text: "after the speed-up" },
			],
			{ duration: 20, cuts: [{ from: 2, to: 4 }], speed: [{ from: 5, to: 11, factor: 3 }] },
		);
		expect(s.dropped.map((c) => c.text)).toEqual(["cut away"]);
		// 12 s raw = 2 s before the cut + 1 s + 6/3 s + 1 s = 6 s of body.
		expect(s.captions[1].start).toBeCloseTo(6);
	});

	it("keeps one frame between two captions at the same time", () => {
		const s = scheduleCaptions(
			[
				{ t: 2, text: "a" },
				{ t: 2, text: "b" },
			],
			{ ...base, audio: [1, 1] },
		);
		expect(s.captions[1].start).toBeGreaterThan(s.captions[0].start);
		expect(s.captions[1].start).toBeGreaterThanOrEqual(s.captions[0].end - 1e-6);
	});
});

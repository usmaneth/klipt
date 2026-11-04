import { describe, expect, it } from "vitest";
import {
	effectiveZooms,
	fitToDuration,
	parseTimeline,
	TAP_ZOOM,
	TimelineError,
} from "./timeline.ts";

function problems(input: unknown): string[] {
	try {
		parseTimeline(input);
	} catch (error) {
		if (error instanceof TimelineError) return error.problems;
		throw error;
	}
	return [];
}

describe("parseTimeline", () => {
	it("reads a full timeline and sorts each list by time", () => {
		const tl = parseTimeline({
			version: 1,
			title: { text: "  Invite a friend ", subtitle: "seeded local backend" },
			overview: {
				seconds: 3,
				stills: [
					{ t: 4, label: "Sent" },
					{ image: "/tmp/a.png", label: "Start" },
				],
			},
			captions: [
				{ t: 3, text: "Send it" },
				{ t: 1, text: "Open the sheet", dur: 2 },
			],
			zooms: [{ t: 2, x: 0.5, y: 0.4, scale: 1.8, dur: 1.5 }],
			taps: [{ t: 5, x: 0.1, y: 0.9 }],
			cuts: [{ from: 6, to: 8 }],
			speed: [{ from: 9, to: 12, factor: 4 }],
		});
		expect(tl.title).toEqual({
			text: "Invite a friend",
			subtitle: "seeded local backend",
			seconds: undefined,
		});
		expect(tl.captions.map((c) => c.t)).toEqual([1, 3]);
		expect(tl.captions[0].dur).toBe(2);
		expect(tl.overview?.stills).toHaveLength(2);
		expect(tl.cuts).toEqual([{ from: 6, to: 8 }]);
		expect(tl.speed[0].factor).toBe(4);
	});

	it("takes a title as a plain string and an empty object as an empty timeline", () => {
		expect(parseTimeline({ title: "Demo" }).title).toEqual({ text: "Demo" });
		const empty = parseTimeline({});
		expect(empty.captions).toEqual([]);
		expect(empty.title).toBeUndefined();
	});

	it("gives zooms the tap zoom scale and length when they are left out", () => {
		const tl = parseTimeline({ zooms: [{ t: 1, x: 0.5, y: 0.5 }] });
		expect(tl.zooms[0]).toMatchObject({ scale: TAP_ZOOM.scale, dur: TAP_ZOOM.dur });
	});

	it("names every bad field", () => {
		const found = problems({
			version: 2,
			captions: [{ t: -1, text: "" }],
			zooms: [{ t: 1, x: 1.5, y: 0.5, scale: 9 }],
			taps: [{ t: 1, x: 0.5 }],
			cutz: [],
		});
		expect(found).toEqual(
			expect.arrayContaining([
				expect.stringContaining("timeline.cutz is not a known key"),
				"version must be 1",
				expect.stringContaining("captions[0].t must be from 0"),
				"captions[0].text must be a text that is not empty",
				expect.stringContaining("zooms[0].x must be from 0 to 1, got 1.5"),
				expect.stringContaining("zooms[0].scale must be from 1.05 to 3, got 9"),
				"taps[0].y must be a number",
			]),
		);
	});

	it("rejects an unknown key inside an item", () => {
		expect(problems({ captions: [{ t: 1, text: "a", time: 2 }] })).toEqual([
			expect.stringContaining("captions[0].time is not a known key"),
		]);
	});

	it("rejects a caption that is too long", () => {
		expect(problems({ captions: [{ t: 1, text: "x".repeat(161) }] })[0]).toContain(
			"has 161 characters, the most is 160",
		);
	});

	it("rejects ranges that end before they start and ranges that overlap", () => {
		expect(problems({ cuts: [{ from: 5, to: 2 }] })[0]).toContain("must end after it starts");
		expect(
			problems({ cuts: [{ from: 1, to: 5 }], speed: [{ from: 4, to: 8, factor: 2 }] })[0],
		).toContain("speed[0] overlaps cuts[0]");
	});

	it("needs exactly one of t or image in a still, and at most 9 stills", () => {
		expect(problems({ overview: { stills: [{ label: "a" }] } })[0]).toContain(
			"exactly one of t or image",
		);
		expect(
			problems({ overview: { stills: [{ t: 1, image: "/a.png", label: "a" }] } })[0],
		).toContain("exactly one of t or image");
		const ten = Array.from({ length: 10 }, (_, i) => ({ t: i, label: `s${i}` }));
		expect(problems({ overview: { stills: ten } })[0]).toContain("the most is 9");
	});

	it("checks the voiceover", () => {
		expect(
			parseTimeline({
				voiceover: {
					endpoint: "http://tts:8792/tts",
					voice: "narrator",
					style: "warm product demo",
					speed: 1.1,
					warmup: "http://tts:8792/warmup",
				},
			}).voiceover,
		).toEqual({
			endpoint: "http://tts:8792/tts",
			voice: "narrator",
			style: "warm product demo",
			speed: 1.1,
			warmup: "http://tts:8792/warmup",
		});
		expect(problems({ voiceover: { endpoint: "tts:8792" } })[0]).toBe(
			"voiceover.endpoint must be an http or https URL",
		);
		expect(problems({ voiceover: { endpoint: "http://x", duck: 2 } })[0]).toContain(
			"voiceover.duck must be from 0 to 1",
		);
		expect(problems({ voiceover: { endpoint: "http://x", speed: 9 } })[0]).toContain(
			"voiceover.speed must be from 0.25 to 4",
		);
	});

	it("rejects a timeline that is not an object", () => {
		expect(problems([])).toEqual(["timeline must be an object"]);
	});
});

describe("effectiveZooms", () => {
	it("makes one zoom for a burst of taps, starting a little before the first tap", () => {
		const zooms = effectiveZooms({
			zooms: [],
			taps: [
				{ t: 2, x: 0.2, y: 0.3 },
				{ t: 2.5, x: 0.25, y: 0.3 },
				{ t: 6, x: 0.8, y: 0.8 },
			],
		});
		expect(zooms).toEqual([
			{ t: 2 - TAP_ZOOM.lead, x: 0.2, y: 0.3, scale: TAP_ZOOM.scale, dur: TAP_ZOOM.dur },
			{ t: 6 - TAP_ZOOM.lead, x: 0.8, y: 0.8, scale: TAP_ZOOM.scale, dur: TAP_ZOOM.dur },
		]);
	});

	it("keeps an explicit zoom, skips a tap it covers, and ends a zoom where the next one starts", () => {
		const zooms = effectiveZooms({
			zooms: [
				{ t: 1, x: 0.5, y: 0.5, scale: 2, dur: 3 },
				{ t: 2, x: 0.1, y: 0.1, scale: 1.5, dur: 1 },
			],
			taps: [{ t: 1.5, x: 0.9, y: 0.9 }],
		});
		expect(zooms).toEqual([
			{ t: 1, x: 0.5, y: 0.5, scale: 2, dur: 1 },
			{ t: 2, x: 0.1, y: 0.1, scale: 1.5, dur: 1 },
		]);
	});
});

describe("fitToDuration", () => {
	it("drops items after the end, clips ranges, and moves late stills to the last frame", () => {
		const tl = parseTimeline({
			captions: [
				{ t: 1, text: "in" },
				{ t: 11, text: "out" },
			],
			cuts: [{ from: 8, to: 20 }],
			overview: { stills: [{ t: 30, label: "late" }] },
		});
		const { timeline, warnings } = fitToDuration(tl, 10);
		expect(timeline.captions.map((c) => c.text)).toEqual(["in"]);
		expect(timeline.cuts).toEqual([{ from: 8, to: 10 }]);
		expect(timeline.overview?.stills[0].t).toBeCloseTo(9.95);
		expect(warnings).toHaveLength(2);
	});

	it("fails when the cuts remove the whole video", () => {
		const tl = parseTimeline({ cuts: [{ from: 0, to: 10 }] });
		expect(() => fitToDuration(tl, 10)).toThrow("cuts remove the whole video");
	});
});

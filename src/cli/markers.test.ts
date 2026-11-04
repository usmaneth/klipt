import { describe, expect, it } from "vitest";
import {
	markersToTimeline,
	markerTime,
	parseMarker,
	readingTime,
	type TimedMarker,
} from "./markers.ts";

describe("parseMarker", () => {
	it("reads each kind of marker", () => {
		expect(parseMarker('{"caption":" Open the sheet ","t":1.5}')).toEqual({
			kind: "caption",
			text: "Open the sheet",
			t: 1.5,
		});
		expect(parseMarker('{"tap":{"x":0.4,"y":0.8},"ts":1700000000000}')).toEqual({
			kind: "tap",
			x: 0.4,
			y: 0.8,
			ts: 1700000000000,
		});
		expect(parseMarker('{"state":"Invite sent"}')).toEqual({ kind: "state", label: "Invite sent" });
		expect(parseMarker('{"speed":4}')).toEqual({ kind: "speed", factor: 4 });
		expect(parseMarker('{"cut":false}')).toEqual({ kind: "cut", on: false });
		expect(parseMarker('{"title":"Demo"}')).toEqual({ kind: "title", text: "Demo" });
		expect(parseMarker('{"stop":true}')).toEqual({ kind: "stop" });
		expect(parseMarker('{"caption":"a","dur":3}')).toEqual({ kind: "caption", text: "a", dur: 3 });
	});

	it("says what is wrong with a bad line", () => {
		expect(parseMarker("not json")).toBe("is not JSON");
		expect(parseMarker("[1]")).toBe("is not a JSON object");
		expect(parseMarker('{"caption":"a","state":"b"}')).toContain("exactly one of");
		expect(parseMarker("{}")).toContain("exactly one of");
		expect(parseMarker('{"caption":""}')).toBe("caption must be a text that is not empty");
		expect(parseMarker('{"tap":{"x":"1","y":2}}')).toContain("tap must be {x, y}");
		expect(parseMarker('{"speed":0.5}')).toContain("speed must be a number, 1 or more");
		expect(parseMarker('{"cut":"yes"}')).toBe("cut must be true or false");
		expect(parseMarker('{"caption":"a","t":-1}')).toContain("t must be a number of seconds");
	});
});

describe("markerTime", () => {
	it("uses t first, then ts, then the read time", () => {
		expect(markerTime({ kind: "stop", t: 2, ts: 99_000 }, 10_000, 50_000)).toBe(2);
		expect(markerTime({ kind: "stop", ts: 13_500 }, 10_000, 50_000)).toBe(3.5);
		expect(markerTime({ kind: "stop" }, 10_000, 12_000)).toBe(2);
		expect(markerTime({ kind: "stop", ts: 9_000 }, 10_000, 0)).toBe(0);
	});
});

describe("markersToTimeline", () => {
	const at = (t: number, m: Omit<TimedMarker, "t">): TimedMarker => ({ ...m, t }) as TimedMarker;

	it("turns captions, taps and states into captions, taps and overview stills", () => {
		const { timeline, warnings } = markersToTimeline(
			[
				at(4, { kind: "state", label: "Sent" }),
				at(1, { kind: "caption", text: "Open the sheet" }),
				at(2, { kind: "tap", x: 0.25, y: 0.5 }),
				at(0.5, { kind: "state", label: "Start" }),
				at(3, { kind: "tap", x: 640, y: 360 }),
			],
			{ duration: 10, tapSpace: { width: 1280, height: 720 } },
		);
		expect(warnings).toEqual([]);
		expect(timeline.captions).toEqual([{ t: 1, text: "Open the sheet" }]);
		expect(timeline.taps).toEqual([
			{ t: 2, x: 0.25, y: 0.5 },
			{ t: 3, x: 0.5, y: 0.5 },
		]);
		expect(timeline.overview?.stills).toEqual([
			{ t: 0.5, label: "Start" },
			{ t: 4, label: "Sent" },
		]);
	});

	it("drops a pixel tap when the source size is not known", () => {
		const { timeline, warnings } = markersToTimeline([at(1, { kind: "tap", x: 100, y: 100 })], {
			duration: 5,
		});
		expect(timeline.taps).toEqual([]);
		expect(warnings[0]).toContain("source size is not known");
	});

	it("pairs speed and cut markers into ranges, and closes an open range at the end", () => {
		const { timeline } = markersToTimeline(
			[
				at(1, { kind: "speed", factor: 4 }),
				at(3, { kind: "speed", factor: 1 }),
				at(4, { kind: "cut", on: true }),
				at(6, { kind: "cut", on: false }),
				at(8, { kind: "speed", factor: 2 }),
			],
			{ duration: 10 },
		);
		expect(timeline.speed).toEqual([
			{ from: 1, to: 3, factor: 4 },
			{ from: 8, to: 10, factor: 2 },
		]);
		expect(timeline.cuts).toEqual([{ from: 4, to: 6 }]);
	});

	it("takes the title marker and keeps the first 9 states", () => {
		const states = Array.from({ length: 11 }, (_, i) =>
			at(i * 0.5, { kind: "state", label: `s${i}` }),
		);
		const { timeline, warnings } = markersToTimeline(
			[...states, at(0, { kind: "title", text: "Demo" })],
			{ duration: 10 },
		);
		expect(timeline.title).toEqual({ text: "Demo" });
		expect(timeline.overview?.stills).toHaveLength(9);
		expect(warnings[0]).toContain("keeps the first 9");
	});

	it("clamps a marker after the end to the end", () => {
		const { timeline } = markersToTimeline([at(12, { kind: "caption", text: "late" })], {
			duration: 10,
		});
		expect(timeline.captions[0].t).toBe(10);
	});
});

describe("readingTime", () => {
	it("is 2 to 5 seconds", () => {
		expect(readingTime("ok")).toBe(2);
		expect(readingTime("x".repeat(200))).toBe(5);
	});
});

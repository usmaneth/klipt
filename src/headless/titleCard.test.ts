import { describe, expect, it } from "vitest";
import { introFrameCount } from "@/lib/exporter/introCard";
import { BRAND, PHONE_DEMO, resolvePreset } from "./preset";
import { drawTitleCard, wrapLines } from "./titleCard";

// Every character is 10 wide, so a line of 5 characters is 50 wide.
const measure = (value: string) => value.length * 10;

describe("wrapLines", () => {
	it("keeps a short text on one line", () => {
		expect(wrapLines(measure, "ask anuma", 200)).toEqual(["ask anuma"]);
	});

	it("breaks between words at the width limit", () => {
		expect(wrapLines(measure, "aaa bbb ccc ddd", 70)).toEqual(["aaa bbb", "ccc ddd"]);
	});

	it("gives a word that is too long a line of its own", () => {
		expect(wrapLines(measure, "a bbbbbbbbbbbbbbbb c", 50)).toEqual(["a", "bbbbbbbbbbbbbbbb", "c"]);
	});

	it("cuts the text at the line limit and marks the cut", () => {
		expect(wrapLines(measure, "aa bb cc dd ee", 55, 2)).toEqual(["aa bb", "cc dd…"]);
	});

	it("returns no lines for an empty text", () => {
		expect(wrapLines(measure, "   ", 100)).toEqual([]);
	});
});

describe("introFrameCount", () => {
	it("rounds the card length to frames", () => {
		expect(introFrameCount(1500, 30)).toBe(45);
		expect(introFrameCount(1000, 60)).toBe(60);
	});

	it("is zero when there is no card and one at least when there is a card", () => {
		expect(introFrameCount(undefined, 30)).toBe(0);
		expect(introFrameCount(0, 30)).toBe(0);
		expect(introFrameCount(-5, 30)).toBe(0);
		expect(introFrameCount(1, 30)).toBe(1);
		expect(introFrameCount(1500, 0)).toBe(0);
	});
});

describe("phone-demo preset", () => {
	it("is a portrait 9:16 canvas on the brand background", () => {
		expect(PHONE_DEMO.width * 16).toBe(PHONE_DEMO.height * 9);
		expect(PHONE_DEMO.wallpaper).toBe(BRAND.background);
		expect(resolvePreset("phone-demo")).toBe(PHONE_DEMO);
	});

	it("shows one caption at a time at the lower third and fits the 8-bit macroblock grid", () => {
		expect(PHONE_DEMO.captionSettings.enabled).toBe(true);
		expect(PHONE_DEMO.captionSettings.maxRows).toBe(1);
		expect(PHONE_DEMO.captionSettings.highlightColor).toBe(PHONE_DEMO.captionSettings.textColor);
		// "glow" keeps the text at full size and draws no box behind the active word.
		expect(PHONE_DEMO.captionSettings.animation).toBe("glow");
		expect(PHONE_DEMO.captionSettings.positionOffset).toBeGreaterThanOrEqual(80);
		expect(PHONE_DEMO.width % 2).toBe(0);
		expect(PHONE_DEMO.height % 2).toBe(0);
	});
});

describe("drawTitleCard", () => {
	it("paints the background, the accent rule and the lines of the title", () => {
		const calls: Array<[string, ...unknown[]]> = [];
		const ctx = {
			set fillStyle(value: string) {
				calls.push(["fillStyle", value]);
			},
			set font(value: string) {
				calls.push(["font", value]);
			},
			textAlign: "",
			textBaseline: "",
			measureText: (value: string) => ({ width: value.length * 20 }),
			fillRect: (...args: unknown[]) => calls.push(["fillRect", ...args]),
			fillText: (...args: unknown[]) => calls.push(["fillText", ...args]),
		} as unknown as CanvasRenderingContext2D;

		drawTitleCard(ctx, 1080, 1920, "group chat people picks from anuma");

		expect(calls[0]).toEqual(["fillStyle", BRAND.background]);
		expect(calls[1]).toEqual(["fillRect", 0, 0, 1080, 1920]);
		expect(calls.some((c) => c[0] === "fillStyle" && c[1] === BRAND.accent)).toBe(true);
		const texts = calls.filter((c) => c[0] === "fillText").map((c) => c[1]);
		expect(texts.join(" ")).toBe("group chat people picks from anuma");
		expect(calls.find((c) => c[0] === "font")?.[1]).toContain(BRAND.font);
	});
});

import { describe, expect, it } from "vitest";
import { DEFAULT_CAPTION_SETTINGS } from "@/components/video-editor/captionStyle";
import { applyShortsCaptionPreset, SHORTS_CAPTION_PRESETS } from "./shortsCaptionPresets";

describe("SHORTS_CAPTION_PRESETS", () => {
	it("exposes a non-empty list of presets", () => {
		expect(SHORTS_CAPTION_PRESETS.length).toBeGreaterThan(0);
	});

	it("every preset enables captions, uses a large font, and sets a supported animation", () => {
		const supportedAnimations = new Set([
			"none",
			"fade",
			"rise",
			"pop",
			"bold-pop",
			"karaoke",
			"typewriter",
			"bounce",
			"glow",
		]);
		for (const preset of SHORTS_CAPTION_PRESETS) {
			expect(preset.apply.enabled).toBe(true);
			expect(preset.apply.fontSize ?? 0).toBeGreaterThanOrEqual(40);
			expect(preset.apply.animation).toBeDefined();
			expect(supportedAnimations.has(preset.apply.animation!)).toBe(true);
		}
	});

	it("preset ids are unique", () => {
		const ids = SHORTS_CAPTION_PRESETS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("applyShortsCaptionPreset", () => {
	it("leaves settings untouched for unknown preset id", () => {
		const result = applyShortsCaptionPreset(DEFAULT_CAPTION_SETTINGS, "no-such-id");
		expect(result).toEqual(DEFAULT_CAPTION_SETTINGS);
	});

	it("merges preset fields on top of current settings", () => {
		const result = applyShortsCaptionPreset(DEFAULT_CAPTION_SETTINGS, "viral-yellow");
		expect(result.enabled).toBe(true);
		expect(result.animation).toBe("bold-pop");
		expect(result.fontSize).toBeGreaterThanOrEqual(50);
		// Fields not overridden by the preset should match the input.
		expect(result.language).toBe(DEFAULT_CAPTION_SETTINGS.language);
	});
});

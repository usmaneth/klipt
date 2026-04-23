import { describe, expect, it } from "vitest";
import type { DetectedFace } from "./faceDetector";
import { buildShortsReframe, SHORTS_ASPECTS, sampleCropRect } from "./shortsReframe";

function face(timeMs: number, x: number, y: number): DetectedFace {
	return { timeMs, x, y, width: 0.1, height: 0.15 };
}

describe("buildShortsReframe", () => {
	it("returns a center-locked spec when no faces are provided", () => {
		const spec = buildShortsReframe(1920, 1080, [], { aspect: "9:16", outWidth: 1080 });

		expect(spec.subjectFound).toBe(false);
		expect(spec.outWidth).toBe(1080);
		expect(spec.outHeight).toBe(1920);
		expect(spec.keyframes).toHaveLength(1);
		expect(spec.keyframes[0]).toMatchObject({ cx: 0.5, cy: 0.5 });
	});

	it("picks crop width that fits inside source dimensions for 9:16", () => {
		const spec = buildShortsReframe(1920, 1080, []);
		// 1080 * 9/16 = 607.5 → cropWidth fits within 1920 (height-limited).
		expect(spec.cropHeight).toBe(1080);
		expect(Math.abs(spec.cropWidth - Math.round((1080 * 9) / 16))).toBeLessThan(1);
	});

	it("picks crop height that fits inside source dimensions for 1:1 with square source", () => {
		const spec = buildShortsReframe(1000, 800, [], { aspect: "1:1" });
		// With source 1000x800, a 1:1 crop can be at most 800x800.
		expect(spec.cropWidth).toBe(800);
		expect(spec.cropHeight).toBe(800);
	});

	it("generates keyframes that follow a moving face", () => {
		const faces: DetectedFace[] = [
			face(0, 0.2, 0.3),
			face(500, 0.21, 0.3),
			face(1000, 0.6, 0.3),
			face(1500, 0.61, 0.31),
			face(2000, 0.62, 0.3),
		];
		const spec = buildShortsReframe(1920, 1080, faces, { smoothing: 0 });

		expect(spec.subjectFound).toBe(true);
		// Keyframes should span the provided times (allowing for bucket rounding).
		expect(spec.keyframes.length).toBeGreaterThanOrEqual(3);
		// Early keyframes centered left of 0.5 (face near x=0.2 +0.05 half-width = 0.25).
		expect(spec.keyframes[0]!.cx).toBeLessThan(0.5);
		// Late keyframes pan rightward (face around x=0.6-0.65).
		expect(spec.keyframes[spec.keyframes.length - 1]!.cx).toBeGreaterThan(spec.keyframes[0]!.cx);
	});

	it("clamps keyframes so crop window stays inside source", () => {
		const faces: DetectedFace[] = [face(0, 0.98, 0.01), face(1000, 0.0, 0.99)];
		const spec = buildShortsReframe(1920, 1080, faces);

		const halfW = spec.cropWidth / spec.sourceWidth / 2;
		const halfH = spec.cropHeight / spec.sourceHeight / 2;
		for (const kf of spec.keyframes) {
			expect(kf.cx).toBeGreaterThanOrEqual(halfW - 1e-9);
			expect(kf.cx).toBeLessThanOrEqual(1 - halfW + 1e-9);
			expect(kf.cy).toBeGreaterThanOrEqual(halfH - 1e-9);
			expect(kf.cy).toBeLessThanOrEqual(1 - halfH + 1e-9);
		}
	});

	it("honors maxPanPerSecond to prevent whip-pans", () => {
		// Faces 1s apart, one hard left and one hard right, with a very tight
		// pan budget so the velocity clamp must engage.
		const faces: DetectedFace[] = [face(0, 0.1, 0.5), face(1000, 0.9, 0.5)];
		const spec = buildShortsReframe(1920, 1080, faces, {
			smoothing: 0,
			maxPanPerSecond: 0.05,
		});
		expect(spec.keyframes.length).toBeGreaterThanOrEqual(2);
		const dx = Math.abs(spec.keyframes[1]!.cx - spec.keyframes[0]!.cx);
		// dt = 1s, maxPan = 0.05 → dx must be ≤ 0.05.
		expect(dx).toBeLessThanOrEqual(0.0501);
	});
});

describe("sampleCropRect", () => {
	it("returns integers within source bounds", () => {
		const spec = buildShortsReframe(1920, 1080, [face(0, 0.5, 0.5)]);
		const rect = sampleCropRect(spec, 0);
		expect(rect.sx).toBeGreaterThanOrEqual(0);
		expect(rect.sy).toBeGreaterThanOrEqual(0);
		expect(rect.sx + rect.sw).toBeLessThanOrEqual(spec.sourceWidth);
		expect(rect.sy + rect.sh).toBeLessThanOrEqual(spec.sourceHeight);
	});

	it("interpolates smoothly between keyframes", () => {
		const faces: DetectedFace[] = [face(0, 0.3, 0.5), face(2000, 0.7, 0.5)];
		const spec = buildShortsReframe(1920, 1080, faces, { smoothing: 0, maxPanPerSecond: 5 });
		const early = sampleCropRect(spec, 100);
		const mid = sampleCropRect(spec, 1000);
		const late = sampleCropRect(spec, 1900);
		// sx should strictly increase as the keyframe pans right.
		expect(mid.sx).toBeGreaterThan(early.sx);
		expect(late.sx).toBeGreaterThan(mid.sx);
	});

	it("clamps time before the first keyframe to the first keyframe center", () => {
		const faces: DetectedFace[] = [face(500, 0.25, 0.5)];
		const spec = buildShortsReframe(1920, 1080, faces);
		const a = sampleCropRect(spec, -1000);
		const b = sampleCropRect(spec, 500);
		expect(a.sx).toBe(b.sx);
		expect(a.sy).toBe(b.sy);
	});
});

describe("SHORTS_ASPECTS", () => {
	it("covers the three supported aspects", () => {
		expect(Object.keys(SHORTS_ASPECTS)).toEqual(["9:16", "1:1", "4:5"]);
	});

	it("aspect ratios are in lowest terms", () => {
		expect(SHORTS_ASPECTS["9:16"]).toMatchObject({ w: 9, h: 16 });
		expect(SHORTS_ASPECTS["1:1"]).toMatchObject({ w: 1, h: 1 });
		expect(SHORTS_ASPECTS["4:5"]).toMatchObject({ w: 4, h: 5 });
	});
});

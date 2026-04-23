// Shorts Mode — take a 16:9 (or any) video and produce a 9:16 "vertical shorts"
// crop path that follows the subject using face detections + click/focus cues.
//
// The output is a time-indexed list of crop rectangles (in source pixels) that
// the export pipeline can apply per-frame. A smooth easing between keyframes
// prevents jittery motion without requiring per-frame detection.

import type { DetectedFace } from "./faceDetector";

export type ShortsAspect = "9:16" | "1:1" | "4:5";

export interface ReframeKeyframe {
	timeMs: number;
	/** Normalized (0-1) center of the crop window in source coordinates. */
	cx: number;
	cy: number;
}

export interface ReframeCropSpec {
	/** Target output aspect ratio. */
	aspect: ShortsAspect;
	/** Source video dimensions (pixels). */
	sourceWidth: number;
	sourceHeight: number;
	/** Output dimensions (pixels). */
	outWidth: number;
	outHeight: number;
	/** Size of the crop in source pixels (fixed height, width = height * targetRatio). */
	cropWidth: number;
	cropHeight: number;
	/** Keyframes defining crop center over time. Linearly interpolated. */
	keyframes: ReframeKeyframe[];
	/** Fallback center when no keyframe spans the given time. */
	defaultCx: number;
	defaultCy: number;
	/** Was a face/subject actually detected? If false, crop is center-locked. */
	subjectFound: boolean;
}

export interface ShortsReframeOptions {
	aspect?: ShortsAspect;
	outWidth?: number;
	/** Degree of smoothing between detection points (0..1; higher = smoother). */
	smoothing?: number;
	/** Clamp max pixels-per-second of crop center travel to avoid whip pans. */
	maxPanPerSecond?: number;
	/**
	 * If `blurBackground` is true, instead of cropping, the exporter should
	 * letterbox the source onto a 9:16 canvas with a blurred copy filling the
	 * background. Still useful when no clear subject is present.
	 */
	blurBackground?: boolean;
}

export const SHORTS_ASPECTS: Record<ShortsAspect, { w: number; h: number; label: string }> = {
	"9:16": { w: 9, h: 16, label: "Vertical (9:16)" },
	"1:1": { w: 1, h: 1, label: "Square (1:1)" },
	"4:5": { w: 4, h: 5, label: "Portrait (4:5)" },
};

/**
 * Given a collection of time-stamped face detections plus the source video
 * dimensions, build a crop path for 9:16 (or another) output aspect.
 */
export function buildShortsReframe(
	sourceWidth: number,
	sourceHeight: number,
	faces: DetectedFace[],
	options: ShortsReframeOptions = {},
): ReframeCropSpec {
	const aspect = options.aspect ?? "9:16";
	const outWidth = options.outWidth ?? 1080;
	const { w: aW, h: aH } = SHORTS_ASPECTS[aspect];
	const outHeight = Math.round((outWidth * aH) / aW);

	// Compute maximal crop inside source at the target aspect.
	const targetRatio = aW / aH;
	let cropHeight = sourceHeight;
	let cropWidth = Math.round(cropHeight * targetRatio);
	if (cropWidth > sourceWidth) {
		cropWidth = sourceWidth;
		cropHeight = Math.round(cropWidth / targetRatio);
	}

	const defaultCx = 0.5;
	const defaultCy = 0.5;

	if (faces.length === 0) {
		return {
			aspect,
			sourceWidth,
			sourceHeight,
			outWidth,
			outHeight,
			cropWidth,
			cropHeight,
			keyframes: [{ timeMs: 0, cx: defaultCx, cy: defaultCy }],
			defaultCx,
			defaultCy,
			subjectFound: false,
		};
	}

	// 1. Reduce detections into 1-per-bucket time slots so a single dense
	//    segment doesn't dominate.
	const BUCKET_MS = 500;
	const byBucket = new Map<number, DetectedFace[]>();
	for (const f of faces) {
		const key = Math.round(f.timeMs / BUCKET_MS);
		const list = byBucket.get(key) ?? [];
		list.push(f);
		byBucket.set(key, list);
	}

	const rawKeyframes: ReframeKeyframe[] = Array.from(byBucket.entries())
		.map(([key, list]) => {
			// When multiple faces are visible, bias to the largest (presumably
			// the primary speaker).
			list.sort((a, b) => b.width * b.height - a.width * a.height);
			const primary = list[0]!;
			const cx = primary.x + primary.width / 2;
			// Bias crop upward slightly so faces aren't dead-center — shorts
			// traditionally show the face in the top third.
			const cy = primary.y + primary.height * 0.35;
			return { timeMs: key * BUCKET_MS, cx, cy };
		})
		.sort((a, b) => a.timeMs - b.timeMs);

	// 2. Exponential smoothing of center path.
	const alpha = 1 - Math.max(0, Math.min(1, options.smoothing ?? 0.55));
	const smoothed: ReframeKeyframe[] = [];
	for (const kf of rawKeyframes) {
		const prev = smoothed[smoothed.length - 1];
		if (!prev) {
			smoothed.push(kf);
			continue;
		}
		smoothed.push({
			timeMs: kf.timeMs,
			cx: prev.cx + alpha * (kf.cx - prev.cx),
			cy: prev.cy + alpha * (kf.cy - prev.cy),
		});
	}

	// 3. Clamp velocity so we don't whip-pan across cuts.
	const maxPan = options.maxPanPerSecond ?? 0.35; // normalized units / sec
	for (let i = 1; i < smoothed.length; i++) {
		const prev = smoothed[i - 1]!;
		const cur = smoothed[i]!;
		const dtSec = Math.max(0.001, (cur.timeMs - prev.timeMs) / 1000);
		const dx = cur.cx - prev.cx;
		const dy = cur.cy - prev.cy;
		const dist = Math.hypot(dx, dy);
		const maxDist = maxPan * dtSec;
		if (dist > maxDist) {
			const scale = maxDist / dist;
			cur.cx = prev.cx + dx * scale;
			cur.cy = prev.cy + dy * scale;
		}
	}

	// 4. Clamp each keyframe center so the crop window stays inside source.
	const halfNormW = cropWidth / sourceWidth / 2;
	const halfNormH = cropHeight / sourceHeight / 2;
	for (const kf of smoothed) {
		kf.cx = clamp(kf.cx, halfNormW, 1 - halfNormW);
		kf.cy = clamp(kf.cy, halfNormH, 1 - halfNormH);
	}

	return {
		aspect,
		sourceWidth,
		sourceHeight,
		outWidth,
		outHeight,
		cropWidth,
		cropHeight,
		keyframes: smoothed.length > 0 ? smoothed : [{ timeMs: 0, cx: defaultCx, cy: defaultCy }],
		defaultCx,
		defaultCy,
		subjectFound: true,
	};
}

/**
 * Given a crop spec and a time, return the crop rectangle (in source pixels)
 * to sample for that frame. Linearly interpolates between keyframes.
 */
export function sampleCropRect(
	spec: ReframeCropSpec,
	timeMs: number,
): {
	sx: number;
	sy: number;
	sw: number;
	sh: number;
} {
	const kfs = spec.keyframes;
	let cx = spec.defaultCx;
	let cy = spec.defaultCy;

	if (kfs.length === 1) {
		cx = kfs[0]!.cx;
		cy = kfs[0]!.cy;
	} else if (timeMs <= kfs[0]!.timeMs) {
		cx = kfs[0]!.cx;
		cy = kfs[0]!.cy;
	} else if (timeMs >= kfs[kfs.length - 1]!.timeMs) {
		const last = kfs[kfs.length - 1]!;
		cx = last.cx;
		cy = last.cy;
	} else {
		for (let i = 1; i < kfs.length; i++) {
			const a = kfs[i - 1]!;
			const b = kfs[i]!;
			if (timeMs >= a.timeMs && timeMs <= b.timeMs) {
				const t = (timeMs - a.timeMs) / Math.max(1, b.timeMs - a.timeMs);
				const eased = easeInOut(t);
				cx = a.cx + (b.cx - a.cx) * eased;
				cy = a.cy + (b.cy - a.cy) * eased;
				break;
			}
		}
	}

	const sw = spec.cropWidth;
	const sh = spec.cropHeight;
	const sx = clamp(cx * spec.sourceWidth - sw / 2, 0, spec.sourceWidth - sw);
	const sy = clamp(cy * spec.sourceHeight - sh / 2, 0, spec.sourceHeight - sh);
	return { sx, sy, sw, sh };
}

/**
 * Render a single frame from source → output canvas using the crop spec.
 * Works with any drawable image source (VideoFrame, HTMLVideoElement, etc.).
 */
export function renderReframedFrame(
	ctx: CanvasRenderingContext2D,
	source: CanvasImageSource,
	spec: ReframeCropSpec,
	timeMs: number,
	options: { blurBackground?: boolean } = {},
): void {
	const { sx, sy, sw, sh } = sampleCropRect(spec, timeMs);

	if (options.blurBackground) {
		// Draw blurred, letterboxed source filling the whole output, then the
		// focused crop centered on top. Keeps sides filled on talking-head shots.
		ctx.save();
		ctx.filter = "blur(40px) brightness(0.55)";
		const scale =
			Math.max(spec.outWidth / spec.sourceWidth, spec.outHeight / spec.sourceHeight) * 1.2;
		const bgW = spec.sourceWidth * scale;
		const bgH = spec.sourceHeight * scale;
		ctx.drawImage(source, (spec.outWidth - bgW) / 2, (spec.outHeight - bgH) / 2, bgW, bgH);
		ctx.restore();

		const focusW = spec.outWidth;
		const focusH = Math.round((focusW * sh) / sw);
		const focusY = Math.round((spec.outHeight - focusH) / 2);
		ctx.drawImage(source, sx, sy, sw, sh, 0, focusY, focusW, focusH);
	} else {
		ctx.drawImage(source, sx, sy, sw, sh, 0, 0, spec.outWidth, spec.outHeight);
	}
}

function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

function easeInOut(t: number): number {
	return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}

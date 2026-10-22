import type { CaptionCue } from "@/components/video-editor/captionLayout";
import {
	clampFocusToDepth,
	ZOOM_DEPTH_SCALES,
	type ZoomDepth,
	type ZoomRegion,
} from "@/components/video-editor/types";

/** One step caption: show `text` from second `t`. */
export interface CaptionInput {
	t: number;
	text: string;
}

/** One zoom keyframe. x and y are the focus point inside the video frame, from 0 to 1. */
export interface ZoomInput {
	t: number;
	x: number;
	y: number;
	scale: number;
	dur: number;
}

export class ScheduleError extends Error {}

/** The editor only has fixed zoom depths. A scale below this value is no zoom at all. */
export const MIN_ZOOM_SCALE = 1.125;
export const MAX_ZOOM_SCALE = 2.5;
export const MIN_ZOOM_SEC = 0.3;
export const MAX_ZOOM_SEC = 10;
const MIN_ZOOM_REGION_MS = 200;

export const CAPTION_MIN_MS = 1200;
export const CAPTION_MAX_MS = 4000;
/** A caption is one line of the video. A longer text would run off the screen, so it is an error. */
export const MAX_CAPTION_CHARS = 40;
const CAPTION_BASE_MS = 900;
const CAPTION_PER_CHAR_MS = 55;

const DEPTHS: ZoomDepth[] = [1, 2, 3, 4, 5, 6];

function finite(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new ScheduleError(`${label} must be a finite number`);
	}
	return value;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** The editor zoom depth whose scale is nearest to `scale`. Null when the scale is too small to zoom. */
export function scaleToDepth(scale: number): ZoomDepth | null {
	if (!Number.isFinite(scale) || scale < MIN_ZOOM_SCALE) return null;
	const capped = Math.min(scale, MAX_ZOOM_SCALE);
	let best = DEPTHS[0];
	for (const depth of DEPTHS) {
		if (Math.abs(ZOOM_DEPTH_SCALES[depth] - capped) < Math.abs(ZOOM_DEPTH_SCALES[best] - capped)) {
			best = depth;
		}
	}
	return best;
}

/**
 * Turn zoom keyframes into editor zoom regions.
 * A keyframe that overlaps the next one ends where the next one starts. A keyframe that is too short
 * after that is dropped. A scale below MIN_ZOOM_SCALE is dropped.
 */
export function zoomsToRegions(zooms: ZoomInput[]): ZoomRegion[] {
	const parsed = zooms.map((zoom, index) => {
		const t = finite(zoom.t, `zooms[${index}].t`);
		const dur = finite(zoom.dur, `zooms[${index}].dur`);
		if (t < 0) throw new ScheduleError(`zooms[${index}].t must not be negative`);
		return {
			startMs: Math.round(t * 1000),
			endMs: Math.round((t + clamp(dur, MIN_ZOOM_SEC, MAX_ZOOM_SEC)) * 1000),
			scale: finite(zoom.scale, `zooms[${index}].scale`),
			x: clamp(finite(zoom.x, `zooms[${index}].x`), 0, 1),
			y: clamp(finite(zoom.y, `zooms[${index}].y`), 0, 1),
		};
	});
	parsed.sort((a, b) => a.startMs - b.startMs);

	const regions: ZoomRegion[] = [];
	for (let i = 0; i < parsed.length; i++) {
		const current = parsed[i];
		const next = parsed[i + 1];
		const endMs = next ? Math.min(current.endMs, next.startMs) : current.endMs;
		const depth = scaleToDepth(current.scale);
		if (depth === null || endMs - current.startMs < MIN_ZOOM_REGION_MS) continue;
		regions.push({
			id: `zoom-${regions.length}`,
			startMs: current.startMs,
			endMs,
			depth,
			focus: clampFocusToDepth({ cx: current.x, cy: current.y }, depth),
		});
	}
	return regions;
}

/** How long a caption of this length stays on screen when nothing else bounds it. */
export function captionDurationMs(text: string): number {
	return clamp(CAPTION_BASE_MS + CAPTION_PER_CHAR_MS * text.length, CAPTION_MIN_MS, CAPTION_MAX_MS);
}

/**
 * Turn step captions into caption cues. A cue ends when the next one starts, or after its own
 * reading time. `totalMs` bounds the last cue to the video length when it is known.
 *
 * Each cue carries its whole text as ONE word. The caption layout was made for speech: it pages a flat
 * stream of words and dims the words that are not spoken yet. One word per cue makes every cue its own
 * line, so one caption shows at a time, in full.
 */
export function captionsToCues(
	captions: CaptionInput[],
	options: { lowercase?: boolean; totalMs?: number } = {},
): CaptionCue[] {
	const parsed = captions
		.map((caption, index) => {
			const t = finite(caption.t, `captions[${index}].t`);
			if (t < 0) throw new ScheduleError(`captions[${index}].t must not be negative`);
			if (typeof caption.text !== "string") {
				throw new ScheduleError(`captions[${index}].text must be a string`);
			}
			const trimmed = caption.text.trim();
			if (trimmed.length > MAX_CAPTION_CHARS) {
				throw new ScheduleError(
					`captions[${index}].text is longer than ${MAX_CAPTION_CHARS} characters`,
				);
			}
			return {
				startMs: Math.round(t * 1000),
				text: options.lowercase ? trimmed.toLowerCase() : trimmed,
			};
		})
		.filter((caption) => caption.text.length > 0)
		.sort((a, b) => a.startMs - b.startMs);

	const cues: CaptionCue[] = [];
	for (let i = 0; i < parsed.length; i++) {
		const current = parsed[i];
		const next = parsed[i + 1];
		let endMs = current.startMs + captionDurationMs(current.text);
		if (next) endMs = Math.min(endMs, next.startMs);
		if (options.totalMs !== undefined) endMs = Math.min(endMs, options.totalMs);
		if (endMs <= current.startMs) continue;
		cues.push({
			id: `caption-${cues.length}`,
			startMs: current.startMs,
			endMs,
			text: current.text,
			words: [{ text: current.text, startMs: current.startMs, endMs }],
		});
	}
	return cues;
}

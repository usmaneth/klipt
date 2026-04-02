/**
 * Canvas 2D transition renderer.
 *
 * Blends between two frame snapshots (outgoing / incoming) using
 * crossfade, wipe, zoom, and dissolve effects.  Each effect is a pure
 * function: given a progress value 0→1 and two ImageData sources, it
 * composites the result onto the target canvas context.
 */

import type { TransitionType } from "@/components/video-editor/types";

// ── Easing ──────────────────────────────────────────────────────────────────

function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// ── Individual effects ──────────────────────────────────────────────────────

function crossfade(
	ctx: CanvasRenderingContext2D,
	outgoing: CanvasImageSource,
	incoming: CanvasImageSource,
	w: number,
	h: number,
	progress: number,
) {
	const t = easeInOutCubic(progress);
	ctx.globalAlpha = 1 - t;
	ctx.drawImage(outgoing, 0, 0, w, h);
	ctx.globalAlpha = t;
	ctx.drawImage(incoming, 0, 0, w, h);
	ctx.globalAlpha = 1;
}

function dissolve(
	ctx: CanvasRenderingContext2D,
	outgoing: CanvasImageSource,
	incoming: CanvasImageSource,
	w: number,
	h: number,
	progress: number,
) {
	// Dissolve is similar to crossfade but with a brightness pump in the middle
	const t = easeInOutCubic(progress);
	const brightnessBoost = 1 + 0.3 * Math.sin(Math.PI * progress);

	ctx.globalAlpha = 1;
	ctx.drawImage(outgoing, 0, 0, w, h);

	// Apply brightness boost via composite
	ctx.globalCompositeOperation = "lighter";
	ctx.globalAlpha = 0.15 * Math.sin(Math.PI * progress);
	ctx.fillStyle = "#ffffff";
	ctx.fillRect(0, 0, w, h);
	ctx.globalCompositeOperation = "source-over";

	ctx.globalAlpha = t * brightnessBoost;
	ctx.drawImage(incoming, 0, 0, w, h);
	ctx.globalAlpha = 1;
}

function wipeLeft(
	ctx: CanvasRenderingContext2D,
	outgoing: CanvasImageSource,
	incoming: CanvasImageSource,
	w: number,
	h: number,
	progress: number,
) {
	const t = easeInOutCubic(progress);
	const boundary = Math.round(t * w);

	// Draw outgoing full, then overlay incoming on the left portion
	ctx.drawImage(outgoing, 0, 0, w, h);
	ctx.save();
	ctx.beginPath();
	ctx.rect(0, 0, boundary, h);
	ctx.clip();
	ctx.drawImage(incoming, 0, 0, w, h);
	ctx.restore();
}

function wipeRight(
	ctx: CanvasRenderingContext2D,
	outgoing: CanvasImageSource,
	incoming: CanvasImageSource,
	w: number,
	h: number,
	progress: number,
) {
	const t = easeInOutCubic(progress);
	const boundary = Math.round((1 - t) * w);

	ctx.drawImage(outgoing, 0, 0, w, h);
	ctx.save();
	ctx.beginPath();
	ctx.rect(boundary, 0, w - boundary, h);
	ctx.clip();
	ctx.drawImage(incoming, 0, 0, w, h);
	ctx.restore();
}

function zoomIn(
	ctx: CanvasRenderingContext2D,
	outgoing: CanvasImageSource,
	incoming: CanvasImageSource,
	w: number,
	h: number,
	progress: number,
) {
	const t = easeInOutCubic(progress);

	// Outgoing zooms in and fades out
	ctx.save();
	const outScale = 1 + t * 0.3;
	ctx.globalAlpha = 1 - t;
	ctx.translate(w / 2, h / 2);
	ctx.scale(outScale, outScale);
	ctx.translate(-w / 2, -h / 2);
	ctx.drawImage(outgoing, 0, 0, w, h);
	ctx.restore();

	// Incoming starts zoomed out and scales to normal
	ctx.save();
	const inScale = 0.7 + t * 0.3;
	ctx.globalAlpha = t;
	ctx.translate(w / 2, h / 2);
	ctx.scale(inScale, inScale);
	ctx.translate(-w / 2, -h / 2);
	ctx.drawImage(incoming, 0, 0, w, h);
	ctx.restore();

	ctx.globalAlpha = 1;
}

function zoomOut(
	ctx: CanvasRenderingContext2D,
	outgoing: CanvasImageSource,
	incoming: CanvasImageSource,
	w: number,
	h: number,
	progress: number,
) {
	const t = easeInOutCubic(progress);

	// Outgoing shrinks and fades
	ctx.save();
	const outScale = 1 - t * 0.3;
	ctx.globalAlpha = 1 - t;
	ctx.translate(w / 2, h / 2);
	ctx.scale(outScale, outScale);
	ctx.translate(-w / 2, -h / 2);
	ctx.drawImage(outgoing, 0, 0, w, h);
	ctx.restore();

	// Incoming appears with slight zoom-out
	ctx.save();
	const inScale = 1.3 - t * 0.3;
	ctx.globalAlpha = t;
	ctx.translate(w / 2, h / 2);
	ctx.scale(inScale, inScale);
	ctx.translate(-w / 2, -h / 2);
	ctx.drawImage(incoming, 0, 0, w, h);
	ctx.restore();

	ctx.globalAlpha = 1;
}

// ── Dispatch ────────────────────────────────────────────────────────────────

const EFFECTS: Record<
	TransitionType,
	(
		ctx: CanvasRenderingContext2D,
		outgoing: CanvasImageSource,
		incoming: CanvasImageSource,
		w: number,
		h: number,
		progress: number,
	) => void
> = {
	crossfade,
	dissolve,
	"wipe-left": wipeLeft,
	"wipe-right": wipeRight,
	"zoom-in": zoomIn,
	"zoom-out": zoomOut,
};

/**
 * Render a transition frame.
 *
 * @param ctx        Target canvas context (will be cleared before drawing)
 * @param type       Transition type identifier
 * @param outgoing   The last fully-rendered frame *before* the transition
 * @param incoming   The current frame being rendered
 * @param w          Canvas width
 * @param h          Canvas height
 * @param progress   0 → 1  (0 = fully outgoing, 1 = fully incoming)
 */
export function renderTransitionFrame(
	ctx: CanvasRenderingContext2D,
	type: TransitionType,
	outgoing: CanvasImageSource,
	incoming: CanvasImageSource,
	w: number,
	h: number,
	progress: number,
) {
	ctx.clearRect(0, 0, w, h);
	const effectFn = EFFECTS[type] ?? crossfade;
	effectFn(ctx, outgoing, incoming, w, h, Math.max(0, Math.min(1, progress)));
}

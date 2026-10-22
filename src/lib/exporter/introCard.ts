/**
 * An intro card is a still frame that the exporter encodes before the first video frame.
 * `draw` paints one frame on a canvas of the output size. The video starts after the card.
 */
export interface IntroCard {
	durationMs: number;
	draw: (
		ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
		width: number,
		height: number,
	) => void | Promise<void>;
}

/** How many frames the card takes. Zero when there is no card. A card of any length has one frame at least. */
export function introFrameCount(durationMs: number | undefined, frameRate: number): number {
	if (durationMs === undefined || !(durationMs > 0) || !(frameRate > 0)) return 0;
	return Math.max(1, Math.round((durationMs / 1000) * frameRate));
}

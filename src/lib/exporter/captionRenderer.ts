// Export-time caption renderer — draws captions onto a 2D canvas context

import {
	type CaptionCue,
	type CaptionPage,
	buildActiveCaptionLayout,
	buildCaptionLines,
	buildCaptionPages,
	flattenCaptionWords,
} from "@/components/video-editor/captionLayout";
import {
	type CaptionSettings,
	captionBackgroundBox,
	karaokeProgress,
	scaleFontSize,
	wordColor,
	wordOpacity,
	wordVisible,
} from "@/components/video-editor/captionStyle";

/**
 * Pre-compute layout once per export (call before the frame loop).
 * If `translatedCues` are provided, their text is used while timing
 * comes from the original cues.
 */
export function buildExportCaptionPages(
	cues: CaptionCue[],
	canvasWidth: number,
	fontSize: number,
	fontFamily: string,
	maxRows: number,
	translatedCues?: CaptionCue[],
): CaptionPage[] {
	const displayCues = translatedCues && translatedCues.length > 0 ? translatedCues : cues;
	const words = flattenCaptionWords(displayCues);
	const maxWidth = canvasWidth * 0.85;
	const lines = buildCaptionLines(words, maxWidth, fontSize, fontFamily);
	return buildCaptionPages(lines, maxRows);
}

/**
 * Renders captions for a single frame onto a 2D canvas context.
 *
 * @param ctx        - The 2D rendering context of the composite/export canvas
 * @param canvasWidth  - Width of the export canvas
 * @param canvasHeight - Height of the export canvas
 * @param timeMs     - Current frame time in milliseconds
 * @param pages      - Pre-built caption pages (from `buildExportCaptionPages`)
 * @param settings   - Caption visual settings
 */
export function renderCaptions(
	ctx: CanvasRenderingContext2D,
	canvasWidth: number,
	canvasHeight: number,
	timeMs: number,
	pages: CaptionPage[],
	settings: CaptionSettings,
): void {
	if (!settings.enabled || pages.length === 0) return;

	const layout = buildActiveCaptionLayout(pages, timeMs);
	if (!layout.page) return;

	const fontSize = scaleFontSize(settings.fontSize, canvasWidth);
	const lineCount = layout.page.lines.length;
	const box = captionBackgroundBox(
		canvasWidth,
		canvasHeight,
		lineCount,
		settings.fontSize,
		settings.positionOffset,
	);

	// Draw background box
	ctx.save();
	ctx.beginPath();
	roundRect(ctx, box.x, box.y, box.width, box.height, 12);
	ctx.fillStyle = `rgba(0, 0, 0, ${settings.backgroundOpacity})`;
	ctx.fill();

	// Draw words line by line
	const font = `bold ${fontSize}px ${settings.fontFamily}`;
	ctx.font = font;
	ctx.textBaseline = "top";

	const lineHeight = fontSize * 1.4;
	const textStartY = box.y + (box.height - lineCount * lineHeight) / 2;

	const animation = settings.animation ?? "none";

	let wordIdx = 0;
	for (let li = 0; li < layout.page.lines.length; li++) {
		const line = layout.page.lines[li];

		// Measure full line width for centering
		const lineText = line.words.map((w) => w.text).join(" ");
		const lineWidth = ctx.measureText(lineText).width;
		let cursorX = box.x + (box.width - lineWidth) / 2;
		const cursorY = textStartY + li * lineHeight;

		for (let wi = 0; wi < line.words.length; wi++) {
			const aw = layout.words[wordIdx++];
			const text = (wi > 0 ? " " : "") + aw.text;

			// Typewriter: skip words not yet spoken
			if (animation === "typewriter" && !wordVisible(aw.state, animation)) {
				continue;
			}

			ctx.globalAlpha = wordOpacity(aw.state);
			ctx.fillStyle = wordColor(aw.state, settings);

			const activeScale = settings.activeScale ?? 1.2;

			// Adjust opacity for highlight-driven styles
			if (animation === "bold-pop" || animation === "bounce" || animation === "glow") {
				ctx.globalAlpha = aw.state === "active" ? 1 : 0.7;
			}

			// Draw highlight background behind active words
			if (aw.state === "active" && settings.highlightColor && animation !== "bold-pop" && animation !== "karaoke" && animation !== "bounce" && animation !== "glow") {
				const wordWidth = ctx.measureText(text).width;
				const highlightPadding = fontSize * 0.15;
				ctx.save();
				ctx.globalAlpha = 0.25;
				ctx.fillStyle = settings.highlightColor;
				ctx.beginPath();
				roundRect(
					ctx,
					cursorX - highlightPadding / 2,
					cursorY - highlightPadding / 2,
					wordWidth + highlightPadding,
					fontSize * 1.2 + highlightPadding,
					4,
				);
				ctx.fill();
				ctx.restore();
				// Restore word style after highlight
				ctx.globalAlpha = wordOpacity(aw.state);
				ctx.fillStyle = wordColor(aw.state, settings);
			}

			// Apply animation transforms for active words
			if (aw.state === "active" && animation !== "none") {
				ctx.save();
				if (animation === "rise") {
					ctx.fillText(text, cursorX, cursorY - fontSize * 0.06);
				} else if (animation === "pop") {
					const wordWidth = ctx.measureText(text).width;
					const scale = 1.08;
					const cx = cursorX + wordWidth / 2;
					const cy = cursorY + fontSize * 0.6;
					ctx.translate(cx, cy);
					ctx.scale(scale, scale);
					ctx.translate(-cx, -cy);
					ctx.fillText(text, cursorX, cursorY);
				} else if (animation === "bold-pop") {
					const wordWidth = ctx.measureText(text).width;
					const cx = cursorX + wordWidth / 2;
					const cy = cursorY + fontSize * 0.6;
					ctx.translate(cx, cy);
					ctx.scale(activeScale, activeScale);
					ctx.translate(-cx, -cy);
					ctx.font = `900 ${fontSize}px ${settings.fontFamily}`;
					ctx.fillText(text, cursorX, cursorY);
					ctx.font = font; // restore
				} else if (animation === "bounce") {
					const wordWidth = ctx.measureText(text).width;
					const cx = cursorX + wordWidth / 2;
					const cy = cursorY + fontSize * 0.6;
					ctx.translate(cx, cy);
					ctx.scale(activeScale, activeScale);
					ctx.translate(-cx, -cy);
					ctx.fillText(text, cursorX, cursorY - fontSize * 0.08);
				} else if (animation === "glow") {
					const glowColor = settings.activeColor ?? settings.highlightColor;
					ctx.shadowColor = glowColor;
					ctx.shadowBlur = 16;
					ctx.fillText(text, cursorX, cursorY);
					// Draw again for stronger glow
					ctx.fillText(text, cursorX, cursorY);
					ctx.shadowBlur = 0;
					ctx.shadowColor = "transparent";
				} else if (animation === "karaoke") {
					// Karaoke: draw inactive color first, then clip active color
					const wordWidth = ctx.measureText(text).width;
					const progress = karaokeProgress(aw.startMs, aw.endMs, timeMs);
					const fillWidth = wordWidth * progress;

					// Draw full word in inactive color
					ctx.fillStyle = settings.inactiveTextColor;
					ctx.globalAlpha = 1;
					ctx.fillText(text, cursorX, cursorY);

					// Clip and draw filled portion in active color
					ctx.save();
					ctx.beginPath();
					ctx.rect(cursorX, cursorY - fontSize * 0.2, fillWidth, fontSize * 1.6);
					ctx.clip();
					ctx.fillStyle = settings.activeColor ?? settings.highlightColor;
					ctx.fillText(text, cursorX, cursorY);
					ctx.restore();
				} else {
					ctx.fillText(text, cursorX, cursorY);
				}
				ctx.restore();
			} else if (animation === "karaoke") {
				// For spoken/upcoming words in karaoke mode
				const progress = aw.state === "spoken" ? 1 : 0;
				if (progress === 1) {
					ctx.fillStyle = settings.activeColor ?? settings.highlightColor;
					ctx.globalAlpha = 1;
				} else {
					ctx.fillStyle = settings.inactiveTextColor;
					ctx.globalAlpha = 1;
				}
				ctx.fillText(text, cursorX, cursorY);
			} else {
				ctx.fillText(text, cursorX, cursorY);
			}

			cursorX += ctx.measureText(text).width;
		}
	}

	ctx.restore();
}

/** Draws a rounded rectangle path (compatible with older canvas APIs). */
function roundRect(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): void {
	if (typeof ctx.roundRect === "function") {
		ctx.roundRect(x, y, w, h, r);
		return;
	}
	// Manual fallback
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

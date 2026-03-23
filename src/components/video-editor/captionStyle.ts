// Caption style utilities — font scaling, word visual states, background box sizing

import type { WordAnimationState } from "./captionLayout";

export type CaptionAnimationStyle = "none" | "fade" | "rise" | "pop";

export interface CaptionSettings {
	enabled: boolean;
	fontSize: number; // 16-72, default 30
	maxRows: number; // 1-4, default 1
	positionOffset: number; // 0-100, default 85 (% from top)
	backgroundOpacity: number; // 0-1, default 0.6
	textColor: string; // active/spoken text
	inactiveTextColor: string; // upcoming text
	highlightColor: string; // active word background
	animation: CaptionAnimationStyle;
	language: string; // "auto" | "en" | "es" | "fr" | "de" | etc.
	fontFamily: string;
}

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
	enabled: false,
	fontSize: 30,
	maxRows: 1,
	positionOffset: 85,
	backgroundOpacity: 0.6,
	textColor: "#FFFFFF",
	inactiveTextColor: "#AAAAAA",
	highlightColor: "#FFDD00",
	animation: "none",
	fontFamily: "Inter, system-ui, sans-serif",
	language: "auto",
};

/** Reference width used for relative font scaling */
const REFERENCE_WIDTH = 1920;

/**
 * Scales the configured font size relative to actual canvas/container width
 * so captions look proportionally the same at any resolution.
 */
export function scaleFontSize(configuredSize: number, canvasWidth: number): number {
	return Math.round(configuredSize * (canvasWidth / REFERENCE_WIDTH));
}

/** Returns CSS color for a word based on its animation state */
export function wordColor(
	state: WordAnimationState,
	settings: CaptionSettings,
): string {
	switch (state) {
		case "active":
			return settings.highlightColor;
		case "spoken":
			return settings.textColor;
		case "upcoming":
			return settings.inactiveTextColor;
	}
}

/** Returns opacity for a word based on its animation state */
export function wordOpacity(state: WordAnimationState): number {
	switch (state) {
		case "active":
			return 1;
		case "spoken":
			return 0.85;
		case "upcoming":
			return 0.5;
	}
}

/**
 * Computes the background box dimensions for a set of caption lines.
 * Returns { x, y, width, height } relative to the container/canvas.
 */
export function captionBackgroundBox(
	containerWidth: number,
	containerHeight: number,
	lineCount: number,
	fontSize: number,
	positionOffset: number,
	paddingH = 24,
	paddingV = 12,
	lineHeight = 1.4,
): { x: number; y: number; width: number; height: number } {
	const scaledFontSize = scaleFontSize(fontSize, containerWidth);
	const textBlockHeight = lineCount * scaledFontSize * lineHeight;
	const boxHeight = textBlockHeight + paddingV * 2;
	const boxWidth = Math.min(containerWidth * 0.9, containerWidth - paddingH * 2);
	const x = (containerWidth - boxWidth) / 2;
	const y = (containerHeight * positionOffset) / 100 - boxHeight / 2;

	return { x, y, width: boxWidth, height: boxHeight };
}

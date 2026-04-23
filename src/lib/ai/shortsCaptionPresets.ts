// Punchy, shorts-style caption presets — optimized for 9:16 playback on TikTok,
// Reels and YouTube Shorts. Each preset is a ready-to-apply `Partial<CaptionSettings>`
// you can spread over the user's current caption settings.

import type { CaptionSettings } from "@/components/video-editor/captionStyle";

export interface ShortsCaptionPreset {
	id: string;
	label: string;
	description: string;
	/** Shown as a miniature sample in the UI. */
	preview: { text: string; activeWord: string };
	apply: Partial<CaptionSettings>;
}

/**
 * Short-form caption styles. These intentionally push font size up, lean on
 * word-level highlight animations, and disable the rounded background box
 * that's appropriate for long-form playback but feels dated on Shorts.
 */
export const SHORTS_CAPTION_PRESETS: ShortsCaptionPreset[] = [
	{
		id: "viral-yellow",
		label: "Viral Yellow",
		description:
			"Big bold white text with a yellow bold-pop on the active word. Classic MrBeast energy.",
		preview: { text: "This changes everything", activeWord: "everything" },
		apply: {
			enabled: true,
			fontSize: 52,
			maxRows: 2,
			positionOffset: 72,
			backgroundOpacity: 0,
			textColor: "#FFFFFF",
			inactiveTextColor: "#FFFFFF",
			highlightColor: "#FFDD00",
			activeColor: "#FFDD00",
			activeScale: 1.3,
			animation: "bold-pop",
			fontFamily: "Inter, system-ui, sans-serif",
		},
	},
	{
		id: "hormozi-green",
		label: "Hormozi Green",
		description:
			"Chunky green-on-white highlight for hooks and quotes. Works great on talking-head shorts.",
		preview: { text: "The secret is simple", activeWord: "secret" },
		apply: {
			enabled: true,
			fontSize: 56,
			maxRows: 2,
			positionOffset: 68,
			backgroundOpacity: 0,
			textColor: "#FFFFFF",
			inactiveTextColor: "#FFFFFF",
			highlightColor: "#29F06B",
			activeColor: "#29F06B",
			activeScale: 1.25,
			animation: "bounce",
			fontFamily: "Inter, system-ui, sans-serif",
		},
	},
	{
		id: "tiktok-karaoke",
		label: "TikTok Karaoke",
		description: "Word-by-word fill, white → magenta. Built for music-led shorts.",
		preview: { text: "You won’t believe this", activeWord: "believe" },
		apply: {
			enabled: true,
			fontSize: 48,
			maxRows: 2,
			positionOffset: 65,
			backgroundOpacity: 0,
			textColor: "#FFFFFF",
			inactiveTextColor: "#FFFFFF",
			highlightColor: "#FF3AB1",
			activeColor: "#FF3AB1",
			activeScale: 1.1,
			animation: "karaoke",
			fontFamily: "Inter, system-ui, sans-serif",
		},
	},
	{
		id: "glow-blue",
		label: "Glow Blue",
		description:
			"Soft glowing cyan on the active word, muted inactive text. Good for tech/AI shorts.",
		preview: { text: "AI just did something wild", activeWord: "wild" },
		apply: {
			enabled: true,
			fontSize: 46,
			maxRows: 2,
			positionOffset: 70,
			backgroundOpacity: 0,
			textColor: "#E7F5FF",
			inactiveTextColor: "#8FB8D9",
			highlightColor: "#4AC7FF",
			activeColor: "#4AC7FF",
			activeScale: 1.15,
			animation: "glow",
			fontFamily: "Inter, system-ui, sans-serif",
		},
	},
	{
		id: "classic-reels",
		label: "Reels Clean",
		description: "One word at a time, typewriter reveal. Works when the voice drives the video.",
		preview: { text: "Watch until the end", activeWord: "end" },
		apply: {
			enabled: true,
			fontSize: 54,
			maxRows: 1,
			positionOffset: 62,
			backgroundOpacity: 0,
			textColor: "#FFFFFF",
			inactiveTextColor: "#FFFFFF",
			highlightColor: "#FFFFFF",
			activeColor: "#FFFFFF",
			activeScale: 1.2,
			animation: "typewriter",
			fontFamily: "Inter, system-ui, sans-serif",
		},
	},
];

export function applyShortsCaptionPreset(
	current: CaptionSettings,
	presetId: string,
): CaptionSettings {
	const preset = SHORTS_CAPTION_PRESETS.find((p) => p.id === presetId);
	if (!preset) return current;
	return { ...current, ...preset.apply };
}

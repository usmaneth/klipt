import {
	type CaptionSettings,
	DEFAULT_CAPTION_SETTINGS,
} from "@/components/video-editor/captionStyle";
import type { PresetName } from "./job";

export const BRAND = {
	background: "#0D0D0D",
	accent: "#E0000F",
	text: "#FFFFFF",
	font: "Inter, system-ui, sans-serif",
} as const;

export interface HeadlessPreset {
	name: PresetName;
	width: number;
	height: number;
	frameRate: number;
	bitrate: number;
	wallpaper: string;
	/** Percent of the canvas that the video gives up as margin. See FrameRenderer.computeLayout. */
	padding: number;
	/** In output pixels. The preview size below makes the renderer use it as is. */
	borderRadius: number;
	shadowIntensity: number;
	titleCardMs: number;
	/** The copy of the brand is lowercase. */
	lowercaseCopy: boolean;
	captionSettings: CaptionSettings;
}

/** A portrait screen recording of a phone, on the klipt brand background. */
export const PHONE_DEMO: HeadlessPreset = {
	name: "phone-demo",
	width: 1080,
	height: 1920,
	frameRate: 30,
	bitrate: 8_000_000,
	wallpaper: BRAND.background,
	padding: 8,
	borderRadius: 56,
	shadowIntensity: 0.6,
	titleCardMs: 1500,
	lowercaseCopy: true,
	captionSettings: {
		...DEFAULT_CAPTION_SETTINGS,
		enabled: true,
		fontSize: 72,
		maxRows: 1,
		positionOffset: 88,
		backgroundOpacity: 0.72,
		textColor: BRAND.text,
		inactiveTextColor: BRAND.text,
		// The active word is the whole caption. It is white, like the rest of the copy.
		highlightColor: BRAND.text,
		activeColor: BRAND.text,
		// The other styles either draw a pale box behind the active word or scale the text past the screen.
		animation: "glow",
		fontFamily: BRAND.font,
	},
};

export function resolvePreset(name: PresetName): HeadlessPreset {
	switch (name) {
		case "phone-demo":
			return PHONE_DEMO;
	}
}

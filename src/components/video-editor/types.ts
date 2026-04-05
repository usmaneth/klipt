export interface Chapter {
	startMs: number;
	endMs: number;
	title: string;
	confidence: number; // 0-1
}

export interface TimelineComment {
	id: string;
	timeMs: number;
	text: string;
	author?: string;
	createdAt: number; // unix timestamp
	color?: string;
	type?: "text" | "emoji";
	emoji?: string; // the emoji character for emoji-type comments
}

export type ZoomDepth = 1 | 2 | 3 | 4 | 5 | 6;

export interface ZoomFocus {
	cx: number; // normalized horizontal center (0-1)
	cy: number; // normalized vertical center (0-1)
}

export interface ZoomRegion {
	id: string;
	startMs: number;
	endMs: number;
	depth: ZoomDepth;
	focus: ZoomFocus;
}

export interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	interactionType?: "move" | "click" | "double-click" | "right-click" | "middle-click" | "mouseup";
	cursorType?:
		| "arrow"
		| "text"
		| "pointer"
		| "crosshair"
		| "open-hand"
		| "closed-hand"
		| "resize-ew"
		| "resize-ns"
		| "not-allowed";
}

export type CursorStyle = "default" | "dot" | "figma" | "mono";

export const CURSOR_STYLE_OPTIONS: Array<{ value: CursorStyle; label: string }> = [
	{ value: "default", label: "Default" },
	{ value: "dot", label: "Dot" },
	{ value: "figma", label: "Figma" },
	{ value: "mono", label: "Mono" },
];

export interface CursorVisualSettings {
	size: number;
	smoothing: number;
	motionBlur: number;
	clickBounce: number;
	sway: number;
}

export const DEFAULT_CURSOR_SIZE = 3.0;
export const DEFAULT_CURSOR_SMOOTHING = 0.67;
export const DEFAULT_CURSOR_MOTION_BLUR = 0.35;
export const DEFAULT_CURSOR_CLICK_BOUNCE = 2.5;
export const DEFAULT_CURSOR_SWAY = 0.25;
export const DEFAULT_ZOOM_MOTION_BLUR = 0.35;

export interface TrimRegion {
	id: string;
	startMs: number;
	endMs: number;
}

export type AnnotationType = "text" | "image" | "figure";

export type ArrowDirection =
	| "up"
	| "down"
	| "left"
	| "right"
	| "up-right"
	| "up-left"
	| "down-right"
	| "down-left";

export interface FigureData {
	arrowDirection: ArrowDirection;
	color: string;
	strokeWidth: number;
}

export interface AnnotationPosition {
	x: number;
	y: number;
}

export interface AnnotationSize {
	width: number;
	height: number;
}

export interface AnnotationTextStyle {
	color: string;
	backgroundColor: string;
	fontSize: number; // pixels
	fontFamily: string;
	fontWeight: "normal" | "bold";
	fontStyle: "normal" | "italic";
	textDecoration: "none" | "underline";
	textAlign: "left" | "center" | "right";
}

function getDefaultAnnotationFontFamily() {
	if (typeof navigator !== "undefined" && /mac/i.test(navigator.platform)) {
		return '"SF Pro Display", "SF Pro Text", -apple-system, BlinkMacSystemFont, sans-serif';
	}

	return "Inter, system-ui, sans-serif";
}

export interface AnnotationRegion {
	id: string;
	startMs: number;
	endMs: number;
	type: AnnotationType;
	content: string; // Legacy - still used for current type
	textContent?: string; // Separate storage for text
	imageContent?: string; // Separate storage for image data URL
	position: AnnotationPosition;
	size: AnnotationSize;
	style: AnnotationTextStyle;
	zIndex: number;
	figureData?: FigureData;
}

export const DEFAULT_ANNOTATION_POSITION: AnnotationPosition = {
	x: 50,
	y: 50,
};

export const DEFAULT_ANNOTATION_SIZE: AnnotationSize = {
	width: 30,
	height: 20,
};

export const DEFAULT_ANNOTATION_STYLE: AnnotationTextStyle = {
	color: "#ffffff",
	backgroundColor: "transparent",
	fontSize: 32,
	fontFamily: getDefaultAnnotationFontFamily(),
	fontWeight: "bold",
	fontStyle: "normal",
	textDecoration: "none",
	textAlign: "center",
};

export const DEFAULT_FIGURE_DATA: FigureData = {
	arrowDirection: "right",
	color: "#E0000F",
	strokeWidth: 4,
};

export interface CropRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const DEFAULT_CROP_REGION: CropRegion = {
	x: 0,
	y: 0,
	width: 1,
	height: 1,
};

export interface AudioRegion {
	id: string;
	startMs: number;
	endMs: number;
	audioPath: string;
	volume: number;
	fadeInMs?: number;
	fadeOutMs?: number;
}

export type SoundEffectId =
	| "sfx-click"
	| "sfx-whoosh"
	| "sfx-pop"
	| "sfx-ding"
	| "sfx-swoosh"
	| "sfx-thud"
	| "sfx-rise"
	| "sfx-fall";

export interface SoundEffectRegion {
	id: string;
	startMs: number;
	endMs: number;
	soundId: SoundEffectId;
	volume: number;
}

export type TransitionType =
	| "crossfade"
	| "wipe-left"
	| "wipe-right"
	| "zoom-in"
	| "zoom-out"
	| "dissolve";

export interface TransitionRegion {
	id: string;
	/** The output-timeline timestamp (ms) where the transition is centered */
	atMs: number;
	/** Total transition duration in ms (half before, half after) */
	durationMs: number;
	type: TransitionType;
}

export type PlaybackSpeed = 0.25 | 0.5 | 0.75 | 1.25 | 1.5 | 1.75 | 2;

export interface SpeedRegion {
	id: string;
	startMs: number;
	endMs: number;
	speed: PlaybackSpeed;
}

export const SPEED_OPTIONS: Array<{ speed: PlaybackSpeed; label: string }> = [
	{ speed: 0.25, label: "0.25×" },
	{ speed: 0.5, label: "0.5×" },
	{ speed: 0.75, label: "0.75×" },
	{ speed: 1.25, label: "1.25×" },
	{ speed: 1.5, label: "1.5×" },
	{ speed: 1.75, label: "1.75×" },
	{ speed: 2, label: "2×" },
];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1.5;

export const ZOOM_DEPTH_SCALES: Record<ZoomDepth, number> = {
	1: 1.25,
	2: 1.5,
	3: 1.8,
	4: 2.2,
	5: 3.5,
	6: 5.0,
};

// ── Live Annotation Types (recording overlay) ────────────────────────────

export type LiveAnnotationTool =
	| "pen"
	| "arrow"
	| "rect"
	| "circle"
	| "text"
	| "highlight";

export const LIVE_ANNOTATION_TOOLS: Array<{
	value: LiveAnnotationTool;
	label: string;
}> = [
	{ value: "pen", label: "Pen" },
	{ value: "arrow", label: "Arrow" },
	{ value: "rect", label: "Rectangle" },
	{ value: "circle", label: "Circle" },
	{ value: "text", label: "Text" },
	{ value: "highlight", label: "Highlight" },
];

export interface LiveAnnotation {
	id: string;
	type: LiveAnnotationTool;
	points: Array<{ x: number; y: number }>; // normalized 0-1
	color: string;
	strokeWidth: number;
	startMs: number;
	durationMs: number; // how long it stays visible (-1 = permanent)
	text?: string; // for text annotations
}

export type LiveAnnotationFadeOption = 3000 | 5000 | 10000 | -1;

export const LIVE_ANNOTATION_FADE_OPTIONS: Array<{
	value: LiveAnnotationFadeOption;
	label: string;
}> = [
	{ value: 3000, label: "3s" },
	{ value: 5000, label: "5s" },
	{ value: 10000, label: "10s" },
	{ value: -1, label: "Permanent" },
];

export const LIVE_ANNOTATION_PRESET_COLORS = [
	"#E0000F",
	"#FF9500",
	"#FFD700",
	"#34C759",
	"#007AFF",
	"#AF52DE",
];

// ── Face Blur Types ──────────────────────────────────────────────────────

export type FaceBlurStyle = "gaussian" | "pixelate" | "blackbar";

export interface FaceBlurRegion {
	id: string;
	startMs: number;
	endMs: number;
	x: number; // normalized 0-1
	y: number; // normalized 0-1
	width: number; // normalized 0-1
	height: number; // normalized 0-1
	blurStyle: FaceBlurStyle;
	enabled: boolean;
}

export const FACE_BLUR_STYLE_OPTIONS: Array<{ value: FaceBlurStyle; label: string }> = [
	{ value: "gaussian", label: "Gaussian Blur" },
	{ value: "pixelate", label: "Pixelate" },
	{ value: "blackbar", label: "Black Bar" },
];

export type ClickHighlightSize = "small" | "medium" | "large";

export interface ClickHighlightSettings {
	enabled: boolean;
	color: string;
	size: ClickHighlightSize;
}

export const DEFAULT_CLICK_HIGHLIGHT_SETTINGS: ClickHighlightSettings = {
	enabled: false,
	color: "#E0000F",
	size: "medium",
};

export const CLICK_HIGHLIGHT_SIZE_MAP: Record<ClickHighlightSize, { start: number; end: number }> =
	{
		small: { start: 6, end: 24 },
		medium: { start: 10, end: 40 },
		large: { start: 16, end: 60 },
	};

export type AutoStopDuration = 0 | 60000 | 120000 | 300000 | 600000 | 1800000 | 3600000;

export interface RecordingTimerSettings {
	autoStopMs: AutoStopDuration;
	showTimerOverlay: boolean;
}

export const DEFAULT_RECORDING_TIMER_SETTINGS: RecordingTimerSettings = {
	autoStopMs: 0,
	showTimerOverlay: false,
};

export const AUTO_STOP_OPTIONS: Array<{ value: AutoStopDuration; label: string }> = [
	{ value: 0, label: "Off" },
	{ value: 60000, label: "1 min" },
	{ value: 120000, label: "2 min" },
	{ value: 300000, label: "5 min" },
	{ value: 600000, label: "10 min" },
	{ value: 1800000, label: "30 min" },
	{ value: 3600000, label: "1 hr" },
];

export type ColorCorrectionProfile = "auto" | "warm" | "cool" | "vivid";

export const COLOR_CORRECTION_PROFILES: Array<{
	value: ColorCorrectionProfile;
	label: string;
	description: string;
}> = [
	{ value: "auto", label: "Auto", description: "Automatic levels correction" },
	{ value: "warm", label: "Warm", description: "Warm color temperature" },
	{ value: "cool", label: "Cool", description: "Cool color temperature" },
	{ value: "vivid", label: "Vivid", description: "Enhanced saturation & contrast" },
];

export const DEFAULT_ZOOM_DEPTH: ZoomDepth = 3;

export function clampFocusToDepth(focus: ZoomFocus, depth: ZoomDepth): ZoomFocus {
	const zoomScale = ZOOM_DEPTH_SCALES[depth];
	const marginX = 1 / (2 * zoomScale);
	const marginY = 1 / (2 * zoomScale);
	return {
		cx: clamp(focus.cx, marginX, 1 - marginX),
		cy: clamp(focus.cy, marginY, 1 - marginY),
	};
}

function clamp(value: number, min: number, max: number) {
	if (Number.isNaN(value)) return (min + max) / 2;
	return Math.min(max, Math.max(min, value));
}

// Live preview overlay — renders captions on top of the video in VideoPlayback

import { useMemo } from "react";
import {
	type CaptionCue,
	type CaptionPage,
	buildActiveCaptionLayout,
	buildCaptionLines,
	buildCaptionPages,
	flattenCaptionWords,
} from "./captionLayout";
import {
	type CaptionAnimationStyle,
	type CaptionSettings,
	captionBackgroundBox,
	scaleFontSize,
	wordColor,
	wordOpacity,
} from "./captionStyle";

interface CaptionOverlayProps {
	cues: CaptionCue[];
	/** Optional translated cues — if provided, text is taken from these while timing uses the originals. */
	translatedCues?: CaptionCue[];
	currentTimeMs: number;
	containerWidth: number;
	containerHeight: number;
	settings: CaptionSettings;
}

/** CSS transition string for a given animation style */
function animationTransition(animation: CaptionAnimationStyle): string {
	switch (animation) {
		case "fade":
			return "opacity 0.2s ease-in-out";
		case "rise":
			return "opacity 0.2s ease-out, transform 0.2s ease-out";
		case "pop":
			return "opacity 0.15s ease-out, transform 0.15s cubic-bezier(0.34,1.56,0.64,1)";
		default:
			return "none";
	}
}

/** Per-word inline style including animation */
function wordStyle(
	state: "active" | "upcoming" | "spoken",
	settings: CaptionSettings,
	scaledFontSize: number,
): React.CSSProperties {
	const base: React.CSSProperties = {
		color: wordColor(state, settings),
		opacity: wordOpacity(state),
		display: "inline-block",
		fontWeight: 700,
		fontSize: `${scaledFontSize}px`,
		fontFamily: settings.fontFamily,
		lineHeight: 1.4,
		transition: animationTransition(settings.animation),
		whiteSpace: "pre",
	};

	if (settings.animation === "rise" && state === "active") {
		base.transform = "translateY(-2px)";
	} else if (settings.animation === "pop" && state === "active") {
		base.transform = "scale(1.08)";
	}

	return base;
}

export function CaptionOverlay({
	cues,
	translatedCues,
	currentTimeMs,
	containerWidth,
	containerHeight,
	settings,
}: CaptionOverlayProps) {
	// Use translated cues for display if available, original cues for timing
	const displayCues = translatedCues && translatedCues.length > 0 ? translatedCues : cues;
	if (!settings.enabled || cues.length === 0) return null;

	const fontSize = scaleFontSize(settings.fontSize, containerWidth);

	// Build layout data — memoised on cues + settings that affect layout
	const pages: CaptionPage[] = useMemo(() => {
		const words = flattenCaptionWords(displayCues);
		const maxWidth = containerWidth * 0.85;
		const lines = buildCaptionLines(words, maxWidth, fontSize, settings.fontFamily);
		return buildCaptionPages(lines, settings.maxRows);
	}, [displayCues, containerWidth, fontSize, settings.fontFamily, settings.maxRows]);

	const layout = buildActiveCaptionLayout(pages, currentTimeMs);
	if (!layout.page) return null;

	const lineCount = layout.page.lines.length;
	const box = captionBackgroundBox(
		containerWidth,
		containerHeight,
		lineCount,
		settings.fontSize,
		settings.positionOffset,
	);

	// Group animated words back into lines for rendering
	let wordIdx = 0;
	const renderedLines = layout.page.lines.map((line, li) => {
		const lineWords = line.words.map((_w, wi) => {
			const aw = layout.words[wordIdx++];
			return (
				<span key={`${li}-${wi}`} style={wordStyle(aw.state, settings, fontSize)}>
					{wi > 0 ? " " : ""}
					{aw.text}
				</span>
			);
		});
		return (
			<div key={li} style={{ textAlign: "center" }}>
				{lineWords}
			</div>
		);
	});

	return (
		<div
			style={{
				position: "absolute",
				left: `${box.x}px`,
				top: `${box.y}px`,
				width: `${box.width}px`,
				height: `${box.height}px`,
				display: "flex",
				flexDirection: "column",
				justifyContent: "center",
				alignItems: "center",
				backgroundColor: `rgba(0, 0, 0, ${settings.backgroundOpacity})`,
				borderRadius: "12px",
				pointerEvents: "none",
				zIndex: 40,
				padding: "12px 24px",
				boxSizing: "border-box",
			}}
		>
			{renderedLines}
		</div>
	);
}

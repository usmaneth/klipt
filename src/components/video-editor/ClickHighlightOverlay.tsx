import { useMemo } from "react";
import { CLICK_HIGHLIGHT_SIZE_MAP, type ClickHighlightSize } from "./types";

export interface ClickEvent {
	timeMs: number;
	x: number; // normalized 0-1
	y: number; // normalized 0-1
}

interface ClickHighlightOverlayProps {
	clicks: ClickEvent[];
	currentTimeMs: number;
	enabled: boolean;
	color?: string;
	size?: ClickHighlightSize;
}

const WINDOW_MS = 200;
const ANIMATION_DURATION_MS = 500;

/**
 * Renders expanding ring animations at cursor click positions during playback.
 * Positioned absolutely over the video player container.
 */
export function ClickHighlightOverlay({
	clicks,
	currentTimeMs,
	enabled,
	color = "#E0000F",
	size = "medium",
}: ClickHighlightOverlayProps) {
	const visibleClicks = useMemo(() => {
		if (!enabled) return [];
		return clicks.filter(
			(c) => currentTimeMs >= c.timeMs - WINDOW_MS && currentTimeMs <= c.timeMs + WINDOW_MS,
		);
	}, [clicks, currentTimeMs, enabled]);

	if (!enabled || visibleClicks.length === 0) return null;

	const { start: startDiameter, end: endDiameter } = CLICK_HIGHLIGHT_SIZE_MAP[size];

	return (
		<div
			style={{
				position: "absolute",
				inset: 0,
				pointerEvents: "none",
				overflow: "hidden",
				zIndex: 20,
			}}
		>
			<style>{`
				@keyframes klipt-click-ring {
					0% {
						width: ${startDiameter}px;
						height: ${startDiameter}px;
						opacity: 0.6;
					}
					100% {
						width: ${endDiameter}px;
						height: ${endDiameter}px;
						opacity: 0;
					}
				}
			`}</style>
			{visibleClicks.map((click) => {
				const elapsed = currentTimeMs - click.timeMs + WINDOW_MS;
				const progress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
				if (progress >= 1) return null;

				return (
					<div
						key={`${click.timeMs}-${click.x}-${click.y}`}
						style={{
							position: "absolute",
							left: `${click.x * 100}%`,
							top: `${click.y * 100}%`,
							transform: "translate(-50%, -50%)",
							width: `${startDiameter + (endDiameter - startDiameter) * progress}px`,
							height: `${startDiameter + (endDiameter - startDiameter) * progress}px`,
							borderRadius: "50%",
							border: `2px solid ${color}`,
							opacity: 0.6 * (1 - progress),
							boxSizing: "border-box",
						}}
					/>
				);
			})}
		</div>
	);
}

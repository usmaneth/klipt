import { useEffect, useRef } from "react";
import { Rnd } from "react-rnd";
import { clamp01 } from "./videoPlayback/mathUtils";

interface WebcamOverlayProps {
	videoPath: string;
	currentTime: number;
	playing: boolean;
	containerWidth: number;
	containerHeight: number;
	visible: boolean;
	shape: "circle" | "rounded-rect" | "square";
	size: number;
	opacity: number;
	borderColor: string;
	borderWidth: number;
	shadow: number;
	position: { x: number; y: number };
	onPositionChange: (pos: { x: number; y: number }) => void;
}

const SHAPE_BORDER_RADIUS: Record<WebcamOverlayProps["shape"], string> = {
	circle: "50%",
	"rounded-rect": "12px",
	square: "0",
};

export function WebcamOverlay({
	videoPath,
	currentTime,
	playing,
	containerWidth,
	containerHeight,
	visible,
	shape,
	size,
	opacity,
	borderColor,
	borderWidth,
	shadow,
	position,
	onPositionChange,
}: WebcamOverlayProps) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const lastSyncTimeRef = useRef<number>(-1);

	// Sync play/pause state
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		if (playing) {
			video.play().catch(() => {
				// Autoplay may be blocked; ignore
			});
		} else {
			video.pause();
		}
	}, [playing]);

	// Sync seek position when not playing
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		if (playing) return;

		// Avoid redundant seeks
		if (Math.abs(lastSyncTimeRef.current - currentTime) < 0.05) return;
		lastSyncTimeRef.current = currentTime;
		video.currentTime = currentTime;
	}, [currentTime, playing]);

	if (!visible) return null;

	const pixelSize = size;
	const pixelX = position.x * containerWidth - pixelSize / 2;
	const pixelY = position.y * containerHeight - pixelSize / 2;

	const borderRadius = SHAPE_BORDER_RADIUS[shape];

	const videoSrc = videoPath.startsWith("file://") ? videoPath : `file://${videoPath}`;

	return (
		<Rnd
			position={{ x: pixelX, y: pixelY }}
			size={{ width: pixelSize, height: pixelSize }}
			enableResizing={false}
			bounds="parent"
			onDragStop={(_e, d) => {
				const normX = clamp01((d.x + pixelSize / 2) / containerWidth);
				const normY = clamp01((d.y + pixelSize / 2) / containerHeight);
				onPositionChange({ x: normX, y: normY });
			}}
			style={{
				zIndex: 50,
				cursor: "move",
			}}
		>
			<div
				style={{
					width: "100%",
					height: "100%",
					borderRadius,
					overflow: "hidden",
					opacity,
					border: `${borderWidth}px solid ${borderColor}`,
					boxShadow:
						shadow > 0
							? `0 ${shadow * 2}px ${shadow * 4}px rgba(0, 0, 0, ${shadow * 0.15})`
							: "none",
					pointerEvents: "auto",
				}}
			>
				<video
					ref={videoRef}
					src={videoSrc}
					muted
					playsInline
					style={{
						width: "100%",
						height: "100%",
						objectFit: "cover",
						borderRadius,
						display: "block",
					}}
				/>
			</div>
		</Rnd>
	);
}

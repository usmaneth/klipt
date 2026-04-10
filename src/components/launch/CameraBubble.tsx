import { useEffect, useRef, useState } from "react";

type Shape = "circle" | "rounded-square" | "square";

const shapeRadius: Record<Shape, string> = {
	circle: "50%",
	"rounded-square": "16px",
	square: "4px",
};

export default function CameraBubble() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [cameraSize, setCameraSize] = useState(120);
	const [shape, setShape] = useState<Shape>(() => {
		const params = new URLSearchParams(window.location.search);
		return (params.get("webcamShape") as Shape) || "circle";
	});
	const [mirrored, setMirrored] = useState(true);
	const [showControls, setShowControls] = useState(false);

	useEffect(() => {
		let stream: MediaStream | null = null;
		let cancelled = false;

		const startCamera = async () => {
			try {
				// Use the specific device ID from the URL query if available,
				// so we don't contend with the webcam recorder's stream.
				const params = new URLSearchParams(window.location.search);
				const deviceId = params.get("cameraDeviceId");
				const videoConstraints = deviceId
					? { deviceId: { exact: deviceId }, width: 400, height: 400 }
					: { facingMode: "user" as const, width: 400, height: 400 };

				stream = await navigator.mediaDevices.getUserMedia({
					video: videoConstraints,
					audio: false,
				});
				if (!cancelled && videoRef.current) {
					videoRef.current.srcObject = stream;
				} else if (cancelled && stream) {
					stream.getTracks().forEach((t) => t.stop());
				}
			} catch (err) {
				console.error("Camera bubble: failed to get stream", err);
			}
		};

		void startCamera();

		return () => {
			cancelled = true;
			if (stream) {
				stream.getTracks().forEach((t) => t.stop());
			}
		};
	}, []);

	const handleResize = (size: number) => {
		setCameraSize(size);
		window.electronAPI.resizeCameraBubble(size);
	};

	const borderRadius = shapeRadius[shape];

	return (
		<div
			style={{ position: "relative", width: "100%", height: "100%" }}
			onMouseEnter={() => setShowControls(true)}
			onMouseLeave={() => setShowControls(false)}
		>
			{/* Outer ring — gradient border */}
			<div
				style={{
					width: "100%",
					height: "100%",
					borderRadius,
					padding: 2,
					background: "linear-gradient(135deg, #E0000F, #FF4500)",
					boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
					transition: "border-radius 200ms ease",
					// @ts-expect-error Electron-specific CSS property for window dragging
					WebkitAppRegion: "drag",
				}}
			>
				{/* Inner container */}
				<div
					style={{
						width: "100%",
						height: "100%",
						borderRadius: `calc(${borderRadius} - 1px)`,
						overflow: "hidden",
						background: "#000",
						transition: "border-radius 200ms ease",
					}}
				>
					<video
						ref={videoRef}
						autoPlay
						muted
						playsInline
						style={{
							width: "100%",
							height: "100%",
							objectFit: "cover",
							transform: mirrored ? "scaleX(-1)" : "scaleX(1)",
						}}
					/>
				</div>
			</div>

			{/* ── Close button (top-right) ── */}
			<button
				onClick={() => window.electronAPI.closeCameraBubble()}
				style={{
					position: "absolute",
					top: -4,
					right: -4,
					width: 18,
					height: 18,
					borderRadius: "50%",
					background: "rgba(0,0,0,0.7)",
					border: "1px solid rgba(255,255,255,0.1)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					cursor: "pointer",
					padding: 0,
					opacity: showControls ? 1 : 0,
					transition: "opacity 200ms ease",
					pointerEvents: showControls ? "auto" : "none",
					// @ts-expect-error Electron-specific CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				<svg
					width={8}
					height={8}
					viewBox="0 0 8 8"
					fill="none"
					stroke="rgba(255,255,255,0.5)"
					strokeWidth={1.5}
					strokeLinecap="round"
				>
					<line x1="1" y1="1" x2="7" y2="7" />
					<line x1="7" y1="1" x2="1" y2="7" />
				</svg>
			</button>

			{/* ── Size slider (below bubble) ── */}
			<div
				style={{
					position: "absolute",
					bottom: -32,
					left: "50%",
					transform: "translateX(-50%)",
					background: "rgba(0,0,0,0.8)",
					backdropFilter: "blur(12px)",
					WebkitBackdropFilter: "blur(12px)",
					borderRadius: 8,
					padding: "3px 10px",
					display: "flex",
					alignItems: "center",
					gap: 4,
					opacity: showControls ? 1 : 0,
					transition: "opacity 200ms ease",
					pointerEvents: showControls ? "auto" : "none",
					// @ts-expect-error Electron-specific CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				<span style={{ fontSize: 7, color: "rgba(255,255,255,0.2)" }}>
					S
				</span>
				<input
					type="range"
					min={60}
					max={300}
					value={cameraSize}
					onChange={(e) => handleResize(Number(e.target.value))}
					style={{ width: 60, accentColor: "#E0000F" }}
				/>
				<span style={{ fontSize: 7, color: "rgba(255,255,255,0.2)" }}>
					L
				</span>
			</div>

			{/* ── Shape buttons (right side) ── */}
			<div
				style={{
					position: "absolute",
					right: -32,
					top: "50%",
					transform: "translateY(-50%)",
					background: "rgba(0,0,0,0.8)",
					backdropFilter: "blur(12px)",
					WebkitBackdropFilter: "blur(12px)",
					borderRadius: 8,
					padding: 4,
					display: "flex",
					flexDirection: "column",
					gap: 3,
					opacity: showControls ? 1 : 0,
					transition: "opacity 200ms ease",
					pointerEvents: showControls ? "auto" : "none",
					// @ts-expect-error Electron-specific CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				{(
					[
						{ key: "circle" as const, label: "\u25CF" },
						{ key: "rounded-square" as const, label: "\u25A2" },
						{ key: "square" as const, label: "\u25A0" },
					] as const
				).map((s) => (
					<button
						key={s.key}
						onClick={() => setShape(s.key)}
						style={{
							width: 20,
							height: 20,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							fontSize: 10,
							color: "rgba(255,255,255,0.7)",
							background:
								shape === s.key
									? "rgba(224,0,15,0.15)"
									: "transparent",
							border:
								shape === s.key
									? "1px solid rgba(224,0,15,0.3)"
									: "1px solid transparent",
							borderRadius: 4,
							cursor: "pointer",
							padding: 0,
						}}
					>
						{s.label}
					</button>
				))}
			</div>

			{/* ── Mirror / flip toggle (left side) ── */}
			<button
				onClick={() => setMirrored((prev) => !prev)}
				style={{
					position: "absolute",
					left: -28,
					top: "50%",
					transform: "translateY(-50%)",
					width: 20,
					height: 20,
					background: "rgba(0,0,0,0.8)",
					backdropFilter: "blur(12px)",
					WebkitBackdropFilter: "blur(12px)",
					borderRadius: 4,
					border: "none",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					cursor: "pointer",
					padding: 0,
					opacity: showControls ? 1 : 0,
					transition: "opacity 200ms ease",
					pointerEvents: showControls ? "auto" : "none",
					// @ts-expect-error Electron-specific CSS property
					WebkitAppRegion: "no-drag",
				}}
			>
				<svg
					width={12}
					height={12}
					viewBox="0 0 12 12"
					fill="none"
					stroke="rgba(255,255,255,0.6)"
					strokeWidth={1.2}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{/* Left arrow */}
					<polyline points="4,3 1,6 4,9" />
					<line x1="1" y1="6" x2="5" y2="6" />
					{/* Right arrow */}
					<polyline points="8,3 11,6 8,9" />
					<line x1="11" y1="6" x2="7" y2="6" />
				</svg>
			</button>
		</div>
	);
}

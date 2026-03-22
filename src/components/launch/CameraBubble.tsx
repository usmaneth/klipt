import { useEffect, useRef } from "react";

export default function CameraBubble() {
	const videoRef = useRef<HTMLVideoElement>(null);

	useEffect(() => {
		let stream: MediaStream | null = null;

		const startCamera = async () => {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: { facingMode: "user", width: 400, height: 400 },
					audio: false,
				});
				if (videoRef.current) {
					videoRef.current.srcObject = stream;
				}
			} catch (err) {
				console.error("Camera bubble: failed to get stream", err);
			}
		};

		void startCamera();

		return () => {
			if (stream) {
				stream.getTracks().forEach((t) => t.stop());
			}
		};
	}, []);

	return (
		<div
			style={{
				width: "100%",
				height: "100%",
				borderRadius: "50%",
				overflow: "hidden",
				background: "transparent",
				boxShadow: "0 12px 40px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.3)",
				border: "2px solid rgba(255,255,255,0.15)",
				// @ts-expect-error Electron-specific CSS property for window dragging
				WebkitAppRegion: "drag",
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
					transform: "scaleX(-1)",
				}}
			/>
		</div>
	);
}

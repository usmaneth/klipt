import { ChevronsLeft, ChevronsRight, Pause, Play } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { useScopedT } from "@/contexts/I18nContext";

interface PlaybackControlsProps {
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	onTogglePlayPause: () => void;
	onSeek: (time: number) => void;
}

const PlaybackControls = memo(function PlaybackControls({
	isPlaying,
	currentTime,
	duration,
	onTogglePlayPause,
	onSeek,
}: PlaybackControlsProps) {
	const t = useScopedT("editor");
	const [isScrubbing, setIsScrubbing] = useState(false);
	const [scrubSpeed, setScrubSpeed] = useState(0);
	const lastValueRef = useRef<number>(0);
	const speedDecayRef = useRef<number>(0);

	function formatTime(seconds: number) {
		if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "0:00";
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}

	function formatRemaining(current: number, total: number) {
		const remaining = Math.max(0, total - current);
		return `-${formatTime(remaining)}`;
	}

	function handleScrubInput(e: React.FormEvent<HTMLInputElement>) {
		const target = e.target as HTMLInputElement;
		const newValue = parseFloat(target.value);
		onSeek(newValue);

		// Calculate speed from value delta (works regardless of event type)
		if (isScrubbing && duration > 0) {
			const delta = Math.abs(newValue - lastValueRef.current);
			const normalizedDelta = delta / duration; // 0-1 range based on video length
			const speed = Math.min(normalizedDelta * 50, 1); // Scale up for visibility
			setScrubSpeed(Math.max(speed, scrubSpeed * 0.8)); // Smooth decay
		}
		lastValueRef.current = newValue;
	}

	function handleScrubStart() {
		setIsScrubbing(true);
		lastValueRef.current = currentTime;
		// Start decay animation
		const decay = () => {
			setScrubSpeed((prev) => {
				if (prev < 0.01) return 0;
				return prev * 0.92;
			});
			speedDecayRef.current = requestAnimationFrame(decay);
		};
		speedDecayRef.current = requestAnimationFrame(decay);
	}

	function handleScrubEnd() {
		setIsScrubbing(false);
		setScrubSpeed(0);
		cancelAnimationFrame(speedDecayRef.current);
	}

	const handleSkipBack = useCallback(() => {
		onSeek(Math.max(0, currentTime - 5));
	}, [onSeek, currentTime]);

	const handleSkipForward = useCallback(() => {
		onSeek(Math.min(duration, currentTime + 5));
	}, [onSeek, currentTime, duration]);

	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

	const rippleSize = 150 + scrubSpeed * 250;
	const rippleOpacity = 0.4 + scrubSpeed * 0.6;
	const rippleBlur = 40 + scrubSpeed * 80;

	return (
		<div className="flex flex-col items-center gap-0 w-full max-w-md mx-auto px-4">
			{/* Scrubber */}
			<div className="relative w-full h-6 flex items-center group cursor-pointer">
				{/* Track */}
				<div className="absolute left-0 right-0 h-1 bg-white/[0.06] rounded-full overflow-hidden">
					<div
						className="h-full rounded-full"
						style={{
							width: `${progress}%`,
							background: "linear-gradient(90deg, #E0000F, #FF4500)",
						}}
					/>
				</div>

				{/* Interactive Input */}
				<input
					type="range"
					onMouseDown={handleScrubStart}
					onMouseUp={handleScrubEnd}
					onTouchStart={handleScrubStart}
					onTouchEnd={handleScrubEnd}
					min="0"
					max={duration || 100}
					value={currentTime}
					onInput={handleScrubInput}
					step="0.01"
					className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
				/>

				{/* Time-Warp Scrubbing Ripple Effect */}
				<div
					className="absolute pointer-events-none transition-[opacity,transform] duration-200 z-0 rounded-full"
					style={{
						width: rippleSize,
						height: rippleSize,
						left: `${progress}%`,
						top: "50%",
						transform: `translate(-50%, -50%) scale(${isScrubbing ? 1 + scrubSpeed * 0.5 : 0})`,
						opacity: isScrubbing ? 1 : 0,
						background: `radial-gradient(circle, rgba(224,0,15,${rippleOpacity}) 0%, rgba(255,69,0,${rippleOpacity * 0.6}) 40%, transparent 70%)`,
						boxShadow: isScrubbing ? `0 0 ${rippleBlur}px rgba(224,0,15,${0.4 + scrubSpeed * 0.6}), 0 0 ${rippleBlur * 2}px rgba(255,69,0,${0.15 + scrubSpeed * 0.3})` : "none",
					}}
				/>

				{/* Thumb */}
				<div
					className={`absolute pointer-events-none transition-opacity duration-150 ${isScrubbing ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
					style={{
						width: isScrubbing ? 24 : 14,
						height: isScrubbing ? 24 : 14,
						transition: "width 0.2s, height 0.2s, opacity 0.15s",
						borderRadius: "50%",
						backgroundColor: "#fff",
						boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
						border: "1px solid rgba(0,0,0,0.1)",
						left: `${progress}%`,
						transform: "translate(-50%, 0)",
					}}
				/>
			</div>

			{/* Controls row */}
			<div className="flex items-center justify-between w-full mt-2">
				{/* Elapsed time */}
				<span className="font-mono text-white/35 text-[14px] tabular-nums w-[50px]">
					{formatTime(currentTime)}
				</span>

				{/* Center controls */}
				<div className="flex items-center gap-4">
					<button
						type="button"
						onClick={handleSkipBack}
						className="text-white/35 hover:text-white/60 transition-colors cursor-pointer"
						aria-label="Skip back"
					>
						<ChevronsLeft className="w-6 h-6" />
					</button>

					<button
						type="button"
						onClick={onTogglePlayPause}
						className="flex items-center justify-center rounded-full transition-all duration-150 cursor-pointer"
						style={{
							width: 56,
							height: 56,
							background: "rgba(224,0,15,0.08)",
							border: isPlaying
								? "2px solid rgba(224,0,15,0.4)"
								: "2px solid rgba(224,0,15,0.25)",
							boxShadow: isPlaying
								? "0 0 32px rgba(224,0,15,0.2)"
								: "0 0 24px rgba(224,0,15,0.12)",
						}}
						aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
					>
						{isPlaying ? (
							<Pause className="w-6 h-6 text-white fill-current" />
						) : (
							<Play className="w-6 h-6 text-white fill-current ml-0.5" />
						)}
					</button>

					<button
						type="button"
						onClick={handleSkipForward}
						className="text-white/35 hover:text-white/60 transition-colors cursor-pointer"
						aria-label="Skip forward"
					>
						<ChevronsRight className="w-6 h-6" />
					</button>
				</div>

				{/* Remaining time */}
				<span className="font-mono text-white/15 text-[14px] tabular-nums w-[50px] text-right">
					{formatRemaining(currentTime, duration)}
				</span>
			</div>
		</div>
	);
});

export default PlaybackControls;

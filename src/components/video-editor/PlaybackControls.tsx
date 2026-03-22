import { Pause, Play } from "lucide-react";
import { memo } from "react";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

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
	function formatTime(seconds: number) {
		if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "0:00";
		const mins = Math.floor(seconds / 60);
		const secs = Math.floor(seconds % 60);
		return `${mins}:${secs.toString().padStart(2, "0")}`;
	}

	function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
		onSeek(parseFloat(e.target.value));
	}

	const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

	return (
		<div className="flex items-center gap-6 px-6 py-3 rounded-full bg-white/[0.05] backdrop-blur-[120px] border border-white/[0.1] shadow-[0_20px_80px_rgba(0,0,0,0.8),inset_0_2px_4px_rgba(255,255,255,0.1)] transition-all duration-500 hover:bg-white/[0.08] hover:border-white/[0.2] w-full max-w-2xl mx-auto hover:shadow-[0_30px_100px_rgba(0,0,0,0.9),inset_0_2px_4px_rgba(255,255,255,0.15)]">
			<Button
				onClick={onTogglePlayPause}
				size="icon"
				className={cn(
					"w-12 h-12 rounded-full transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] border border-white/20 flex-shrink-0 flex items-center justify-center backdrop-blur-md shadow-2xl",
					isPlaying
						? "bg-white/10 text-white hover:bg-white/20 hover:scale-105 hover:border-white/30"
						: "bg-white text-black hover:scale-110 border-transparent hover:shadow-[0_0_40px_rgba(255,255,255,0.6)]",
				)}
				aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
			>
				{isPlaying ? (
					<Pause className="w-5 h-5 fill-current" />
				) : (
					<Play className="w-5 h-5 fill-current ml-1" />
				)}
			</Button>

			<span className="text-[13px] font-mono font-semibold text-white tabular-nums w-[40px] text-right tracking-tight drop-shadow-md">
				{formatTime(currentTime)}
			</span>

			<div className="flex-1 relative h-8 flex items-center group cursor-pointer">
				{/* Custom Track Background */}
				<div className="absolute left-0 right-0 h-2 bg-black/50 shadow-[inset_0_2px_4px_rgba(0,0,0,0.8)] rounded-full overflow-hidden border border-white/[0.05]">
					<div
						className="h-full rounded-full bg-gradient-to-r from-white/80 to-white shadow-[0_0_12px_rgba(255,255,255,0.8)] relative"
						style={{ width: `${progress}%` }}
					>
						<div className="absolute top-0 right-0 bottom-0 w-8 bg-gradient-to-r from-transparent to-white/50 blur-[2px]" />
					</div>
				</div>

				{/* Interactive Input */}
				<input
					type="range"
					min="0"
					max={duration || 100}
					value={currentTime}
					onChange={handleSeekChange}
					step="0.01"
					className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
				/>

				{/* Custom Thumb (visual only, follows progress) */}
				<div
					className="absolute w-4 h-4 bg-white rounded-full shadow-[0_0_16px_rgba(255,255,255,1),inset_0_-1px_2px_rgba(0,0,0,0.2)] pointer-events-none transition-transform duration-300 ease-out flex items-center justify-center scale-95 group-hover:scale-125"
					style={{
						left: `${progress}%`,
						transform: "translate(-50%, 0)",
					}}
				>
					<div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
				</div>
			</div>

			<span className="text-[13px] font-mono font-medium text-white/50 tabular-nums w-[40px] tracking-tight">
				{formatTime(duration)}
			</span>
		</div>
	);
});

export default PlaybackControls;

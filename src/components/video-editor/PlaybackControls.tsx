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
		<div className="flex items-center gap-4 px-3 py-1.5 rounded-[16px] bg-[#0A0D15]/80 backdrop-blur-2xl border border-white/10 shadow-[0_10px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)] transition-all duration-300 hover:bg-[#0A0D15]/90 hover:border-white/20 w-full max-w-xl mx-auto">
			<Button
				onClick={onTogglePlayPause}
				size="icon"
				className={cn(
					"w-12 h-12 rounded-full transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] border border-white/10 flex-shrink-0",
					isPlaying
						? "bg-white/10 text-white hover:bg-white/20 shadow-[0_0_15px_rgba(59,130,246,0.3)] hover:scale-105"
						: "bg-gradient-to-tr from-blue-600 to-cyan-400 text-white hover:scale-110 shadow-[0_0_20px_rgba(34,211,238,0.5)] border-none",
				)}
				aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
			>
				{isPlaying ? (
					<Pause className="w-5 h-5 fill-current" />
				) : (
					<Play className="w-5 h-5 fill-current ml-1" />
				)}
			</Button>

			<span className="text-xs font-mono font-medium text-cyan-300 drop-shadow-[0_0_5px_rgba(34,211,238,0.5)] tabular-nums w-[40px] text-right tracking-wider">
				{formatTime(currentTime)}
			</span>

			<div className="flex-1 relative h-8 flex items-center group cursor-pointer">
				{/* Custom Track Background */}
				<div className="absolute left-0 right-0 h-1.5 bg-black/40 shadow-[inset_0_1px_3px_rgba(0,0,0,0.5)] rounded-full overflow-hidden border border-white/5">
					<div 
						className="h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400 relative" 
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
					className="absolute w-4 h-4 bg-white rounded-full shadow-[0_0_12px_rgba(34,211,238,0.8),inset_0_-1px_2px_rgba(0,0,0,0.2)] pointer-events-none transition-transform duration-200 ease-out flex items-center justify-center scale-90 group-hover:scale-110"
					style={{
						left: `${progress}%`,
						transform: "translate(-50%, 0)",
					}}
				>
					<div className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-pulse" />
				</div>
			</div>

			<span className="text-xs font-mono font-medium text-slate-500 tabular-nums w-[40px] tracking-wider">
				{formatTime(duration)}
			</span>
		</div>
	);
});

export default PlaybackControls;

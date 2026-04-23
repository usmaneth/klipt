import { motion, AnimatePresence } from "framer-motion";
import { Film, Loader2, Scissors, Sparkles, Download } from "lucide-react";
import { useState } from "react";
import type { HighlightCandidate } from "@/lib/ai/highlightDetector";

function formatMs(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(ms: number): string {
	const totalSec = Math.round(ms / 1000);
	if (totalSec < 60) return `${totalSec}s`;
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}m ${s}s`;
}

function scoreColor(score: number): string {
	if (score >= 75) return "#30D158"; // green
	if (score >= 50) return "#FF9500"; // orange
	return "#FF375F"; // red
}

interface HighlightPanelProps {
	highlights: HighlightCandidate[];
	isDetecting: boolean;
	hasTranscription: boolean;
	onDetectHighlights: () => void;
	onSeek: (timeMs: number) => void;
	onExportClip: (highlight: HighlightCandidate) => void;
	onExportAll: (highlights: HighlightCandidate[]) => void;
}

export function HighlightPanel({
	highlights,
	isDetecting,
	hasTranscription,
	onDetectHighlights,
	onSeek,
	onExportClip,
	onExportAll,
}: HighlightPanelProps) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	return (
		<div className="flex flex-col gap-2 h-full">
			{/* Header */}
			<div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
				<Film className="w-3.5 h-3.5 text-white/40" />
				<span className="text-[11px] font-medium text-white/50">
					{highlights.length} highlight{highlights.length !== 1 ? "s" : ""} found
				</span>
			</div>

			{/* Detect button */}
			<button
				type="button"
				onClick={onDetectHighlights}
				disabled={isDetecting || !hasTranscription}
				className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-[12px] font-medium text-white/70 hover:text-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
			>
				{isDetecting ? (
					<>
						<Loader2 className="w-3.5 h-3.5 animate-spin" />
						<span>Analyzing...</span>
					</>
				) : (
					<>
						<Sparkles className="w-3.5 h-3.5" />
						<span>Find Highlights</span>
					</>
				)}
			</button>

			{!hasTranscription && !isDetecting && (
				<p className="text-[10px] text-white/25 text-center px-2">
					Generate captions first to enable highlight detection.
				</p>
			)}

			{/* Highlight list */}
			<div className="flex-1 overflow-y-auto flex flex-col gap-2">
				{highlights.length === 0 && !isDetecting && hasTranscription && (
					<p className="text-[11px] text-white/30 text-center py-4">
						Click &quot;Find Highlights&quot; to detect engaging segments for
						TikTok, Reels, or Shorts.
					</p>
				)}

				<AnimatePresence>
					{highlights.map((highlight, index) => (
						<motion.div
							key={highlight.id}
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -8 }}
							transition={{ duration: 0.2, delay: index * 0.04 }}
							onClick={() => onSeek(highlight.startMs)}
							onMouseEnter={() => setHoveredId(highlight.id)}
							onMouseLeave={() => setHoveredId(null)}
							className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 cursor-pointer hover:bg-white/[0.06] transition-colors group"
						>
							{/* Top row: score badge + time range */}
							<div className="flex items-center gap-2 mb-1.5">
								<div
									className="flex items-center justify-center min-w-[32px] h-5 rounded-full px-1.5 text-[10px] font-bold"
									style={{
										backgroundColor: `${scoreColor(highlight.score)}20`,
										color: scoreColor(highlight.score),
									}}
								>
									{highlight.score}
								</div>
								<span className="text-[11px] text-white/50 tabular-nums">
									{formatMs(highlight.startMs)} – {formatMs(highlight.endMs)}
								</span>
								<span className="text-[10px] text-white/25 ml-auto">
									{formatDuration(highlight.endMs - highlight.startMs)}
								</span>
							</div>

							{/* Title (when AI-generated) + reason text */}
							{highlight.title && (
								<p className="text-[12px] font-semibold text-white/85 leading-tight mb-1">
									{highlight.title}
								</p>
							)}
							<p className="text-[11px] text-white/40 leading-relaxed">
								{highlight.reason}
							</p>
							{highlight.source === "gemini" && (
								<span className="inline-block mt-1.5 px-1.5 py-[1px] rounded-full bg-violet-500/15 text-violet-300/80 text-[9px] font-medium uppercase tracking-wider">
									AI
								</span>
							)}

							{/* Export button (visible on hover) */}
							<div
								className={`flex items-center gap-1.5 mt-2 transition-opacity duration-150 ${
									hoveredId === highlight.id ? "opacity-100" : "opacity-0"
								}`}
							>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										onExportClip(highlight);
									}}
									className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[10px] text-white/50 hover:text-white/80 transition-colors cursor-pointer"
								>
									<Scissors className="w-3 h-3" />
									Export as Clip
								</button>
							</div>
						</motion.div>
					))}
				</AnimatePresence>
			</div>

			{/* Export All button */}
			{highlights.length > 1 && (
				<div className="pt-2 border-t border-white/[0.04]">
					<button
						type="button"
						onClick={() => onExportAll(highlights)}
						className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] text-[11px] font-medium text-white/50 hover:text-white/70 transition-all cursor-pointer"
					>
						<Download className="w-3 h-3" />
						Export All Highlights ({highlights.length})
					</button>
				</div>
			)}
		</div>
	);
}

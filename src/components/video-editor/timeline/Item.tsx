import type { Span } from "dnd-timeline";
import { useItem } from "dnd-timeline";
import { ArrowRightLeft, Gauge, MessageSquare, Music, Scissors, Volume2, ZoomIn } from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import glassStyles from "./ItemGlass.module.css";

interface ItemProps {
	id: string;
	span: Span;
	rowId: string;
	children: React.ReactNode;
	isSelected?: boolean;
	onSelect?: () => void;
	zoomDepth?: number;
	speedValue?: number;
	variant?: "zoom" | "trim" | "annotation" | "speed" | "audio" | "sfx" | "transition";
}

// Map zoom depth to multiplier labels
const ZOOM_LABELS: Record<number, string> = {
	1: "1.25×",
	2: "1.5×",
	3: "1.8×",
	4: "2.2×",
	5: "3.5×",
	6: "5×",
};

function formatMs(ms: number): string {
	const totalSeconds = ms / 1000;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes > 0) {
		return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
	}
	return `${seconds.toFixed(1)}s`;
}

export default function Item({
	id,
	span,
	rowId,
	isSelected = false,
	onSelect,
	zoomDepth = 1,
	speedValue,
	variant = "zoom",
	children,
}: ItemProps) {
	const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
		id,
		span,
		data: { rowId },
	});

	const isZoom = variant === "zoom";
	const isTrim = variant === "trim";
	const isSpeed = variant === "speed";
	const isAudio = variant === "audio";
	const isSfx = variant === "sfx";
	const isTransition = variant === "transition";

	const glassClass = isZoom
		? glassStyles.glassGreen
		: isTrim
			? glassStyles.glassRed
			: isSpeed
				? glassStyles.glassAmber
				: isAudio
					? glassStyles.glassPurple
					: isSfx
						? glassStyles.glassCyan
						: isTransition
							? glassStyles.glassBlue
							: glassStyles.glassYellow;

	const timeLabel = useMemo(
		() => `${formatMs(span.start)} – ${formatMs(span.end)}`,
		[span.start, span.end],
	);

	const MIN_ITEM_PX = 6;
	const safeItemStyle = { ...itemStyle, minWidth: MIN_ITEM_PX };

	return (
		<div
			ref={setNodeRef}
			style={safeItemStyle}
			{...listeners}
			{...attributes}
			onPointerDownCapture={() => onSelect?.()}
			className="group"
		>
			<div style={{ ...itemContentStyle, minWidth: 24 }}>
				<div
					className={cn(
						glassClass,
						"w-full h-full overflow-hidden flex items-center justify-center gap-1.5 cursor-grab active:cursor-grabbing relative",
						isSelected && glassStyles.selected,
					)}
					style={{ height: 28, color: "#fff", minWidth: 24 }}
					onClick={(event) => {
						event.stopPropagation();
						onSelect?.();
					}}
				>
					<div
						className={cn(glassStyles.zoomEndCap, glassStyles.left)}
						style={{
							cursor: "col-resize",
							pointerEvents: "auto",
							width: 4,
						}}
						title="Resize left"
					/>
					<div
						className={cn(glassStyles.zoomEndCap, glassStyles.right)}
						style={{
							cursor: "col-resize",
							pointerEvents: "auto",
							width: 4,
						}}
						title="Resize right"
					/>
					{/* Content */}
					<div className="relative z-10 flex flex-col items-center justify-center opacity-80 group-hover:opacity-100 transition-opacity select-none overflow-hidden">
						<div className="flex items-center gap-1">
							{isZoom ? (
								<>
									<ZoomIn className="w-3 h-3 shrink-0 text-blue-500/50" />
									<span className="text-[8px] font-mono tracking-tight whitespace-nowrap text-blue-500/50">
										{ZOOM_LABELS[zoomDepth] || `${zoomDepth}×`}
									</span>
								</>
							) : isTrim ? (
								<>
									<Scissors className="w-3 h-3 shrink-0 text-red-500/50" />
									<span className="text-[8px] font-mono tracking-tight whitespace-nowrap text-red-500/50">
										Trim
									</span>
								</>
							) : isSpeed ? (
								<>
									<Gauge className="w-3 h-3 shrink-0 text-orange-500/50" />
									<span className="text-[8px] font-mono tracking-tight whitespace-nowrap text-orange-500/50">
										{speedValue !== undefined ? `${speedValue}×` : "Speed"}
									</span>
								</>
							) : isAudio ? (
								<>
									<Music className="w-3 h-3 shrink-0 text-purple-500/50" />
									<span className="text-[8px] font-mono tracking-tight truncate max-w-full text-purple-500/50">
										{children}
									</span>
								</>
							) : isSfx ? (
								<>
									<Volume2 className="w-3 h-3 shrink-0 text-cyan-500/50" />
									<span className="text-[8px] font-mono tracking-tight truncate max-w-full text-cyan-500/50">
										{children}
									</span>
								</>
							) : isTransition ? (
								<>
									<ArrowRightLeft className="w-3 h-3 shrink-0 text-blue-400/50" />
									<span className="text-[8px] font-mono tracking-tight truncate max-w-full text-blue-400/50">
										{children}
									</span>
								</>
							) : (
								<>
									<MessageSquare className="w-3 h-3 shrink-0 text-yellow-500/50" />
									<span className="text-[8px] font-mono tracking-tight whitespace-nowrap text-yellow-500/50">
										{children}
									</span>
								</>
							)}
						</div>
						<span
							className={`text-[7px] font-mono tabular-nums tracking-tight whitespace-nowrap transition-opacity text-white/30 ${
								isSelected ? "opacity-60" : "opacity-0 group-hover:opacity-40"
							}`}
						>
							{timeLabel}
						</span>
					</div>
				</div>
			</div>
		</div>
	);
}

import { AnimatePresence, motion } from "framer-motion";
import {
	ArrowUpRight,
	Circle,
	Eraser,
	Highlighter,
	Pencil,
	Square,
	Type,
	Undo2,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type {
	LiveAnnotationFadeOption,
	LiveAnnotationTool,
} from "../video-editor/types";
import {
	LIVE_ANNOTATION_FADE_OPTIONS,
	LIVE_ANNOTATION_PRESET_COLORS,
} from "../video-editor/types";

interface LiveAnnotationToolbarProps {
	isVisible: boolean;
	activeTool: LiveAnnotationTool;
	onToolChange: (tool: LiveAnnotationTool) => void;
	color: string;
	onColorChange: (color: string) => void;
	strokeWidth: number;
	onStrokeWidthChange: (width: number) => void;
	fadeDuration: LiveAnnotationFadeOption;
	onFadeDurationChange: (duration: LiveAnnotationFadeOption) => void;
	onUndo: () => void;
	onClear: () => void;
	canUndo: boolean;
}

const TOOLS: Array<{ value: LiveAnnotationTool; label: string; icon: React.ReactNode }> = [
	{ value: "pen", label: "Pen", icon: <Pencil className="w-3.5 h-3.5" /> },
	{ value: "arrow", label: "Arrow", icon: <ArrowUpRight className="w-3.5 h-3.5" /> },
	{ value: "rect", label: "Rectangle", icon: <Square className="w-3.5 h-3.5" /> },
	{ value: "circle", label: "Circle", icon: <Circle className="w-3.5 h-3.5" /> },
	{ value: "text", label: "Text", icon: <Type className="w-3.5 h-3.5" /> },
	{ value: "highlight", label: "Highlight", icon: <Highlighter className="w-3.5 h-3.5" /> },
];

export function LiveAnnotationToolbar({
	isVisible,
	activeTool,
	onToolChange,
	color,
	onColorChange,
	strokeWidth,
	onStrokeWidthChange,
	fadeDuration,
	onFadeDurationChange,
	onUndo,
	onClear,
	canUndo,
}: LiveAnnotationToolbarProps) {
	const [isDragging, setIsDragging] = useState(false);
	const [showColorPicker, setShowColorPicker] = useState(false);
	const toolbarRef = useRef<HTMLDivElement>(null);
	const dragStartRef = useRef({ x: 0, y: 0 });
	const posRef = useRef({ x: 0, y: 0 });
	const [pos, setPos] = useState({ x: 0, y: 0 });

	const handleDragMove = useCallback((e: MouseEvent) => {
		const newX = e.clientX - dragStartRef.current.x;
		const newY = e.clientY - dragStartRef.current.y;
		posRef.current = { x: newX, y: newY };
		setPos({ x: newX, y: newY });
	}, []);

	const handleDragEnd = useCallback(() => {
		setIsDragging(false);
		window.removeEventListener("mousemove", handleDragMove);
		window.removeEventListener("mouseup", handleDragEnd);
	}, [handleDragMove]);

	const handleDragStart = useCallback((e: React.MouseEvent) => {
		if ((e.target as HTMLElement).closest("button, input")) return;
		setIsDragging(true);
		dragStartRef.current = { x: e.clientX - posRef.current.x, y: e.clientY - posRef.current.y };
		window.addEventListener("mousemove", handleDragMove);
		window.addEventListener("mouseup", handleDragEnd);
	}, [handleDragMove, handleDragEnd]);

	return (
		<AnimatePresence>
			{isVisible && (
				<motion.div
					ref={toolbarRef}
					initial={{ opacity: 0, y: 20, scale: 0.95 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					exit={{ opacity: 0, y: 20, scale: 0.95 }}
					transition={{ duration: 0.2, ease: "easeOut" }}
					className="fixed bottom-6 left-1/2 z-[200] select-none"
					style={{
						transform: `translate(calc(-50% + ${pos.x}px), ${pos.y}px)`,
						cursor: isDragging ? "grabbing" : "grab",
					}}
					onMouseDown={handleDragStart}
				>
					<div className="flex items-center gap-1 px-2 py-1.5 bg-black/80 backdrop-blur-xl rounded-full border border-white/10 shadow-[0_4px_30px_rgba(0,0,0,0.5)]">
						{/* Tool buttons */}
						{TOOLS.map(({ value, label, icon }) => (
							<button
								key={value}
								type="button"
								title={label}
								onClick={() => onToolChange(value)}
								className={`p-1.5 rounded-full transition-all duration-100 ${
									activeTool === value
										? "bg-white/20 text-white"
										: "text-white/50 hover:text-white/80 hover:bg-white/10"
								}`}
							>
								{icon}
							</button>
						))}

						{/* Separator */}
						<div className="w-px h-5 bg-white/10 mx-0.5" />

						{/* Color swatches */}
						<div className="flex items-center gap-0.5 relative">
							{LIVE_ANNOTATION_PRESET_COLORS.slice(0, 6).map((c) => (
								<button
									key={c}
									type="button"
									onClick={() => onColorChange(c)}
									className={`w-4 h-4 rounded-full transition-all duration-100 ${
										color === c ? "ring-2 ring-white ring-offset-1 ring-offset-black/80 scale-110" : "hover:scale-110"
									}`}
									style={{ backgroundColor: c }}
								/>
							))}
							<button
								type="button"
								onClick={() => setShowColorPicker(!showColorPicker)}
								className="w-4 h-4 rounded-full border border-white/30 bg-gradient-to-br from-red-500 via-green-500 to-blue-500 hover:scale-110 transition-transform"
								title="Custom color"
							/>
							{showColorPicker && (
								<div className="absolute bottom-full mb-2 left-0 p-2 bg-black/90 border border-white/10 rounded-lg">
									<input
										type="color"
										value={color}
										onChange={(e) => onColorChange(e.target.value)}
										className="w-8 h-8 cursor-pointer bg-transparent border-0"
									/>
								</div>
							)}
						</div>

						{/* Separator */}
						<div className="w-px h-5 bg-white/10 mx-0.5" />

						{/* Stroke width slider */}
						<div className="flex items-center gap-1 px-1">
							<input
								type="range"
								min={1}
								max={10}
								step={1}
								value={strokeWidth}
								onChange={(e) => onStrokeWidthChange(Number(e.target.value))}
								className="w-14 h-1 accent-white/70 cursor-pointer"
								title={`Stroke: ${strokeWidth}px`}
							/>
						</div>

						{/* Separator */}
						<div className="w-px h-5 bg-white/10 mx-0.5" />

						{/* Fade duration */}
						<select
							value={fadeDuration}
							onChange={(e) => onFadeDurationChange(Number(e.target.value) as LiveAnnotationFadeOption)}
							className="bg-transparent text-white/60 text-[10px] font-medium border-0 outline-none cursor-pointer px-1"
						>
							{LIVE_ANNOTATION_FADE_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value} className="bg-black text-white">
									{opt.label}
								</option>
							))}
						</select>

						{/* Separator */}
						<div className="w-px h-5 bg-white/10 mx-0.5" />

						{/* Undo + Clear */}
						<button
							type="button"
							onClick={onUndo}
							disabled={!canUndo}
							title="Undo"
							className={`p-1.5 rounded-full transition-all duration-100 ${
								canUndo
									? "text-white/50 hover:text-white/80 hover:bg-white/10"
									: "text-white/20 cursor-not-allowed"
							}`}
						>
							<Undo2 className="w-3.5 h-3.5" />
						</button>
						<button
							type="button"
							onClick={onClear}
							title="Clear all"
							className="p-1.5 rounded-full text-white/50 hover:text-red-400/80 hover:bg-white/10 transition-all duration-100"
						>
							<Eraser className="w-3.5 h-3.5" />
						</button>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

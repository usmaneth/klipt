import { RotateCcw } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";

interface SliderControlProps {
	label: string;
	value: number;
	defaultValue: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	formatValue: (value: number) => string;
	parseInput: (text: string) => number | null;
	accentColor?: "purple" | "blue" | "orange" | "green";
}

export const SliderControl = memo(function SliderControl({
	label,
	value,
	defaultValue,
	min,
	max,
	step,
	onChange,
	formatValue,
	parseInput,
	accentColor = "blue",
}: SliderControlProps) {
	const [editing, setEditing] = useState(false);
	const [editText, setEditText] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);
	const isModified = value !== defaultValue;

	useEffect(() => {
		if (editing && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editing]);

	const commitEdit = () => {
		const parsed = parseInput(editText);
		if (parsed != null && !isNaN(parsed)) {
			onChange(Math.min(max, Math.max(min, parsed)));
		}
		setEditing(false);
	};

	const cancelEdit = () => {
		setEditing(false);
	};

	return (
		<>
			<div className="flex items-center justify-between mb-1">
				<div className="flex items-center gap-1">
					<div className="text-[10px] font-medium text-slate-300">{label}</div>
					{isModified && (
						<button
							type="button"
							onClick={() => onChange(defaultValue)}
							className="text-slate-500 hover:text-slate-300 transition-colors"
							title="Reset to default"
						>
							<RotateCcw className="w-2.5 h-2.5" />
						</button>
					)}
				</div>
				{editing ? (
					<input
						ref={inputRef}
						type="text"
						value={editText}
						onChange={(e) => setEditText(e.target.value)}
						onBlur={commitEdit}
						onKeyDown={(e) => {
							if (e.key === "Enter") commitEdit();
							if (e.key === "Escape") cancelEdit();
						}}
						className="w-14 text-[10px] text-right font-mono bg-white/10 border border-white/20 rounded px-1 py-0 text-slate-200 outline-none focus:border-white/40"
					/>
				) : (
					<span
						className="text-[10px] text-slate-500 font-mono cursor-text hover:text-slate-300 transition-colors"
						onClick={() => {
							setEditText(formatValue(value));
							setEditing(true);
						}}
					>
						{formatValue(value)}
					</span>
				)}
			</div>
			<Slider
				value={[value]}
				onValueChange={(values) => onChange(values[0])}
				min={min}
				max={max}
				step={step}
				className={
					accentColor === "purple"
						? "w-full [&_[role=slider]]:bg-purple-500 [&_[role=slider]]:border-purple-500 [&_[role=slider]]:shadow-[0_0_10px_rgba(168,85,247,0.6)] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_.bg-primary]:bg-gradient-to-r [&_.bg-primary]:from-purple-600 [&_.bg-primary]:to-purple-400 [&_.bg-secondary]:bg-white/10"
						: accentColor === "orange"
							? "w-full [&_[role=slider]]:bg-orange-500 [&_[role=slider]]:border-orange-500 [&_[role=slider]]:shadow-[0_0_10px_rgba(249,115,22,0.6)] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_.bg-primary]:bg-gradient-to-r [&_.bg-primary]:from-orange-600 [&_.bg-primary]:to-orange-400 [&_.bg-secondary]:bg-white/10"
							: accentColor === "green"
								? "w-full [&_[role=slider]]:bg-green-400 [&_[role=slider]]:border-green-400 [&_[role=slider]]:shadow-[0_0_10px_rgba(74,222,128,0.6)] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_.bg-primary]:bg-gradient-to-r [&_.bg-primary]:from-green-600 [&_.bg-primary]:to-green-400 [&_.bg-secondary]:bg-white/10"
								: "w-full [&_[role=slider]]:bg-white/60 [&_[role=slider]]:border-white/60 [&_[role=slider]]:shadow-[0_0_10px_rgba(255,255,255,0.15)] [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_.bg-primary]:bg-gradient-to-r [&_.bg-primary]:from-white/30 [&_.bg-primary]:to-white/50 [&_.bg-secondary]:bg-white/10"
				}
			/>
		</>
	);
});

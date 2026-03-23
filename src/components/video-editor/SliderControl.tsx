import { RotateCcw } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import { Slider } from "@/components/ui/slider";

interface SliderControlProps {
	label?: string;
	value: number;
	defaultValue: number;
	min: number;
	max: number;
	step: number;
	onChange: (value: number) => void;
	formatValue: (value: number) => string;
	parseInput: (text: string) => number | null;
	
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
		<div className="w-full flex flex-col gap-3 group/slider-internal">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					{label && <span className="text-[12px] font-medium text-white/70 tracking-wide group-hover/slider-internal:text-white/90 transition-colors">{label}</span>}
					{isModified && (
						<button
							type="button"
							onClick={() => onChange(defaultValue)}
							className="text-white/20 hover:text-[#E0000F] transition-colors cursor-pointer"
							title="Reset to default"
						>
							<RotateCcw className="w-3 h-3" />
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
						className="w-16 text-[12px] text-center font-mono bg-black/40 border border-white/10 rounded-md px-2 py-1 text-white/90 outline-none focus:border-white/30 shadow-inner transition-colors"
					/>
				) : (
					<span
						className="text-[12px] text-white/50 font-mono cursor-text hover:text-white/90 transition-colors bg-white/[0.03] px-2 py-1 rounded-md border border-white/[0.05] shadow-sm min-w-[3rem] text-center hover:bg-white/[0.06]"
						onClick={() => {
							setEditText(formatValue(value));
							setEditing(true);
						}}
					>
						{formatValue(value)}
					</span>
				)}
			</div>
			<div className="w-full px-1">
				<Slider
					value={[value]}
					onValueChange={(values) => onChange(values[0])}
					min={min}
					max={max}
					step={step}
					className="w-full [&_[role=slider]]:bg-white [&_[role=slider]]:border-none [&_[role=slider]]:shadow-[0_2px_10px_rgba(0,0,0,0.5),0_0_15px_rgba(255,255,255,0.4)] [&_[role=slider]]:h-[18px] [&_[role=slider]]:w-[18px] [&_.bg-primary]:bg-[#E0000F] [&_.bg-secondary]:bg-black/40 [&_.bg-secondary]:shadow-inner"
				/>
			</div>
		</div>
	);
});

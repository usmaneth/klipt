import { memo } from "react";

interface AudioLevelMeterProps {
	level: number;
	className?: string;
}

const bars = [
	{ threshold: 10, height: "30%" },
	{ threshold: 25, height: "45%" },
	{ threshold: 45, height: "60%" },
	{ threshold: 65, height: "75%" },
	{ threshold: 85, height: "90%" },
];

function getBarColor(level: number, threshold: number) {
	if (!level || level < threshold) return "bg-slate-700/60 shadow-none";
	if (threshold > 80)
		return "bg-gradient-to-t from-red-500 to-red-400 shadow-[0_0_8px_rgba(239,68,68,0.8)]";
	if (threshold > 60)
		return "bg-gradient-to-t from-orange-500 to-orange-400 shadow-[0_0_8px_rgba(249,115,22,0.8)]";
	if (threshold > 40)
		return "bg-gradient-to-t from-yellow-400 to-yellow-300 shadow-[0_0_8px_rgba(250,204,21,0.8)]";
	return "bg-gradient-to-t from-green-400 to-green-300 shadow-[0_0_8px_rgba(74,222,128,0.8)]";
}

export const AudioLevelMeter = memo(function AudioLevelMeter({
	level,
	className = "",
}: AudioLevelMeterProps) {
	return (
		<div className={`flex items-end justify-between gap-1.5 h-6 ${className}`}>
			{bars.map((bar, index) => (
				<div
					key={index}
					className={`flex-1 rounded-sm transition-all duration-150 ease-out ${getBarColor(level, bar.threshold)}`}
					style={{
						height: level >= bar.threshold ? bar.height : "15%",
						opacity: level >= bar.threshold ? 1 : 0.25,
					}}
				/>
			))}
		</div>
	);
});

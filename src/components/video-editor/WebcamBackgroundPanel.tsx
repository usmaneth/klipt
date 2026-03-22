import Block from "@uiw/react-color-block";
import { Eye, EyeOff, Paintbrush, Scan, Sparkles } from "lucide-react";
import { memo } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BgMode } from "@/lib/ai/backgroundRemoval";
import { SliderControl } from "./SliderControl";

const BLOCK_COLOR_STYLE = {
	width: "100%" as const,
	borderRadius: "8px",
};

const BG_COLOR_PALETTE = [
	"#00FF00",
	"#0000FF",
	"#FF0000",
	"#FFFFFF",
	"#000000",
	"#FFD700",
	"#FF6B00",
	"#9B59B6",
	"#E91E63",
	"#00BCD4",
	"#2563EB",
	"#607D8B",
];

export interface WebcamBackgroundPanelProps {
	webcamBgMode: BgMode;
	onWebcamBgModeChange: (mode: BgMode) => void;
	webcamBgBlur: number;
	onWebcamBgBlurChange: (amount: number) => void;
	webcamBgColor: string;
	onWebcamBgColorChange: (color: string) => void;
}

export const WebcamBackgroundPanel = memo(function WebcamBackgroundPanel({
	webcamBgMode,
	onWebcamBgModeChange,
	webcamBgBlur,
	onWebcamBgBlurChange,
	webcamBgColor,
	onWebcamBgColorChange,
}: WebcamBackgroundPanelProps) {
	return (
		<AccordionItem
			value="webcam-background"
			className="border-white/5 rounded-xl bg-white/[0.02] px-3"
		>
			<AccordionTrigger className="py-2.5 hover:no-underline">
				<div className="flex items-center gap-2">
					<Sparkles className="w-4 h-4 text-[#8B5CF6]" />
					<span className="text-xs font-medium">Background Removal</span>
				</div>
			</AccordionTrigger>
			<AccordionContent className="pb-3">
				<div className="space-y-3">
					{/* Mode selector */}
					<div className="p-2 rounded-lg bg-white/5 border border-white/5">
						<div className="text-[10px] font-medium text-slate-300 mb-1.5">Mode</div>
						<ToggleGroup
							type="single"
							value={webcamBgMode}
							onValueChange={(value) => {
								if (value) {
									onWebcamBgModeChange(value as BgMode);
								}
							}}
							className="w-full grid grid-cols-4 gap-1"
						>
							<ToggleGroupItem
								value="none"
								className="flex items-center gap-1 text-[10px] data-[state=on]:bg-[#2563EB] data-[state=on]:text-white rounded-md h-7"
							>
								<EyeOff className="w-3 h-3" />
								None
							</ToggleGroupItem>
							<ToggleGroupItem
								value="remove"
								className="flex items-center gap-1 text-[10px] data-[state=on]:bg-[#2563EB] data-[state=on]:text-white rounded-md h-7"
							>
								<Scan className="w-3 h-3" />
								Remove
							</ToggleGroupItem>
							<ToggleGroupItem
								value="blur"
								className="flex items-center gap-1 text-[10px] data-[state=on]:bg-[#2563EB] data-[state=on]:text-white rounded-md h-7"
							>
								<Eye className="w-3 h-3" />
								Blur
							</ToggleGroupItem>
							<ToggleGroupItem
								value="color"
								className="flex items-center gap-1 text-[10px] data-[state=on]:bg-[#2563EB] data-[state=on]:text-white rounded-md h-7"
							>
								<Paintbrush className="w-3 h-3" />
								Color
							</ToggleGroupItem>
						</ToggleGroup>
					</div>

					{/* Blur amount slider */}
					{webcamBgMode === "blur" && (
						<div className="p-2 rounded-lg bg-white/5 border border-white/5">
							<SliderControl
								label="Blur Amount"
								value={webcamBgBlur}
								defaultValue={10}
								min={1}
								max={30}
								step={1}
								onChange={onWebcamBgBlurChange}
								formatValue={(v) => `${Math.round(v)}px`}
								parseInput={(text) => Number.parseFloat(text.replace(/px$/, ""))}
							/>
						</div>
					)}

					{/* Color picker */}
					{webcamBgMode === "color" && (
						<div className="p-2 rounded-lg bg-white/5 border border-white/5">
							<div className="text-[10px] font-medium text-slate-300 mb-1.5">Background Color</div>
							<Block
								color={webcamBgColor}
								colors={BG_COLOR_PALETTE}
								onChange={(color) => onWebcamBgColorChange(color.hex)}
								style={BLOCK_COLOR_STYLE}
							/>
						</div>
					)}
				</div>
			</AccordionContent>
		</AccordionItem>
	);
});

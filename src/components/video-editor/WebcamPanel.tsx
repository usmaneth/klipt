import Block from "@uiw/react-color-block";
import { Camera, Circle, RectangleHorizontal, Square } from "lucide-react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "../../contexts/I18nContext";
import { SliderControl } from "./SliderControl";

export type WebcamShape = "circle" | "rounded-rect" | "square";

export interface WebcamPanelProps {
	webcamVisible?: boolean;
	onWebcamVisibleChange: (visible: boolean) => void;
	webcamShape?: WebcamShape;
	onWebcamShapeChange?: (shape: WebcamShape) => void;
	webcamSize?: number;
	onWebcamSizeChange?: (size: number) => void;
	webcamOpacity?: number;
	onWebcamOpacityChange?: (opacity: number) => void;
	webcamBorderColor?: string;
	onWebcamBorderColorChange?: (color: string) => void;
	webcamBorderWidth?: number;
	onWebcamBorderWidthChange?: (width: number) => void;
	webcamShadow?: number;
	onWebcamShadowChange?: (shadow: number) => void;
}

const BORDER_COLOR_PALETTE = [
	"#FFFFFF",
	"#000000",
	"#FF0000",
	"#FFD700",
	"#00FF00",
	"#0000FF",
	"#FF6B00",
	"#9B59B6",
	"#E91E63",
	"#00BCD4",
	"#2563EB",
	"#607D8B",
];

export function WebcamPanel({
	webcamVisible = true,
	onWebcamVisibleChange,
	webcamShape = "circle",
	onWebcamShapeChange,
	webcamSize = 200,
	onWebcamSizeChange,
	webcamOpacity = 100,
	onWebcamOpacityChange,
	webcamBorderColor = "#FFFFFF",
	onWebcamBorderColorChange,
	webcamBorderWidth = 2,
	onWebcamBorderWidthChange,
	webcamShadow = 0,
	onWebcamShadowChange,
}: WebcamPanelProps) {
	const { t } = useI18n();

	return (
		<AccordionItem value="camera" className="border-white/5 rounded-xl bg-white/[0.02] px-3">
			<AccordionTrigger className="py-2.5 hover:no-underline">
				<div className="flex items-center gap-2">
					<Camera className="w-4 h-4 text-[#2563EB]" />
					<span className="text-xs font-medium">{t("editor.camera.title")}</span>
				</div>
			</AccordionTrigger>
			<AccordionContent className="pb-3">
				<div className="space-y-3">
					{/* Visible toggle */}
					<div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5">
						<div className="text-[10px] font-medium text-slate-300">
							{t("editor.camera.visible")}
						</div>
						<Switch
							checked={webcamVisible}
							onCheckedChange={onWebcamVisibleChange}
							className="data-[state=checked]:bg-[#2563EB] scale-90"
						/>
					</div>

					{/* Shape toggle group */}
					<div className="p-2 rounded-lg bg-white/5 border border-white/5">
						<div className="text-[10px] font-medium text-slate-300 mb-1.5">
							{t("editor.camera.shape")}
						</div>
						<ToggleGroup
							type="single"
							value={webcamShape}
							onValueChange={(value) => {
								if (value) {
									onWebcamShapeChange?.(value as WebcamShape);
								}
							}}
							className="w-full grid grid-cols-3 gap-1"
						>
							<ToggleGroupItem
								value="circle"
								className="flex items-center gap-1 text-[10px] data-[state=on]:bg-[#2563EB] data-[state=on]:text-white rounded-md h-7"
							>
								<Circle className="w-3 h-3" />
								{t("editor.camera.shapeCircle")}
							</ToggleGroupItem>
							<ToggleGroupItem
								value="rounded-rect"
								className="flex items-center gap-1 text-[10px] data-[state=on]:bg-[#2563EB] data-[state=on]:text-white rounded-md h-7"
							>
								<RectangleHorizontal className="w-3 h-3" />
								{t("editor.camera.shapeRoundedRect")}
							</ToggleGroupItem>
							<ToggleGroupItem
								value="square"
								className="flex items-center gap-1 text-[10px] data-[state=on]:bg-[#2563EB] data-[state=on]:text-white rounded-md h-7"
							>
								<Square className="w-3 h-3" />
								{t("editor.camera.shapeSquare")}
							</ToggleGroupItem>
						</ToggleGroup>
					</div>

					{/* Size and Opacity sliders */}
					<div className="grid grid-cols-2 gap-2">
						<div className="p-2 rounded-lg bg-white/5 border border-white/5">
							<SliderControl
								label={t("editor.camera.size")}
								value={webcamSize}
								defaultValue={200}
								min={50}
								max={400}
								step={1}
								onChange={onWebcamSizeChange ?? (() => {})}
								formatValue={(v) => `${Math.round(v)}px`}
								parseInput={(text) => Number.parseFloat(text.replace(/px$/, ""))}
							/>
						</div>
						<div className="p-2 rounded-lg bg-white/5 border border-white/5">
							<SliderControl
								label={t("editor.camera.opacity")}
								value={webcamOpacity}
								defaultValue={100}
								min={0}
								max={100}
								step={1}
								onChange={onWebcamOpacityChange ?? (() => {})}
								formatValue={(v) => `${Math.round(v)}%`}
								parseInput={(text) => Number.parseFloat(text.replace(/%$/, ""))}
							/>
						</div>
					</div>

					{/* Border color picker */}
					<div className="p-2 rounded-lg bg-white/5 border border-white/5">
						<div className="text-[10px] font-medium text-slate-300 mb-1.5">
							{t("editor.camera.borderColor")}
						</div>
						<Block
							color={webcamBorderColor}
							colors={BORDER_COLOR_PALETTE}
							onChange={(color) => onWebcamBorderColorChange?.(color.hex)}
							style={{
								width: "100%",
								borderRadius: "8px",
							}}
						/>
					</div>

					{/* Border width and Shadow sliders */}
					<div className="grid grid-cols-2 gap-2">
						<div className="p-2 rounded-lg bg-white/5 border border-white/5">
							<SliderControl
								label={t("editor.camera.borderWidth")}
								value={webcamBorderWidth}
								defaultValue={2}
								min={0}
								max={8}
								step={0.5}
								onChange={onWebcamBorderWidthChange ?? (() => {})}
								formatValue={(v) => `${v.toFixed(1)}px`}
								parseInput={(text) => Number.parseFloat(text.replace(/px$/, ""))}
							/>
						</div>
						<div className="p-2 rounded-lg bg-white/5 border border-white/5">
							<SliderControl
								label={t("editor.camera.shadow")}
								value={webcamShadow}
								defaultValue={0}
								min={0}
								max={100}
								step={1}
								onChange={onWebcamShadowChange ?? (() => {})}
								formatValue={(v) => `${Math.round(v)}%`}
								parseInput={(text) => Number.parseFloat(text.replace(/%$/, ""))}
							/>
						</div>
					</div>
				</div>
			</AccordionContent>
		</AccordionItem>
	);
}

import { Download, Image, Loader2 } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { generateThumbnails, type ThumbnailCandidate } from "@/lib/ai/thumbnailGenerator";

type ThumbnailAspectRatio = "16:9" | "1:1" | "4:3";

const ASPECT_RATIO_VALUES: Record<ThumbnailAspectRatio, number> = {
	"16:9": 16 / 9,
	"1:1": 1,
	"4:3": 4 / 3,
};

export interface ThumbnailPanelProps {
	videoUrl: string | null;
	onSaveThumbnail: (dataUrl: string) => void;
}

function formatTimestamp(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function cropToAspectRatio(dataUrl: string, targetRatio: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const img = new window.Image();
		img.onload = () => {
			const srcW = img.naturalWidth;
			const srcH = img.naturalHeight;
			const srcRatio = srcW / srcH;

			let cropW: number;
			let cropH: number;
			let cropX: number;
			let cropY: number;

			if (srcRatio > targetRatio) {
				// Source is wider — crop sides
				cropH = srcH;
				cropW = Math.round(srcH * targetRatio);
				cropX = Math.round((srcW - cropW) / 2);
				cropY = 0;
			} else {
				// Source is taller — crop top/bottom
				cropW = srcW;
				cropH = Math.round(srcW / targetRatio);
				cropX = 0;
				cropY = Math.round((srcH - cropH) / 2);
			}

			const canvas = document.createElement("canvas");
			canvas.width = cropW;
			canvas.height = cropH;
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				reject(new Error("Failed to create canvas context"));
				return;
			}
			ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
			resolve(canvas.toDataURL("image/png"));
		};
		img.onerror = () => reject(new Error("Failed to load image for cropping"));
		img.src = dataUrl;
	});
}

export const ThumbnailPanel = memo(function ThumbnailPanel({
	videoUrl,
	onSaveThumbnail,
}: ThumbnailPanelProps) {
	const [candidates, setCandidates] = useState<ThumbnailCandidate[]>([]);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [generating, setGenerating] = useState(false);
	const [progress, setProgress] = useState(0);
	const [aspectRatio, setAspectRatio] = useState<ThumbnailAspectRatio>("16:9");

	const handleGenerate = useCallback(async () => {
		if (!videoUrl) return;
		setGenerating(true);
		setProgress(0);
		setCandidates([]);
		setSelectedIndex(null);

		try {
			const results = await generateThumbnails(videoUrl, 6, (p) => {
				setProgress(p);
			});
			setCandidates(results);
			if (results.length > 0) {
				setSelectedIndex(0);
			}
		} catch (err) {
			console.error("[ThumbnailPanel] Generation failed:", err);
		} finally {
			setGenerating(false);
		}
	}, [videoUrl]);

	const handleSave = useCallback(async () => {
		if (selectedIndex === null || !candidates[selectedIndex]) return;

		const selected = candidates[selectedIndex];
		const targetRatio = ASPECT_RATIO_VALUES[aspectRatio];

		try {
			const croppedDataUrl = await cropToAspectRatio(selected.imageDataUrl, targetRatio);
			onSaveThumbnail(croppedDataUrl);
		} catch (err) {
			console.error("[ThumbnailPanel] Failed to crop thumbnail:", err);
			// Fall back to uncropped
			onSaveThumbnail(selected.imageDataUrl);
		}
	}, [selectedIndex, candidates, aspectRatio, onSaveThumbnail]);

	return (
		<AccordionItem
			value="thumbnails"
			className="border border-white/5 rounded-xl bg-gradient-to-b from-white/[0.03] to-white/[0.01] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] px-4"
		>
			<AccordionTrigger className="py-3 hover:no-underline group">
				<div className="flex items-center gap-2">
					<Image className="w-4 h-4 text-emerald-400 group-hover:text-emerald-300 drop-shadow-[0_0_5px_rgba(52,211,153,0.6)] transition-colors" />
					<span className="text-xs font-semibold tracking-wide text-slate-200 group-hover:text-white transition-colors">
						AI Thumbnails
					</span>
				</div>
			</AccordionTrigger>
			<AccordionContent className="pb-3">
				<div className="space-y-3">
					{/* Aspect ratio selector */}
					<div className="p-2 rounded-lg bg-white/5 border border-white/5">
						<div className="text-[10px] font-medium text-slate-300 mb-1.5">Aspect Ratio</div>
						<ToggleGroup
							type="single"
							value={aspectRatio}
							onValueChange={(value) => {
								if (value) {
									setAspectRatio(value as ThumbnailAspectRatio);
								}
							}}
							className="w-full grid grid-cols-3 gap-1"
						>
							<ToggleGroupItem
								value="16:9"
								className="text-[10px] data-[state=on]:bg-white/[0.12] data-[state=on]:text-white rounded-md h-7"
							>
								16:9
							</ToggleGroupItem>
							<ToggleGroupItem
								value="1:1"
								className="text-[10px] data-[state=on]:bg-white/[0.12] data-[state=on]:text-white rounded-md h-7"
							>
								1:1
							</ToggleGroupItem>
							<ToggleGroupItem
								value="4:3"
								className="text-[10px] data-[state=on]:bg-white/[0.12] data-[state=on]:text-white rounded-md h-7"
							>
								4:3
							</ToggleGroupItem>
						</ToggleGroup>
					</div>

					{/* Generate button */}
					<Button
						onClick={handleGenerate}
						disabled={generating || !videoUrl}
						className="w-full gap-2 bg-gradient-to-r from-emerald-600/40 to-teal-600/40 text-emerald-300 border border-emerald-500/30 hover:from-emerald-600/60 hover:to-teal-600/60 hover:border-emerald-500/50 hover:shadow-[0_0_15px_rgba(52,211,153,0.3)] transition-all h-8 text-xs font-semibold rounded-lg"
					>
						{generating ? (
							<>
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
								Analyzing... {Math.round(progress)}%
							</>
						) : (
							<>
								<Image className="w-3.5 h-3.5" />
								Generate Thumbnails
							</>
						)}
					</Button>

					{/* Candidates grid */}
					{candidates.length > 0 && (
						<div className="grid grid-cols-2 gap-2">
							{candidates.map((candidate, index) => (
								<button
									key={candidate.frameTime}
									type="button"
									onClick={() => setSelectedIndex(index)}
									className={`relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
										selectedIndex === index
											? "border-[#E0000F] shadow-[0_0_12px_rgba(224,0,15,0.5)]"
											: "border-white/10 hover:border-white/30"
									}`}
								>
									<img
										src={candidate.imageDataUrl}
										alt={`Thumbnail at ${formatTimestamp(candidate.frameTime)}`}
										className="w-full aspect-video object-cover"
									/>
									<div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
										<div className="flex items-center justify-between">
											<span className="text-[9px] text-white/80 font-mono">
												{formatTimestamp(candidate.frameTime)}
											</span>
											<span className="text-[9px] text-emerald-400 font-semibold">
												{(candidate.score * 100).toFixed(0)}%
											</span>
										</div>
									</div>
								</button>
							))}
						</div>
					)}

					{/* Save button */}
					{selectedIndex !== null && candidates.length > 0 && (
						<Button
							onClick={handleSave}
							className="w-full gap-2 bg-[#E0000F] hover:bg-[#E0000F]/90 text-white h-8 text-xs font-semibold rounded-lg transition-all hover:shadow-[0_0_15px_rgba(224,0,15,0.4)]"
						>
							<Download className="w-3.5 h-3.5" />
							Save Thumbnail
						</Button>
					)}
				</div>
			</AccordionContent>
		</AccordionItem>
	);
});

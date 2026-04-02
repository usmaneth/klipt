import { Download, Image, Loader2, Paintbrush, RotateCcw, Sparkles } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { generateThumbnails, type ThumbnailCandidate } from "@/lib/ai/thumbnailGenerator";
import {
	THUMBNAIL_TEMPLATES,
	renderThumbnail,
	type ThumbnailTemplate,
} from "@/lib/ai/thumbnailTemplates";

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
				cropH = srcH;
				cropW = Math.round(srcH * targetRatio);
				cropX = Math.round((srcW - cropW) / 2);
				cropY = 0;
			} else {
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

// ── Thumbnail Creator Sub-panel ─────────────────────────────────────────────

function ThumbnailCreator({
	baseFrame,
	onSave,
	onBack,
}: {
	baseFrame: string;
	onSave: (dataUrl: string) => void;
	onBack: () => void;
}) {
	const [selectedTemplate, setSelectedTemplate] = useState<ThumbnailTemplate>(THUMBNAIL_TEMPLATES[0]);
	const [textInputs, setTextInputs] = useState<string[]>(
		THUMBNAIL_TEMPLATES[0].textLayers.map((l) => l.text),
	);
	const [preview, setPreview] = useState<string | null>(null);
	const [rendering, setRendering] = useState(false);
	const previewRef = useRef<string | null>(null);

	const handleTemplateChange = useCallback(
		(template: ThumbnailTemplate) => {
			setSelectedTemplate(template);
			setTextInputs(template.textLayers.map((l) => l.text));
			setPreview(null);
		},
		[],
	);

	const handleTextChange = useCallback((index: number, value: string) => {
		setTextInputs((prev) => {
			const next = [...prev];
			next[index] = value;
			return next;
		});
		setPreview(null);
	}, []);

	const handlePreview = useCallback(async () => {
		setRendering(true);
		try {
			const result = await renderThumbnail(baseFrame, selectedTemplate, textInputs);
			previewRef.current = result;
			setPreview(result);
		} catch (err) {
			console.error("[ThumbnailCreator] Render failed:", err);
		} finally {
			setRendering(false);
		}
	}, [baseFrame, selectedTemplate, textInputs]);

	const handleSave = useCallback(() => {
		if (previewRef.current) {
			onSave(previewRef.current);
		}
	}, [onSave]);

	// Group templates by category
	const categories = Array.from(new Set(THUMBNAIL_TEMPLATES.map((t) => t.category)));

	return (
		<div className="space-y-3">
			{/* Back button */}
			<button
				onClick={onBack}
				className="flex items-center gap-1.5 text-[10px] text-slate-400 hover:text-white transition-colors"
			>
				<RotateCcw className="w-3 h-3" />
				Back to frame selection
			</button>

			{/* Template grid */}
			<div className="space-y-2">
				{categories.map((cat) => (
					<div key={cat}>
						<div className="text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
							{cat}
						</div>
						<div className="grid grid-cols-2 gap-1.5">
							{THUMBNAIL_TEMPLATES.filter((t) => t.category === cat).map((template) => (
								<button
									key={template.id}
									onClick={() => handleTemplateChange(template)}
									className={`px-2 py-1.5 rounded-md text-[10px] font-medium transition-all truncate ${
										selectedTemplate.id === template.id
											? "bg-[#E0000F]/20 text-[#E0000F] border border-[#E0000F]/40"
											: "bg-white/5 text-slate-300 border border-white/5 hover:bg-white/10 hover:text-white"
									}`}
								>
									{template.name}
								</button>
							))}
						</div>
					</div>
				))}
			</div>

			{/* Text inputs for current template */}
			{selectedTemplate.textLayers.length > 0 && (
				<div className="space-y-2 p-2 rounded-lg bg-white/5 border border-white/5">
					<div className="text-[10px] font-medium text-slate-300">Edit Text</div>
					{selectedTemplate.textLayers.map((layer, i) => (
						<input
							key={`${selectedTemplate.id}-${i}`}
							type="text"
							value={textInputs[i] ?? ""}
							onChange={(e) => handleTextChange(i, e.target.value)}
							placeholder={layer.text}
							className="w-full px-2 py-1.5 rounded-md bg-white/5 border border-white/10 text-[11px] text-white placeholder:text-slate-500 focus:outline-none focus:border-[#E0000F]/50 focus:ring-1 focus:ring-[#E0000F]/30"
						/>
					))}
				</div>
			)}

			{/* Preview button */}
			<Button
				onClick={handlePreview}
				disabled={rendering}
				className="w-full gap-2 bg-gradient-to-r from-purple-600/40 to-pink-600/40 text-purple-300 border border-purple-500/30 hover:from-purple-600/60 hover:to-pink-600/60 hover:border-purple-500/50 hover:shadow-[0_0_15px_rgba(168,85,247,0.3)] transition-all h-8 text-xs font-semibold rounded-lg"
			>
				{rendering ? (
					<>
						<Loader2 className="w-3.5 h-3.5 animate-spin" />
						Rendering...
					</>
				) : (
					<>
						<Sparkles className="w-3.5 h-3.5" />
						Generate Preview
					</>
				)}
			</Button>

			{/* Preview display */}
			{preview && (
				<div className="space-y-2">
					<div className="rounded-lg overflow-hidden border-2 border-purple-500/40 shadow-[0_0_20px_rgba(168,85,247,0.3)]">
						<img
							src={preview}
							alt="Thumbnail preview"
							className="w-full aspect-video object-cover"
						/>
					</div>
					<Button
						onClick={handleSave}
						className="w-full gap-2 bg-[#E0000F] hover:bg-[#E0000F]/90 text-white h-8 text-xs font-semibold rounded-lg transition-all hover:shadow-[0_0_15px_rgba(224,0,15,0.4)]"
					>
						<Download className="w-3.5 h-3.5" />
						Save Thumbnail
					</Button>
				</div>
			)}
		</div>
	);
}

// ── Main ThumbnailPanel ─────────────────────────────────────────────────────

export const ThumbnailPanel = memo(function ThumbnailPanel({
	videoUrl,
	onSaveThumbnail,
}: ThumbnailPanelProps) {
	const [candidates, setCandidates] = useState<ThumbnailCandidate[]>([]);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const [generating, setGenerating] = useState(false);
	const [progress, setProgress] = useState(0);
	const [aspectRatio, setAspectRatio] = useState<ThumbnailAspectRatio>("16:9");
	const [mode, setMode] = useState<"select" | "create">("select");

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
			onSaveThumbnail(selected.imageDataUrl);
		}
	}, [selectedIndex, candidates, aspectRatio, onSaveThumbnail]);

	const selectedFrame =
		selectedIndex !== null && candidates[selectedIndex]
			? candidates[selectedIndex].imageDataUrl
			: null;

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
				{mode === "create" && selectedFrame ? (
					<ThumbnailCreator
						baseFrame={selectedFrame}
						onSave={onSaveThumbnail}
						onBack={() => setMode("select")}
					/>
				) : (
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

						{/* Action buttons */}
						{selectedIndex !== null && candidates.length > 0 && (
							<div className="flex gap-2">
								<Button
									onClick={handleSave}
									className="flex-1 gap-2 bg-[#E0000F] hover:bg-[#E0000F]/90 text-white h-8 text-xs font-semibold rounded-lg transition-all hover:shadow-[0_0_15px_rgba(224,0,15,0.4)]"
								>
									<Download className="w-3.5 h-3.5" />
									Save As-Is
								</Button>
								<Button
									onClick={() => setMode("create")}
									className="flex-1 gap-2 bg-gradient-to-r from-purple-600/40 to-pink-600/40 text-purple-300 border border-purple-500/30 hover:from-purple-600/60 hover:to-pink-600/60 h-8 text-xs font-semibold rounded-lg transition-all"
								>
									<Paintbrush className="w-3.5 h-3.5" />
									Add Text & Style
								</Button>
							</div>
						)}
					</div>
				)}
			</AccordionContent>
		</AccordionItem>
	);
});

import { Copy, Hash, Loader2, Sparkles, Type, Wand2 } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { Chapter } from "@/lib/ai/chapterDetector";
import { isGeminiConfigured } from "@/lib/ai/geminiClient";
import {
	formatChapterBlock,
	generateVideoMetadata,
	isMetadataGeneratorAvailable,
	type MetadataOptions,
	type VideoMetadata,
} from "@/lib/ai/metadataGenerator";
import { SHORTS_CAPTION_PRESETS, type ShortsCaptionPreset } from "@/lib/ai/shortsCaptionPresets";
import type { CaptionSettings } from "./captionStyle";

export interface ShortsStudioPanelProps {
	transcriptText: string;
	transcriptWords: Array<{ text: string; start: number; end: number }>;
	chapters: Chapter[];
	captionSettings: CaptionSettings;
	onApplyCaptionSettings: (next: CaptionSettings) => void;
	onEnableShortsReframe?: () => void;
	isReframing?: boolean;
	shortsReframeReady?: boolean;
}

type Platform = MetadataOptions["platform"];

const PLATFORMS: Array<{ id: NonNullable<Platform>; label: string }> = [
	{ id: "youtube", label: "YouTube" },
	{ id: "shorts", label: "YT Shorts" },
	{ id: "tiktok", label: "TikTok" },
	{ id: "instagram", label: "Reels" },
];

export function ShortsStudioPanel({
	transcriptText,
	transcriptWords,
	chapters,
	captionSettings,
	onApplyCaptionSettings,
	onEnableShortsReframe,
	isReframing,
	shortsReframeReady,
}: ShortsStudioPanelProps) {
	const [platform, setPlatform] = useState<NonNullable<Platform>>("shorts");
	const [topicHint, setTopicHint] = useState("");
	const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);

	const canUseGemini = isGeminiConfigured();
	const canGenerateMetadata = isMetadataGeneratorAvailable();
	const chapterBlock = useMemo(() => formatChapterBlock(chapters), [chapters]);

	const onGenerate = useCallback(async () => {
		if (!canGenerateMetadata) {
			toast.error("Add a Gemini API key in Settings to generate metadata");
			return;
		}
		if (!transcriptText.trim()) {
			toast("Generate captions first so klipt has something to work from");
			return;
		}
		setIsGenerating(true);
		try {
			const result = await generateVideoMetadata({
				transcript: transcriptWords.length > 0 ? transcriptWords : transcriptText,
				chapters,
				platform,
				topicHint: topicHint.trim() || undefined,
			});
			setMetadata(result);
			toast.success("Metadata ready");
		} catch (err) {
			console.error("[ShortsStudio] metadata generation failed", err);
			toast.error(err instanceof Error ? err.message : "Metadata generation failed");
		} finally {
			setIsGenerating(false);
		}
	}, [canGenerateMetadata, chapters, platform, topicHint, transcriptText, transcriptWords]);

	const copyText = useCallback((label: string, text: string) => {
		navigator.clipboard.writeText(text).then(
			() => toast.success(`Copied ${label}`),
			() => toast.error(`Could not copy ${label}`),
		);
	}, []);

	const onPreset = useCallback(
		(preset: ShortsCaptionPreset) => {
			onApplyCaptionSettings({ ...captionSettings, ...preset.apply });
			toast.success(`Applied ${preset.label} captions`);
		},
		[captionSettings, onApplyCaptionSettings],
	);

	return (
		<div className="flex flex-col gap-3 h-full">
			<div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
				<Sparkles className="w-3.5 h-3.5 text-white/40" />
				<span className="text-[11px] font-medium text-white/50">Shorts Studio</span>
				{canUseGemini && (
					<span className="ml-auto px-1.5 py-[1px] rounded-full bg-violet-500/15 text-violet-300/80 text-[9px] font-medium uppercase tracking-wider">
						Gemini
					</span>
				)}
			</div>

			{/* ── 9:16 Reframe ─────────────────────────────────────────────── */}
			<Section icon={<Wand2 className="w-3 h-3" />} title="Vertical Reframe (9:16)">
				<p className="text-[11px] text-white/40 leading-relaxed">
					Auto-crop the video to 9:16 with subject tracking for TikTok / Reels / Shorts.
				</p>
				<button
					type="button"
					onClick={onEnableShortsReframe}
					disabled={isReframing || !onEnableShortsReframe}
					className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-[12px] font-medium text-white/70 hover:text-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
				>
					{isReframing ? (
						<>
							<Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyzing video...
						</>
					) : shortsReframeReady ? (
						<>Reframe ready — export to apply</>
					) : (
						<>Build 9:16 Reframe</>
					)}
				</button>
			</Section>

			{/* ── Caption presets ─────────────────────────────────────────── */}
			<Section icon={<Type className="w-3 h-3" />} title="Shorts Caption Presets">
				<div className="grid grid-cols-1 gap-2">
					{SHORTS_CAPTION_PRESETS.map((preset) => (
						<button
							key={preset.id}
							type="button"
							onClick={() => onPreset(preset)}
							className="text-left rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] p-2.5 transition-colors"
						>
							<div className="flex items-center justify-between gap-2">
								<span className="text-[12px] font-semibold text-white/85">{preset.label}</span>
								<span className="text-[10px] text-white/30">Apply</span>
							</div>
							<p className="text-[11px] text-white/45 leading-relaxed mt-0.5">
								{preset.description}
							</p>
						</button>
					))}
				</div>
			</Section>

			{/* ── Metadata generator ──────────────────────────────────────── */}
			<Section icon={<Hash className="w-3 h-3" />} title="AI Titles &amp; Description">
				<div className="flex flex-wrap gap-1.5">
					{PLATFORMS.map((p) => (
						<button
							key={p.id}
							type="button"
							onClick={() => setPlatform(p.id)}
							className={`px-2 py-1 rounded-lg text-[10px] border transition-colors ${
								platform === p.id
									? "bg-white/15 border-white/30 text-white/90"
									: "bg-white/[0.04] border-white/[0.06] text-white/50 hover:bg-white/[0.08]"
							}`}
						>
							{p.label}
						</button>
					))}
				</div>

				<input
					type="text"
					value={topicHint}
					onChange={(e) => setTopicHint(e.target.value)}
					placeholder="Topic hint (optional) e.g. 'Python for beginners'"
					className="w-full rounded-lg bg-black/30 border border-white/[0.08] px-2 py-1.5 text-[11px] text-white/85 placeholder:text-white/25 focus:outline-none focus:border-white/30"
				/>

				<button
					type="button"
					onClick={onGenerate}
					disabled={isGenerating || !canGenerateMetadata}
					className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-[12px] font-medium text-white/70 hover:text-white/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
				>
					{isGenerating ? (
						<>
							<Loader2 className="w-3.5 h-3.5 animate-spin" /> Writing metadata...
						</>
					) : (
						<>
							<Sparkles className="w-3.5 h-3.5" /> Generate title &amp; description
						</>
					)}
				</button>
				{!canGenerateMetadata && (
					<p className="text-[10px] text-white/30 text-center px-2">
						Add a Gemini API key in Settings to enable.
					</p>
				)}

				{metadata && (
					<div className="flex flex-col gap-2 mt-1">
						<MetaCard
							label="Primary title"
							value={metadata.title}
							onCopy={() => copyText("title", metadata.title)}
						/>
						{metadata.titleVariants.length > 0 && (
							<div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-2.5">
								<span className="text-[10px] uppercase tracking-wider text-white/40">Variants</span>
								<ul className="mt-1 space-y-1">
									{metadata.titleVariants.map((t) => (
										<li
											key={t}
											onClick={() => copyText("variant", t)}
											className="text-[11px] text-white/75 hover:text-white cursor-pointer truncate"
										>
											• {t}
										</li>
									))}
								</ul>
							</div>
						)}
						<MetaCard
							label="Description"
							value={
								chapterBlock
									? `${metadata.description}\n\nChapters:\n${chapterBlock}`
									: metadata.description
							}
							multiline
							onCopy={() =>
								copyText(
									"description",
									chapterBlock
										? `${metadata.description}\n\nChapters:\n${chapterBlock}`
										: metadata.description,
								)
							}
						/>
						{metadata.hashtags.length > 0 && (
							<MetaCard
								label="Hashtags"
								value={metadata.hashtags.join(" ")}
								onCopy={() => copyText("hashtags", metadata.hashtags.join(" "))}
							/>
						)}
						{metadata.tags.length > 0 && (
							<MetaCard
								label="Tags"
								value={metadata.tags.join(", ")}
								onCopy={() => copyText("tags", metadata.tags.join(", "))}
							/>
						)}
					</div>
				)}
			</Section>
		</div>
	);
}

function Section({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-2 rounded-xl bg-white/[0.02] border border-white/[0.04] p-3">
			<div className="flex items-center gap-1.5 text-[11px] font-medium text-white/60">
				{icon}
				{title}
			</div>
			{children}
		</div>
	);
}

function MetaCard({
	label,
	value,
	multiline,
	onCopy,
}: {
	label: string;
	value: string;
	multiline?: boolean;
	onCopy: () => void;
}) {
	return (
		<div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-2.5">
			<div className="flex items-center justify-between gap-2 mb-1">
				<span className="text-[10px] uppercase tracking-wider text-white/40">{label}</span>
				<button
					type="button"
					onClick={onCopy}
					className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white/80"
				>
					<Copy className="w-3 h-3" /> Copy
				</button>
			</div>
			{multiline ? (
				<pre className="whitespace-pre-wrap text-[11px] text-white/80 leading-relaxed font-sans">
					{value}
				</pre>
			) : (
				<p className="text-[12px] text-white/85 font-medium">{value}</p>
			)}
		</div>
	);
}

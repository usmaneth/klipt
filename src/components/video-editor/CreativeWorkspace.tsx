import { motion, AnimatePresence } from "framer-motion";
import {
	ArrowRight,
	ArrowRightLeft,
	BookOpen,
	Check,
	Clipboard,
	FileText,
	History,
	LayoutGrid,
	Loader2,
	MessageCircle,
	MessageSquare,
	Music,
	Play,
	RotateCcw,
	Search,
	Sparkles,
	Trash2,
	Type,
	X,
} from "lucide-react";
import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { previewSoundEffect } from "@/lib/audio/soundEffectSynth";
import type { SoundEffectId, TimelineComment, TransitionType, TrimRegion } from "./types";
import { CommentsPanel } from "./CommentsPanel";

// ── AI Suggestion type ──────────────────────────────────────────────────────

export interface AISuggestion {
	id: string;
	type: "silence" | "filler" | "best-moment" | "chapter" | "title" | "summary";
	label: string;
	startMs: number;
	endMs: number;
	word?: string;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type WorkspacePanel =
	| "clips"
	| "history"
	| "ai"
	| "assets"
	| "scratchpad"
	| "notes"
	| "comments";

export interface WorkspaceNote {
	id: string;
	timeMs: number;
	text: string;
	color: string;
}

export interface ScratchPadClip {
	id: string;
	label: string;
	sourceTimeMs: number;
	durationMs: number;
	thumbnailUrl?: string;
	mp4Url?: string;
}

type AssetSubTab = "clips" | "stickers" | "sounds" | "transitions";

interface GiphyClipResult {
	id: string;
	title: string;
	images: {
		fixed_width: { mp4?: string; url: string; width: string; height: string };
		original: { mp4?: string; url: string; width: string; height: string };
	};
}

interface EditorHistorySnapshot {
	zoomRegions: unknown[];
	trimRegions: unknown[];
	speedRegions: unknown[];
	annotationRegions: unknown[];
	audioRegions: unknown[];
	selectedZoomId: string | null;
	selectedTrimId: string | null;
	selectedSpeedId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
}

interface CreativeWorkspaceProps {
	activePanel: WorkspacePanel | null;
	onPanelChange: (panel: WorkspacePanel | null) => void;
	cuttingRoomFloor: TrimRegion[];
	onRestoreFromFloor: (id: string) => void;
	historyPastRef: MutableRefObject<EditorHistorySnapshot[]>;
	onHistoryRestore: (index: number) => void;
	notes: WorkspaceNote[];
	onNotesChange: (notes: WorkspaceNote[]) => void;
	currentTime: number;
	aiSuggestions: AISuggestion[];
	aiAnalysisProgress: number | null;
	onAnalyzeVideo: () => void;
	onAcceptSuggestion: (suggestion: AISuggestion) => void;
	onDismissSuggestion: (id: string) => void;
	onJumpToTime: (timeMs: number) => void;
	scratchPadClips: ScratchPadClip[];
	onScratchPadClipsChange: (clips: ScratchPadClip[]) => void;
	onImportVideo: () => void;
	onAddStickerAnnotation?: (emoji: string) => void;
	onAddSoundEffect?: (soundId: SoundEffectId) => void;
	onAddTransition?: (type: TransitionType) => void;
	onRestoreClipToTimeline?: (clip: ScratchPadClip) => void;
	hasVideo: boolean;
	timelineComments: TimelineComment[];
	onAddComment: (comment: TimelineComment) => void;
	onDeleteComment: (id: string) => void;
	onSeekToComment: (timeMs: number) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const NOTE_COLORS = ["#E0000F", "#FF9500", "#30D158", "#0A84FF", "#BF5AF2"];

const PANELS: { id: WorkspacePanel; icon: typeof LayoutGrid; label: string }[] = [
	{ id: "clips", icon: LayoutGrid, label: "Clips" },
	{ id: "history", icon: History, label: "History" },
	{ id: "ai", icon: Sparkles, label: "AI Suggestions" },
	{ id: "assets", icon: Music, label: "Assets" },
	{ id: "scratchpad", icon: Clipboard, label: "Scratch Pad" },
	{ id: "notes", icon: MessageSquare, label: "Notes" },
	{ id: "comments", icon: MessageCircle, label: "Comments" },
];

const ASSET_SUB_TABS: { id: AssetSubTab; label: string }[] = [
	{ id: "clips", label: "Clips" },
	{ id: "stickers", label: "Stickers" },
	{ id: "sounds", label: "Sounds" },
	{ id: "transitions", label: "Transitions" },
];

const STICKER_EMOJIS = [
	"\u{1F525}", "\u{2B50}", "\u{1F446}", "\u{1F447}", "\u{2764}\u{FE0F}", "\u{1F602}",
	"\u{1F3AF}", "\u{1F4AF}", "\u{1F680}", "\u{2705}", "\u{274C}", "\u{1F3B5}",
	"\u{1F514}", "\u{1F440}", "\u{1F4A1}", "\u{26A1}", "\u{1F3C6}", "\u{1F389}",
	"\u{1F44B}", "\u{1F4AA}",
];

const SOUND_EFFECTS = [
	{ id: "sfx-click", name: "Click", duration: "0.2s" },
	{ id: "sfx-whoosh", name: "Whoosh", duration: "0.5s" },
	{ id: "sfx-pop", name: "Pop", duration: "0.3s" },
	{ id: "sfx-ding", name: "Ding", duration: "0.4s" },
	{ id: "sfx-swoosh", name: "Swoosh", duration: "0.6s" },
	{ id: "sfx-thud", name: "Thud", duration: "0.3s" },
	{ id: "sfx-rise", name: "Rise", duration: "1.0s" },
	{ id: "sfx-fall", name: "Fall", duration: "0.8s" },
];

const TRANSITIONS = [
	{ id: "tr-crossfade", name: "Crossfade" },
	{ id: "tr-wipe-left", name: "Wipe Left" },
	{ id: "tr-wipe-right", name: "Wipe Right" },
	{ id: "tr-zoom-in", name: "Zoom In" },
	{ id: "tr-zoom-out", name: "Zoom Out" },
	{ id: "tr-dissolve", name: "Dissolve" },
];

const SCRATCH_PAD_COLORS = ["#E0000F", "#FF9500", "#30D158", "#0A84FF", "#BF5AF2", "#FF375F"];

const GIPHY_API_KEY = "GlVGYHkr3WSBnllca54iNt0yFbjz7L65";
const TENOR_API_KEY = "AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

function relativeTime(index: number, total: number): string {
	const diff = total - index;
	if (diff <= 1) return "just now";
	if (diff <= 5) return `${diff} edits ago`;
	return `${diff} edits ago`;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function CreativeWorkspace({
	activePanel,
	onPanelChange,
	cuttingRoomFloor,
	onRestoreFromFloor,
	historyPastRef,
	onHistoryRestore,
	notes,
	onNotesChange,
	currentTime,
	aiSuggestions,
	aiAnalysisProgress,
	onAnalyzeVideo,
	onAcceptSuggestion,
	onDismissSuggestion,
	onJumpToTime,
	scratchPadClips,
	onScratchPadClipsChange,
	onImportVideo,
	onAddStickerAnnotation,
	onAddSoundEffect,
	onAddTransition,
	onRestoreClipToTimeline,
	hasVideo,
	timelineComments,
	onAddComment,
	onDeleteComment,
	onSeekToComment,
}: CreativeWorkspaceProps) {
	const [noteInput, setNoteInput] = useState("");
	const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
	const noteInputRef = useRef<HTMLInputElement>(null);

	// Asset Library state
	const [assetSubTab, setAssetSubTab] = useState<AssetSubTab>("clips");
	const [giphyQuery, setGiphyQuery] = useState("");
	const [giphyResults, setGiphyResults] = useState<GiphyClipResult[]>([]);
	const [giphyLoading, setGiphyLoading] = useState(false);
	const [hoveredGiphyId, setHoveredGiphyId] = useState<string | null>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// ── Giphy fetch ─────────────────────────────────────────────────────────

	const [giphyError, setGiphyError] = useState<string | null>(null);

	const fetchGiphy = useCallback(async (query: string) => {
		setGiphyLoading(true);
		setGiphyError(null);
		try {
			// Try Giphy first
			const endpoint = query.trim()
				? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=20`
				: `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=20`;
			const res = await fetch(endpoint);
			if (!res.ok) {
				throw new Error(`Giphy API returned ${res.status}`);
			}
			const json = await res.json();
			setGiphyResults(json.data ?? []);
		} catch {
			// Fallback to Tenor API
			try {
				const tenorQ = query.trim() || "trending";
				const tenorEndpoint = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(tenorQ)}&key=${TENOR_API_KEY}&limit=20`;
				const tenorRes = await fetch(tenorEndpoint);
				if (!tenorRes.ok) {
					throw new Error(`Tenor API returned ${tenorRes.status}`);
				}
				const tenorJson = await tenorRes.json();
				// Map Tenor results to GiphyClipResult shape
				const mapped: GiphyClipResult[] = (tenorJson.results ?? []).map((item: { id: string; title?: string; media_formats?: Record<string, { url?: string; dims?: number[] }> }) => {
					const gifUrl = item.media_formats?.gif?.url ?? item.media_formats?.tinygif?.url ?? "";
					const mp4Url = item.media_formats?.mp4?.url ?? item.media_formats?.tinymp4?.url ?? "";
					const dims = item.media_formats?.gif?.dims ?? item.media_formats?.tinygif?.dims ?? [200, 200];
					return {
						id: String(item.id),
						title: item.title ?? "",
						images: {
							fixed_width: { url: gifUrl, mp4: mp4Url || undefined, width: String(dims[0] ?? 200), height: String(dims[1] ?? 200) },
							original: { url: gifUrl, mp4: mp4Url || undefined, width: String(dims[0] ?? 200), height: String(dims[1] ?? 200) },
						},
					};
				});
				setGiphyResults(mapped);
			} catch {
				setGiphyResults([]);
				setGiphyError("Giphy unavailable — check internet");
				toast.error("Giphy unavailable — check internet");
			}
		} finally {
			setGiphyLoading(false);
		}
	}, []);

	// Initial trending load when Clips sub-tab is active
	useEffect(() => {
		if (activePanel === "assets" && assetSubTab === "clips" && giphyResults.length === 0 && !giphyQuery) {
			fetchGiphy("");
		}
	}, [activePanel, assetSubTab, fetchGiphy, giphyResults.length, giphyQuery]);

	// Debounced search on query change
	useEffect(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			fetchGiphy(giphyQuery);
		}, 500);
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [giphyQuery, fetchGiphy]);

	const handleGiphyClipClick = useCallback((clip: GiphyClipResult) => {
		const thumbnailUrl = clip.images.fixed_width.url;
		const mp4Url = clip.images.fixed_width.mp4 ?? clip.images.original.mp4 ?? "";

		// If a video is loaded, add directly to timeline as an overlay
		if (onRestoreClipToTimeline && hasVideo) {
			const scratchClip: ScratchPadClip = {
				id: `giphy-${clip.id}-${Date.now()}`,
				label: clip.title || "Giphy Clip",
				sourceTimeMs: 0,
				durationMs: 5000,
				thumbnailUrl,
				mp4Url,
			};
			onRestoreClipToTimeline(scratchClip);
			return;
		}

		// Fallback: add to scratch pad
		const newClip: ScratchPadClip = {
			id: `giphy-${clip.id}-${Date.now()}`,
			label: clip.title || "Giphy Clip",
			sourceTimeMs: 0,
			durationMs: 5000,
			thumbnailUrl,
			mp4Url,
		};
		onScratchPadClipsChange([...scratchPadClips, newClip]);
		toast.success("Clip added to scratch pad");
	}, [scratchPadClips, onScratchPadClipsChange, onRestoreClipToTimeline, hasVideo]);

	// ── Scratch pad actions ─────────────────────────────────────────────────

	const handleRemoveScratchPadClip = useCallback((id: string) => {
		onScratchPadClipsChange(scratchPadClips.filter((c) => c.id !== id));
	}, [scratchPadClips, onScratchPadClipsChange]);

	const handleRestoreScratchPadClip = useCallback((id: string) => {
		const clip = scratchPadClips.find((c) => c.id === id);
		if (!clip) return;

		if (onRestoreClipToTimeline) {
			onRestoreClipToTimeline(clip);
		}
		onScratchPadClipsChange(scratchPadClips.filter((c) => c.id !== id));
	}, [scratchPadClips, onScratchPadClipsChange, onRestoreClipToTimeline]);

	// ── Core workspace callbacks ────────────────────────────────────────────

	const togglePanel = useCallback(
		(panel: WorkspacePanel) => {
			onPanelChange(activePanel === panel ? null : panel);
		},
		[activePanel, onPanelChange],
	);

	const addNote = useCallback(() => {
		const text = noteInput.trim();
		if (!text) return;
		const note: WorkspaceNote = {
			id: `note-${Date.now()}`,
			timeMs: currentTime * 1000,
			text,
			color: noteColor,
		};
		onNotesChange([...notes, note]);
		setNoteInput("");
		toast.success(`Note added at ${formatMs(currentTime * 1000)}`);
	}, [noteInput, noteColor, currentTime, notes, onNotesChange]);

	const removeNote = useCallback(
		(id: string) => {
			onNotesChange(notes.filter((n) => n.id !== id));
		},
		[notes, onNotesChange],
	);

	// ── Panel content renderers ────────────────────────────────────────────────

	const renderClips = () => (
		<div className="flex flex-col gap-2">
			{cuttingRoomFloor.length === 0 && (
				<p className="text-[11px] text-white/30 text-center py-4">
					Cut clips will appear here. Use the trim tool on the timeline to cut segments.
				</p>
			)}
			{cuttingRoomFloor.map((clip) => (
				<div
					key={clip.id}
					className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2"
				>
					<span className="text-[11px] text-white/50">
						{formatMs(clip.startMs)} - {formatMs(clip.endMs)}
					</span>
					<button
						type="button"
						onClick={() => {
							onRestoreFromFloor(clip.id);
							toast.success("Clip restored to timeline");
						}}
						className="text-[10px] text-[#E0000F] hover:text-[#FF4500] transition-colors cursor-pointer"
					>
						Restore
					</button>
				</div>
			))}
			<button
				type="button"
				onClick={() => {
					onImportVideo();
				}}
				className="mt-2 w-full py-2 rounded-lg border border-dashed border-white/10 text-[11px] text-white/30 hover:text-white/50 hover:border-white/20 transition-colors cursor-pointer"
			>
				+ Import
			</button>
		</div>
	);

	const renderHistory = () => {
		const snapshots = historyPastRef.current;
		if (snapshots.length === 0) {
			return (
				<p className="text-[11px] text-white/30 text-center py-4">
					No history yet — start editing to build history
				</p>
			);
		}
		return (
			<div className="flex flex-col gap-1">
				{[...snapshots].reverse().map((snap, idx) => {
					const label = describeSnapshot(snap);
					const originalIndex = snapshots.length - 1 - idx;
					return (
						<div
							key={idx}
							onClick={() => {
								onHistoryRestore(originalIndex);
								toast.success("State restored from history");
							}}
							className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer"
						>
							<span className="text-[11px] text-white/60 truncate max-w-[180px]">
								{label}
							</span>
							<span className="text-[10px] text-white/25 flex-shrink-0 ml-2">
								{relativeTime(originalIndex, snapshots.length)}
							</span>
						</div>
					);
				})}
			</div>
		);
	};

	const renderAI = () => {
		// Analysing in progress
		if (aiAnalysisProgress !== null) {
			return (
				<div className="flex flex-col items-center gap-3 py-6">
					<Loader2 className="w-5 h-5 text-[#BF5AF2] animate-spin" />
					<span className="text-[11px] text-white/50">Analyzing audio...</span>
					<div className="w-full bg-white/[0.06] rounded-full h-1.5 overflow-hidden">
						<div
							className="h-full bg-[#BF5AF2] rounded-full transition-all duration-300"
							style={{ width: `${aiAnalysisProgress}%` }}
						/>
					</div>
					<span className="text-[10px] text-white/30">{aiAnalysisProgress}%</span>
				</div>
			);
		}

		// No suggestions yet — show Analyze button
		if (aiSuggestions.length === 0) {
			return (
				<div className="flex flex-col items-center gap-3 py-6">
					<Sparkles className={`w-5 h-5 ${hasVideo ? "text-[#BF5AF2]" : "text-white/20"}`} />
					<p className="text-[11px] text-white/40 text-center">
						{hasVideo
							? "Analyze your video to get AI-powered edit suggestions based on audio transcription."
							: "Load a video first to use AI analysis."}
					</p>
					<button
						type="button"
						onClick={onAnalyzeVideo}
						disabled={!hasVideo}
						className={`mt-1 px-4 py-2 rounded-lg text-[11px] font-medium transition-colors ${
							hasVideo
								? "bg-[#BF5AF2]/20 text-[#BF5AF2] hover:bg-[#BF5AF2]/30 cursor-pointer"
								: "bg-white/[0.04] text-white/20 opacity-50 cursor-not-allowed"
						}`}
					>
						{hasVideo ? "Analyze Video" : "Load a video first"}
					</button>
				</div>
			);
		}

		// Show suggestion cards
		const typeIcon: Record<AISuggestion["type"], string> = {
			silence: "silence",
			filler: "filler",
			"best-moment": "moment",
			chapter: "chapter",
			title: "title",
			summary: "summary",
		};
		const typeColor: Record<AISuggestion["type"], string> = {
			silence: "#FF9500",
			filler: "#E0000F",
			"best-moment": "#30D158",
			chapter: "#BF5AF2",
			title: "#FBBF24",
			summary: "#60A5FA",
		};

		return (
			<div className="flex flex-col gap-2">
				{aiSuggestions.map((s, index) => (
					<motion.div
						key={s.id}
						initial={{ opacity: 0, x: -10 }}
						animate={{ opacity: 1, x: 0 }}
						transition={{ duration: 0.2, delay: index * 0.06 }}
						className="rounded-lg bg-white/[0.04] p-3 flex flex-col gap-2"
					>
						<div className="flex items-center gap-2">
							{s.type === "chapter" ? (
									<BookOpen
										className="w-3 h-3 flex-shrink-0"
										style={{ color: typeColor[s.type] }}
									/>
								) : s.type === "title" ? (
									<Type
										className="w-3 h-3 flex-shrink-0"
										style={{ color: typeColor[s.type] }}
									/>
								) : s.type === "summary" ? (
									<FileText
										className="w-3 h-3 flex-shrink-0"
										style={{ color: typeColor[s.type] }}
									/>
								) : (
									<Sparkles
										className="w-3 h-3 flex-shrink-0"
										style={{ color: typeColor[s.type] }}
									/>
								)}
							<span className="text-[11px] text-white/70">{s.label}</span>
						</div>
						{s.type === "title" || s.type === "summary" ? (
							<div className="ml-5 flex flex-col gap-1">
								{s.type === "title" ? (
									<span className="text-sm font-semibold text-white/80">{s.label}</span>
								) : (
									<span className="text-xs text-white/60 line-clamp-3">{s.label}</span>
								)}
								<span className="text-[9px] text-white/25 italic">Click Accept to copy to clipboard</span>
							</div>
						) : (
							<span className="text-[10px] text-white/30 ml-5">
								{formatMs(s.startMs)}
								{s.endMs !== s.startMs ? ` - ${formatMs(s.endMs)}` : ""}
								{s.word ? ` "${s.word}"` : ""}
							</span>
						)}
						<div className="flex items-center gap-1 ml-5">
							<span className="text-[9px] text-white/20 mr-1 uppercase tracking-wider">
								{typeIcon[s.type]}
							</span>
						</div>
						<div className="flex gap-2 ml-5">
							<button
								type="button"
								onClick={() => {
									onAcceptSuggestion(s);
									toast.success("Suggestion accepted");
								}}
								className="inline-flex items-center gap-1 text-[10px] text-[#30D158] hover:text-[#30D158]/80 transition-colors cursor-pointer"
							>
								<Check className="w-3 h-3" />
								Accept
							</button>
							<button
								type="button"
								onClick={() => {
									onDismissSuggestion(s.id);
									toast("Suggestion dismissed");
								}}
								className="inline-flex items-center gap-1 text-[10px] text-white/30 hover:text-white/50 transition-colors cursor-pointer"
							>
								<X className="w-3 h-3" />
								Dismiss
							</button>
							<button
								type="button"
								onClick={() => {
									onJumpToTime(s.startMs);
									toast.success(`Jumped to ${formatMs(s.startMs)}`);
								}}
								className="inline-flex items-center gap-1 text-[10px] text-[#0A84FF] hover:text-[#0A84FF]/80 transition-colors cursor-pointer"
							>
								<ArrowRight className="w-3 h-3" />
								Jump
							</button>
						</div>
					</motion.div>
				))}
				<button
					type="button"
					onClick={onAnalyzeVideo}
					className="mt-2 w-full py-2 rounded-lg border border-dashed border-white/10 text-[11px] text-white/30 hover:text-white/50 hover:border-white/20 transition-colors cursor-pointer"
				>
					Re-analyze
				</button>
			</div>
		);
	};

	// ── Asset Library sub-tab renderers ──────────────────────────────────────

	const renderAssetClips = () => (
		<div className="flex flex-col gap-3">
			{/* Search input */}
			<div className="relative">
				<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
				<input
					type="text"
					value={giphyQuery}
					onChange={(e) => setGiphyQuery(e.target.value)}
					placeholder="Search Giphy clips..."
					className="w-full bg-black/40 border border-white/10 rounded-[14px] pl-9 pr-4 py-2.5 text-[12px] text-white/90 placeholder:text-white/30 outline-none focus:border-white/30 shadow-inner transition-colors"
				/>
			</div>

			{/* Loading */}
			{giphyLoading && (
				<p className="text-[10px] text-white/30 text-center py-3">Loading...</p>
			)}

			{/* Results grid */}
			{!giphyLoading && (
				<div className="grid grid-cols-2 gap-2">
					{giphyResults.map((clip) => {
						const mp4Url = clip.images.fixed_width.mp4 ?? clip.images.original.mp4;
						const thumbnailUrl = clip.images.fixed_width.url;
						const isHovered = hoveredGiphyId === clip.id;
						return (
							<button
								key={clip.id}
								type="button"
								onClick={() => handleGiphyClipClick(clip)}
								onMouseEnter={() => setHoveredGiphyId(clip.id)}
								onMouseLeave={() => setHoveredGiphyId(null)}
								className="aspect-video rounded-lg border border-white/[0.04] overflow-hidden bg-white/[0.02] cursor-pointer hover:border-white/10 transition-colors relative"
							>
								{isHovered && mp4Url ? (
									<video
										src={mp4Url}
										autoPlay
										loop
										muted
										playsInline
										className="w-full h-full object-cover"
									/>
								) : (
									<img
										src={thumbnailUrl}
										alt={clip.title}
										className="w-full h-full object-cover"
										loading="lazy"
									/>
								)}
							</button>
						);
					})}
				</div>
			)}

			{!giphyLoading && giphyError && (
				<p className="text-[10px] text-[#E0000F]/60 text-center py-4">{giphyError}</p>
			)}
			{!giphyLoading && !giphyError && giphyResults.length === 0 && (
				<p className="text-[10px] text-white/30 text-center py-4">No results found.</p>
			)}
		</div>
	);

	const renderAssetStickers = () => (
		<div className="grid grid-cols-5 gap-2">
			{STICKER_EMOJIS.map((emoji, idx) => (
				<button
					key={idx}
					type="button"
					onClick={() => {
						if (onAddStickerAnnotation) {
							onAddStickerAnnotation(emoji);
							toast.success(`Sticker "${emoji}" added as annotation overlay`);
						} else {
							toast.error("No video loaded to add sticker to");
						}
					}}
					className="w-10 h-10 flex items-center justify-center rounded-lg bg-white/[0.02] hover:bg-white/[0.06] cursor-pointer transition-colors text-lg"
				>
					{emoji}
				</button>
			))}
		</div>
	);

	const handleSoundEffectClick = useCallback(
		(sfxId: string) => {
			const id = sfxId as SoundEffectId;
			// Preview the sound
			previewSoundEffect(id).catch(() => {});
			// Add to timeline if handler is available
			if (onAddSoundEffect) {
				onAddSoundEffect(id);
			}
		},
		[onAddSoundEffect],
	);

	const renderAssetSounds = () => (
		<div className="flex flex-col gap-1">
			{SOUND_EFFECTS.map((sfx) => (
				<button
					key={sfx.id}
					type="button"
					onClick={() => handleSoundEffectClick(sfx.id)}
					className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer w-full text-left group"
				>
					<Play className="w-3 h-3 text-white/30 group-hover:text-white/60 flex-shrink-0 transition-colors" />
					<span className="text-[11px] text-white/60 flex-1">{sfx.name}</span>
					<span className="text-[10px] text-white/25">{sfx.duration}</span>
				</button>
			))}
		</div>
	);

	const handleTransitionClick = useCallback(
		(trId: string) => {
			const typeMap: Record<string, TransitionType> = {
				"tr-crossfade": "crossfade",
				"tr-wipe-left": "wipe-left",
				"tr-wipe-right": "wipe-right",
				"tr-zoom-in": "zoom-in",
				"tr-zoom-out": "zoom-out",
				"tr-dissolve": "dissolve",
			};
			const transitionType = typeMap[trId];
			if (transitionType && onAddTransition) {
				onAddTransition(transitionType);
			} else if (!onAddTransition) {
				toast.error("No video loaded — add a video first to use transitions");
			}
		},
		[onAddTransition],
	);

	const renderAssetTransitions = () => (
		<div className="flex flex-col gap-1">
			{TRANSITIONS.map((tr) => (
				<button
					key={tr.id}
					type="button"
					onClick={() => handleTransitionClick(tr.id)}
					className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer w-full text-left group"
				>
					<ArrowRightLeft className="w-3 h-3 text-white/30 group-hover:text-white/60 flex-shrink-0 transition-colors" />
					<span className="text-[11px] text-white/60">{tr.name}</span>
				</button>
			))}
		</div>
	);

	const renderAssets = () => (
		<div className="flex flex-col gap-3">
			{/* Sub-tab bar */}
			<div className="flex gap-0.5 bg-white/[0.03] rounded-lg p-0.5">
				{ASSET_SUB_TABS.map((tab) => (
					<button
						key={tab.id}
						type="button"
						onClick={() => setAssetSubTab(tab.id)}
						className={`flex-1 py-1.5 text-[10px] rounded-md transition-colors cursor-pointer ${
							assetSubTab === tab.id
								? "bg-white/[0.08] text-white/70"
								: "text-white/30 hover:text-white/50"
						}`}
					>
						{tab.label}
					</button>
				))}
			</div>

			{/* Sub-tab content */}
			{assetSubTab === "clips" && renderAssetClips()}
			{assetSubTab === "stickers" && renderAssetStickers()}
			{assetSubTab === "sounds" && renderAssetSounds()}
			{assetSubTab === "transitions" && renderAssetTransitions()}
		</div>
	);

	// ── Scratch Pad ─────────────────────────────────────────────────────────

	const renderScratchPad = () => (
		<div className="flex flex-col gap-3 h-full">
			{/* Scratch pad clips */}
			<div className="flex-1 overflow-y-auto flex flex-col gap-2">
				{scratchPadClips.length === 0 && (
					<p className="text-[11px] text-white/30 text-center py-4">
						No clips in scratch pad yet. Add clips from the Asset Library or cut clips from the timeline.
					</p>
				)}
				{scratchPadClips.map((clip, idx) => {
					const borderColor = SCRATCH_PAD_COLORS[idx % SCRATCH_PAD_COLORS.length];
					return (
						<div
							key={clip.id}
							className="rounded-lg bg-white/[0.04] p-2.5 flex flex-col gap-2"
							style={{ borderLeft: `3px solid ${borderColor}` }}
						>
							{/* Thumbnail preview */}
							{clip.thumbnailUrl && (
								<div className="aspect-video rounded-md overflow-hidden bg-white/[0.02]">
									{clip.mp4Url ? (
										<video
											src={clip.mp4Url}
											muted
											loop
											playsInline
											className="w-full h-full object-cover"
											onMouseEnter={(e) => (e.currentTarget).play()}
											onMouseLeave={(e) => {
												const vid = e.currentTarget;
												vid.pause();
												vid.currentTime = 0;
											}}
										/>
									) : (
										<img
											src={clip.thumbnailUrl}
											alt={clip.label}
											className="w-full h-full object-cover"
										/>
									)}
								</div>
							)}
							<div className="flex items-center justify-between">
								<div className="flex flex-col min-w-0">
									<span className="text-[11px] text-white/60 truncate">
										{clip.label}
									</span>
									<span className="text-[10px] text-white/25">
										{formatMs(clip.durationMs)}
									</span>
								</div>
								<div className="flex gap-1 flex-shrink-0">
									<button
										type="button"
										onClick={() => handleRestoreScratchPadClip(clip.id)}
										title="Restore to timeline"
										className="p-1.5 rounded-md hover:bg-white/[0.06] text-white/30 hover:text-[#30D158] transition-colors cursor-pointer"
									>
										<RotateCcw className="w-3 h-3" />
									</button>
									<button
										type="button"
										onClick={() => handleRemoveScratchPadClip(clip.id)}
										title="Delete"
										className="p-1.5 rounded-md hover:bg-white/[0.06] text-white/30 hover:text-[#E0000F] transition-colors cursor-pointer"
									>
										<Trash2 className="w-3 h-3" />
									</button>
								</div>
							</div>
						</div>
					);
				})}
			</div>

			{/* Drop zone */}
			<div className="w-full border-2 border-dashed border-white/10 rounded-xl py-6 flex items-center justify-center mt-auto flex-shrink-0">
				<span className="text-[11px] text-white/25">Drag clips here to park them</span>
			</div>
		</div>
	);

	const renderNotes = () => (
		<div className="flex flex-col gap-2 h-full">
			<div className="flex-1 overflow-y-auto flex flex-col gap-2">
				{notes.length === 0 && (
					<p className="text-[11px] text-white/30 text-center py-4">
						No notes yet. Type below and press Enter to add a note at the current timestamp.
					</p>
				)}
				{notes.map((note) => (
					<div
						key={note.id}
						onClick={() => {
							onJumpToTime(note.timeMs);
							toast.success(`Jumped to ${formatMs(note.timeMs)}`);
						}}
						className="flex items-start gap-2 rounded-lg bg-white/[0.04] p-2 group cursor-pointer hover:bg-white/[0.06] transition-colors"
					>
						<div
							className="w-[3px] rounded-full self-stretch flex-shrink-0"
							style={{ backgroundColor: note.color }}
						/>
						<div className="flex-1 min-w-0">
							<span className="text-[10px] text-white/30 block">
								{formatMs(note.timeMs)}
							</span>
							<span className="text-[11px] text-white/60 break-words">
								{note.text}
							</span>
						</div>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								removeNote(note.id);
								toast("Note deleted");
							}}
							className="text-white/20 hover:text-white/50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-pointer"
						>
							<X className="w-3 h-3" />
						</button>
					</div>
				))}
			</div>
			{/* Add note input */}
			<div className="flex flex-col gap-3 mt-auto pt-4 border-t border-white/[0.04]">
				<div className="flex gap-1">
					{NOTE_COLORS.map((c) => (
						<button
							key={c}
							type="button"
							onClick={() => setNoteColor(c)}
							className="w-4 h-4 rounded-full border-2 transition-colors cursor-pointer"
							style={{
								backgroundColor: c,
								borderColor: noteColor === c ? "white" : "transparent",
							}}
						/>
					))}
				</div>
				<div className="flex gap-2">
					<input
						ref={noteInputRef}
						type="text"
						value={noteInput}
						onChange={(e) => setNoteInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") addNote();
						}}
						placeholder={`Note at ${formatMs(currentTime * 1000)}...`}
						className="flex-1 bg-black/40 border border-white/10 rounded-[14px] px-3 py-2 text-[12px] text-white/90 placeholder:text-white/30 outline-none focus:border-white/30 shadow-inner transition-colors"
					/>
					<button
						type="button"
						onClick={addNote}
						disabled={!noteInput.trim()}
						className="px-4 py-2 rounded-[12px] bg-white/10 text-[12px] font-bold text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer border border-white/10 shadow-sm"
					>
						Add
					</button>
				</div>
			</div>
		</div>
	);

	const renderComments = () => (
		<CommentsPanel
			comments={timelineComments}
			currentTimeMs={currentTime * 1000}
			onAddComment={onAddComment}
			onDeleteComment={onDeleteComment}
			onSeek={onSeekToComment}
		/>
	);

	const panelContentMap: Record<WorkspacePanel, () => React.ReactNode> = {
		clips: renderClips,
		history: renderHistory,
		ai: renderAI,
		assets: renderAssets,
		scratchpad: renderScratchPad,
		notes: renderNotes,
		comments: renderComments,
	};

	const activePanelConfig = activePanel
		? PANELS.find((p) => p.id === activePanel)
		: null;

	return (
		<div className="absolute left-6 top-1/2 -translate-y-1/2 flex items-start h-[80vh] flex-shrink-0 z-50 pointer-events-none">
			{/* Icon dock */}
			<div
				className="flex flex-col items-center py-4 gap-2 flex-shrink-0 relative z-50 pointer-events-auto rounded-[24px]"
				style={{
					width: 64,
					background: "rgba(18,18,20,0.65)",
					backdropFilter: "blur(40px)",
					WebkitBackdropFilter: "blur(40px)",
					border: "1px solid rgba(255,255,255,0.08)",
					boxShadow: "0 20px 50px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1)",
				}}
			>
				{PANELS.map((panel) => {
					const Icon = panel.icon;
					const isActive = activePanel === panel.id;
					return (
						<button
							key={panel.id}
							type="button"
							title={panel.label}
							onClick={() => togglePanel(panel.id)}
							className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-300 cursor-pointer relative group ${
								isActive
									? "text-white/90 bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] scale-95"
									: "text-white/30 hover:text-white/70 hover:bg-white/[0.03] hover:scale-105"
							}`}
						>
							{isActive && (
								<div
									className="absolute left-1 top-1/2 -translate-y-1/2 w-[4px] h-[16px] rounded-full bg-[#E0000F] shadow-[0_0_12px_rgba(224,0,15,0.9)]"
								/>
							)}
							<Icon className="w-4 h-4" />
						</button>
					);
				})}
			</div>

			{/* Sliding panel */}
			<div
				className="flex-shrink-0 relative z-40 pointer-events-auto ml-4"
				style={{
					width: activePanel ? 340 : 0,
					opacity: activePanel ? 1 : 0,
					transform: activePanel ? "translateX(0) scale(1)" : "translateX(-20px) scale(0.95)",
					transition: "all 400ms cubic-bezier(0.16, 1, 0.3, 1)",
					pointerEvents: activePanel ? "auto" : "none",
				}}
			>
				<div
					className="h-full flex flex-col relative rounded-[24px] overflow-hidden"
					style={{
						width: 340,
						background: "rgba(18,18,20,0.85)",
						backdropFilter: "blur(40px)",
						WebkitBackdropFilter: "blur(40px)",
						border: "1px solid rgba(255,255,255,0.08)",
						boxShadow: "0 30px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)",
					}}
				>
					{activePanelConfig && (
						<>
							{/* Header */}
							<div className="flex items-center justify-between px-6 pt-5 pb-4 flex-shrink-0">
								<h2 className="text-[24px] font-semibold tracking-tight text-white/90 font-sans">
									{activePanelConfig.label}
								</h2>
								<button
									type="button"
									onClick={() => onPanelChange(null)}
									className="text-white/20 hover:text-white/50 transition-colors cursor-pointer"
								>
									<X className="w-3.5 h-3.5" />
								</button>
							</div>
							{/* Content */}
							<AnimatePresence mode="wait">
								<motion.div
									key={activePanelConfig.id}
									initial={{ opacity: 0, x: 10 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: -10 }}
									transition={{ duration: 0.15 }}
									className="flex-1 overflow-y-auto px-3 pb-3"
								>
									{panelContentMap[activePanelConfig.id]()}
								</motion.div>
							</AnimatePresence>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

// ── Snapshot description helper ────────────────────────────────────────────────

function describeSnapshot(snap: EditorHistorySnapshot): string {
	const parts: string[] = [];
	if (snap.zoomRegions.length > 0) parts.push(`${snap.zoomRegions.length} zoom`);
	if (snap.trimRegions.length > 0) parts.push(`${snap.trimRegions.length} trim`);
	if (snap.speedRegions.length > 0) parts.push(`${snap.speedRegions.length} speed`);
	if (snap.annotationRegions.length > 0)
		parts.push(`${snap.annotationRegions.length} annotation`);
	if (snap.audioRegions.length > 0) parts.push(`${snap.audioRegions.length} audio`);
	return parts.length > 0 ? parts.join(", ") : "Initial state";
}

import {
	Clipboard,
	History,
	LayoutGrid,
	MessageSquare,
	Music,
	Sparkles,
	X,
} from "lucide-react";
import { type MutableRefObject, useCallback, useRef, useState } from "react";
import type { TrimRegion } from "./types";

// ── Types ──────────────────────────────────────────────────────────────────────

export type WorkspacePanel =
	| "clips"
	| "history"
	| "ai"
	| "assets"
	| "scratchpad"
	| "notes";

export interface WorkspaceNote {
	id: string;
	timeMs: number;
	text: string;
	color: string;
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
	notes: WorkspaceNote[];
	onNotesChange: (notes: WorkspaceNote[]) => void;
	currentTime: number;
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
];

const AI_SUGGESTIONS = [
	{ id: "s1", label: "Remove silence", detail: "0:45 - 0:52", timeMs: 45000 },
	{ id: "s2", label: "Filler word detected", detail: "at 0:33", timeMs: 33000 },
	{ id: "s3", label: "Best moment", detail: "1:23", timeMs: 83000 },
];

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
	notes,
	onNotesChange,
	currentTime,
}: CreativeWorkspaceProps) {
	const [noteInput, setNoteInput] = useState("");
	const [noteColor, setNoteColor] = useState(NOTE_COLORS[0]);
	const noteInputRef = useRef<HTMLInputElement>(null);

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
					No clipped segments yet.
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
						onClick={() => onRestoreFromFloor(clip.id)}
						className="text-[10px] text-[#E0000F] hover:text-[#FF4500] transition-colors cursor-pointer"
					>
						Restore
					</button>
				</div>
			))}
			<button
				type="button"
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
					No history yet.
				</p>
			);
		}
		return (
			<div className="flex flex-col gap-1">
				{[...snapshots].reverse().map((snap, idx) => {
					const label = describeSnapshot(snap);
					return (
						<div
							key={idx}
							className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer"
						>
							<span className="text-[11px] text-white/60 truncate max-w-[180px]">
								{label}
							</span>
							<span className="text-[10px] text-white/25 flex-shrink-0 ml-2">
								{relativeTime(snapshots.length - 1 - idx, snapshots.length)}
							</span>
						</div>
					);
				})}
			</div>
		);
	};

	const renderAI = () => (
		<div className="flex flex-col gap-2">
			{AI_SUGGESTIONS.map((s) => (
				<div
					key={s.id}
					className="rounded-lg bg-white/[0.04] p-3 flex flex-col gap-2"
				>
					<div className="flex items-center gap-2">
						<Sparkles className="w-3 h-3 text-[#BF5AF2] flex-shrink-0" />
						<span className="text-[11px] text-white/70">{s.label}</span>
					</div>
					<span className="text-[10px] text-white/30 ml-5">{s.detail}</span>
					<div className="flex gap-2 ml-5">
						<button
							type="button"
							className="text-[10px] text-[#30D158] hover:text-[#30D158]/80 transition-colors cursor-pointer"
						>
							Accept
						</button>
						<button
							type="button"
							className="text-[10px] text-white/30 hover:text-white/50 transition-colors cursor-pointer"
						>
							Dismiss
						</button>
						<button
							type="button"
							className="text-[10px] text-[#0A84FF] hover:text-[#0A84FF]/80 transition-colors cursor-pointer"
						>
							Jump
						</button>
					</div>
				</div>
			))}
			<p className="text-[10px] text-white/20 text-center mt-2">
				Will connect to Whisper soon
			</p>
		</div>
	);

	const renderAssets = () => (
		<div className="grid grid-cols-4 gap-2">
			{Array.from({ length: 16 }).map((_, i) => (
				<div
					key={i}
					className="aspect-square rounded-md bg-white/[0.04] border border-white/[0.04]"
				/>
			))}
		</div>
	);

	const renderScratchPad = () => (
		<div className="flex flex-col items-center justify-center py-8">
			<div className="w-full border-2 border-dashed border-white/10 rounded-xl py-10 flex items-center justify-center">
				<span className="text-[12px] text-white/25">Drop clips here</span>
			</div>
		</div>
	);

	const renderNotes = () => (
		<div className="flex flex-col gap-2 h-full">
			<div className="flex-1 overflow-y-auto flex flex-col gap-2">
				{notes.length === 0 && (
					<p className="text-[11px] text-white/30 text-center py-4">
						No notes yet.
					</p>
				)}
				{notes.map((note) => (
					<div
						key={note.id}
						className="flex items-start gap-2 rounded-lg bg-white/[0.04] p-2 group"
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
							onClick={() => removeNote(note.id)}
							className="text-white/20 hover:text-white/50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-pointer"
						>
							<X className="w-3 h-3" />
						</button>
					</div>
				))}
			</div>
			{/* Add note input */}
			<div className="flex flex-col gap-1.5 mt-auto pt-2 border-t border-white/[0.04]">
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
				<div className="flex gap-1.5">
					<input
						ref={noteInputRef}
						type="text"
						value={noteInput}
						onChange={(e) => setNoteInput(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") addNote();
						}}
						placeholder={`Note at ${formatMs(currentTime * 1000)}...`}
						className="flex-1 bg-white/[0.04] border border-white/[0.06] rounded-md px-2 py-1.5 text-[11px] text-white/70 placeholder:text-white/20 outline-none focus:border-white/15"
					/>
					<button
						type="button"
						onClick={addNote}
						disabled={!noteInput.trim()}
						className="px-2 py-1.5 rounded-md bg-white/[0.06] text-[11px] text-white/50 hover:text-white/80 disabled:opacity-30 transition-colors cursor-pointer"
					>
						Add
					</button>
				</div>
			</div>
		</div>
	);

	const panelContentMap: Record<WorkspacePanel, () => React.ReactNode> = {
		clips: renderClips,
		history: renderHistory,
		ai: renderAI,
		assets: renderAssets,
		scratchpad: renderScratchPad,
		notes: renderNotes,
	};

	const activePanelConfig = activePanel
		? PANELS.find((p) => p.id === activePanel)
		: null;

	return (
		<div className="flex h-full flex-shrink-0">
			{/* Icon dock */}
			<div
				className="flex flex-col items-center pt-3 gap-1 flex-shrink-0"
				style={{
					width: 44,
					borderRight: "1px solid rgba(255,255,255,0.04)",
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
							className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer relative ${
								isActive
									? "text-white/60 bg-white/[0.06]"
									: "text-white/20 hover:text-white/40"
							}`}
						>
							{isActive && (
								<div
									className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r-full bg-[#E0000F]"
								/>
							)}
							<Icon className="w-4 h-4" />
						</button>
					);
				})}
			</div>

			{/* Sliding panel */}
			<div
				className="overflow-hidden flex-shrink-0"
				style={{
					width: activePanel ? 280 : 0,
					transition: "width 200ms ease",
				}}
			>
				<div
					className="h-full flex flex-col"
					style={{
						width: 280,
						backgroundColor: "#111113",
						borderRight: "1px solid rgba(255,255,255,0.05)",
						transform: activePanel ? "translateX(0)" : "translateX(-280px)",
						transition: "transform 200ms ease",
					}}
				>
					{activePanelConfig && (
						<>
							{/* Header */}
							<div className="flex items-center justify-between px-4 py-3 flex-shrink-0">
								<span className="text-[8px] font-semibold uppercase tracking-[0.15em] text-white/40">
									{activePanelConfig.label}
								</span>
								<button
									type="button"
									onClick={() => onPanelChange(null)}
									className="text-white/20 hover:text-white/50 transition-colors cursor-pointer"
								>
									<X className="w-3.5 h-3.5" />
								</button>
							</div>
							{/* Content */}
							<div className="flex-1 overflow-y-auto px-3 pb-3">
								{panelContentMap[activePanelConfig.id]()}
							</div>
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

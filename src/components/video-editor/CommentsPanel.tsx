import { MessageSquare, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { TimelineComment } from "./types";

const COMMENT_COLORS = [
	{ value: "#E0000F", label: "Red" },
	{ value: "#FF9500", label: "Yellow" },
	{ value: "#30D158", label: "Green" },
	{ value: "#0A84FF", label: "Blue" },
	{ value: "#BF5AF2", label: "Purple" },
];

function formatMs(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

interface CommentsPanelProps {
	comments: TimelineComment[];
	currentTimeMs: number;
	onAddComment: (comment: TimelineComment) => void;
	onDeleteComment: (id: string) => void;
	onSeek: (timeMs: number) => void;
}

export function CommentsPanel({
	comments,
	currentTimeMs,
	onAddComment,
	onDeleteComment,
	onSeek,
}: CommentsPanelProps) {
	const [inputText, setInputText] = useState("");
	const [selectedColor, setSelectedColor] = useState(COMMENT_COLORS[3].value);
	const inputRef = useRef<HTMLInputElement>(null);

	const sortedComments = [...comments].sort((a, b) => a.timeMs - b.timeMs);

	const handleAdd = useCallback(() => {
		const text = inputText.trim();
		if (!text) return;

		const comment: TimelineComment = {
			id: `comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
			timeMs: currentTimeMs,
			text,
			createdAt: Date.now(),
			color: selectedColor,
		};

		onAddComment(comment);
		setInputText("");
		toast.success(`Comment added at ${formatMs(currentTimeMs)}`);
		inputRef.current?.focus();
	}, [inputText, currentTimeMs, selectedColor, onAddComment]);

	return (
		<div className="flex flex-col gap-2 h-full">
			{/* Header */}
			<div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
				<MessageSquare className="w-3.5 h-3.5 text-white/40" />
				<span className="text-[11px] font-medium text-white/50">
					{comments.length} comment{comments.length !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Comment list */}
			<div className="flex-1 overflow-y-auto flex flex-col gap-2">
				{sortedComments.length === 0 && (
					<p className="text-[11px] text-white/30 text-center py-4">
						No comments yet. Add a comment at the current timestamp below.
					</p>
				)}
				{sortedComments.map((comment) => (
					<div
						key={comment.id}
						onClick={() => {
							onSeek(comment.timeMs);
						}}
						className="flex items-start gap-2 rounded-lg bg-white/[0.04] p-2 group cursor-pointer hover:bg-white/[0.06] transition-colors"
					>
						<div
							className="w-0 h-0 flex-shrink-0 mt-1"
							style={{
								borderLeft: "4px solid transparent",
								borderRight: "4px solid transparent",
								borderBottom: `7px solid ${comment.color || "#0A84FF"}`,
							}}
						/>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-1.5">
								<span className="text-[10px] text-white/30">
									{formatMs(comment.timeMs)}
								</span>
								{comment.author && (
									<span className="text-[9px] text-white/20">
										{comment.author}
									</span>
								)}
							</div>
							<span className="text-[11px] text-white/60 break-words">
								{comment.text}
							</span>
						</div>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onDeleteComment(comment.id);
								toast("Comment deleted");
							}}
							className="text-white/20 hover:text-white/50 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-pointer"
						>
							<Trash2 className="w-3 h-3" />
						</button>
					</div>
				))}
			</div>

			{/* Add comment input */}
			<div className="flex flex-col gap-3 mt-auto pt-4 border-t border-white/[0.04]">
				<div className="flex gap-1">
					{COMMENT_COLORS.map((c) => (
						<button
							key={c.value}
							type="button"
							onClick={() => setSelectedColor(c.value)}
							title={c.label}
							className="w-4 h-4 rounded-full border-2 transition-colors cursor-pointer"
							style={{
								backgroundColor: c.value,
								borderColor: selectedColor === c.value ? "white" : "transparent",
							}}
						/>
					))}
				</div>
				<div className="flex gap-2">
					<input
						ref={inputRef}
						type="text"
						value={inputText}
						onChange={(e) => setInputText(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") handleAdd();
						}}
						placeholder={`Comment at ${formatMs(currentTimeMs)}...`}
						className="flex-1 bg-black/40 border border-white/10 rounded-[14px] px-3 py-2 text-[12px] text-white/90 placeholder:text-white/30 outline-none focus:border-white/30 shadow-inner transition-colors"
					/>
					<button
						type="button"
						onClick={handleAdd}
						disabled={!inputText.trim()}
						className="px-4 py-2 rounded-[12px] bg-white/10 text-[12px] font-bold text-white/70 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer border border-white/10 shadow-sm"
					>
						Add
					</button>
				</div>
			</div>
		</div>
	);
}

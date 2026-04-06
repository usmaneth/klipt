import { motion, AnimatePresence } from "framer-motion";
import {
	ChevronDown,
	FolderPlus,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
	Project,
	RecordingEntry,
	Workspace,
} from "@/lib/workspace/workspaceManager";

// ── Types ──────────────────────────────────────────────────────────────────

interface WorkspaceSidebarProps {
	workspaces: Workspace[];
	projects: Project[];
	recordings: RecordingEntry[];
	activeWorkspaceId: string | null;
	activeProjectId: string | null;
	onSelectWorkspace: (id: string | null) => void;
	onSelectProject: (id: string | null) => void;
	onCreateWorkspace: (name: string, icon: string) => void;
	onDeleteWorkspace: (id: string) => void;
	onCreateProject: (workspaceId: string, name: string, color: string) => void;
	onDeleteProject: (id: string) => void;
	onOpenRecording: (rec: RecordingEntry) => void;
	onDeleteRecording: (id: string) => void;
	onSearch: (query: string) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────

const PROJECT_COLORS = ["#E0000F", "#FF9500", "#30D158", "#0A84FF", "#BF5AF2", "#FF375F", "#FFD60A", "#06b6d4"];
const WORKSPACE_ICONS = ["📁", "🎬", "💼", "🚀", "🎨", "📱", "💡", "🏢"];

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	const m = Math.floor(s / 60);
	const sec = s % 60;
	return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatRelativeDate(ts: number): string {
	const diff = Date.now() - ts;
	const mins = Math.floor(diff / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 30) return `${days}d ago`;
	return new Date(ts).toLocaleDateString();
}

// ── Component ──────────────────────────────────────────────────────────────

export function WorkspaceSidebar({
	workspaces,
	projects,
	recordings,
	activeWorkspaceId,
	activeProjectId,
	onSelectWorkspace,
	onSelectProject,
	onCreateWorkspace,
	onDeleteWorkspace,
	onCreateProject,
	onDeleteProject,
	onOpenRecording,
	onDeleteRecording,
	onSearch,
}: WorkspaceSidebarProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [showNewWorkspace, setShowNewWorkspace] = useState(false);
	const [newWsName, setNewWsName] = useState("");
	const [newWsIcon, setNewWsIcon] = useState("📁");
	const [showNewProject, setShowNewProject] = useState(false);
	const [newProjName, setNewProjName] = useState("");
	const [newProjColor, setNewProjColor] = useState(PROJECT_COLORS[0]);
	const [wsDropdownOpen, setWsDropdownOpen] = useState(false);

	const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);
	const filteredProjects = useMemo(
		() => (activeWorkspaceId ? projects.filter((p) => p.workspaceId === activeWorkspaceId) : projects),
		[projects, activeWorkspaceId],
	);

	const recordingsByProject = useMemo(() => {
		const map = new Map<string | null, RecordingEntry[]>();
		for (const rec of recordings) {
			const key = rec.projectId;
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(rec);
		}
		return map;
	}, [recordings]);

	useEffect(() => {
		onSearch(searchQuery);
	}, [searchQuery, onSearch]);

	const handleCreateWorkspace = useCallback(() => {
		if (!newWsName.trim()) return;
		onCreateWorkspace(newWsName.trim(), newWsIcon);
		setNewWsName("");
		setShowNewWorkspace(false);
	}, [newWsName, newWsIcon, onCreateWorkspace]);

	const handleCreateProject = useCallback(() => {
		if (!newProjName.trim() || !activeWorkspaceId) return;
		onCreateProject(activeWorkspaceId, newProjName.trim(), newProjColor);
		setNewProjName("");
		setShowNewProject(false);
	}, [newProjName, newProjColor, activeWorkspaceId, onCreateProject]);

	return (
		<div
			className="h-full flex flex-col"
			style={{
				background: "rgba(18,18,20,0.95)",
				borderRight: "1px solid rgba(255,255,255,0.06)",
				width: 280,
			}}
		>
			{/* Search */}
			<div className="p-3">
				<div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06]">
					<Search className="w-4 h-4 text-white/30" />
					<input
						type="text"
						placeholder="Search recordings..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="bg-transparent text-sm text-white/80 placeholder:text-white/30 outline-none flex-1"
					/>
				</div>
			</div>

			{/* Workspace Switcher */}
			<div className="px-3 pb-2">
				<button
					type="button"
					onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
					className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
				>
					<span className="text-sm text-white/80">
						{activeWorkspace ? `${activeWorkspace.icon} ${activeWorkspace.name}` : "All Workspaces"}
					</span>
					<ChevronDown className={`w-4 h-4 text-white/40 transition-transform ${wsDropdownOpen ? "rotate-180" : ""}`} />
				</button>

				<AnimatePresence>
					{wsDropdownOpen && (
						<motion.div
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							className="mt-1 rounded-xl bg-black/60 border border-white/[0.08] overflow-hidden"
						>
							<button
								type="button"
								onClick={() => { onSelectWorkspace(null); setWsDropdownOpen(false); }}
								className="w-full text-left px-3 py-2 text-sm text-white/60 hover:bg-white/[0.06] transition-colors"
							>
								All Workspaces
							</button>
							{workspaces.map((ws) => (
								<div key={ws.id} className="flex items-center justify-between px-3 py-2 hover:bg-white/[0.06] transition-colors group">
									<button
										type="button"
										onClick={() => { onSelectWorkspace(ws.id); setWsDropdownOpen(false); }}
										className="text-sm text-white/80 flex-1 text-left"
									>
										{ws.icon} {ws.name}
									</button>
									<button
										type="button"
										onClick={() => onDeleteWorkspace(ws.id)}
										className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all"
									>
										<Trash2 className="w-3 h-3 text-white/40" />
									</button>
								</div>
							))}
							<button
								type="button"
								onClick={() => { setShowNewWorkspace(true); setWsDropdownOpen(false); }}
								className="w-full text-left px-3 py-2 text-sm text-white/40 hover:text-white/60 hover:bg-white/[0.06] transition-colors flex items-center gap-2"
							>
								<Plus className="w-3 h-3" /> New Workspace
							</button>
						</motion.div>
					)}
				</AnimatePresence>

				{/* New Workspace Form */}
				<AnimatePresence>
					{showNewWorkspace && (
						<motion.div
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							className="mt-2 p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]"
						>
							<div className="flex gap-2 mb-2">
								{WORKSPACE_ICONS.map((icon) => (
									<button
										key={icon}
										type="button"
										onClick={() => setNewWsIcon(icon)}
										className={`text-lg p-1 rounded ${newWsIcon === icon ? "bg-white/20" : "hover:bg-white/10"}`}
									>
										{icon}
									</button>
								))}
							</div>
							<input
								type="text"
								placeholder="Workspace name"
								value={newWsName}
								onChange={(e) => setNewWsName(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleCreateWorkspace()}
								className="w-full px-3 py-2 rounded-lg bg-black/30 text-sm text-white/80 placeholder:text-white/30 outline-none border border-white/[0.06] mb-2"
							/>
							<div className="flex gap-2">
								<button type="button" onClick={handleCreateWorkspace} className="px-3 py-1 rounded-lg bg-[#E0000F] text-white text-xs font-medium">Create</button>
								<button type="button" onClick={() => setShowNewWorkspace(false)} className="px-3 py-1 rounded-lg bg-white/10 text-white/60 text-xs">Cancel</button>
							</div>
						</motion.div>
					)}
				</AnimatePresence>
			</div>

			{/* Projects */}
			<div className="flex-1 overflow-y-auto px-3">
				<div className="flex items-center justify-between mb-2">
					<span className="text-xs font-medium text-white/40 uppercase tracking-wider">Projects</span>
					{activeWorkspaceId && (
						<button type="button" onClick={() => setShowNewProject(true)} className="p-1 hover:bg-white/10 rounded transition-colors">
							<FolderPlus className="w-3.5 h-3.5 text-white/40" />
						</button>
					)}
				</div>

				{/* New Project Form */}
				<AnimatePresence>
					{showNewProject && (
						<motion.div
							initial={{ opacity: 0, height: 0 }}
							animate={{ opacity: 1, height: "auto" }}
							exit={{ opacity: 0, height: 0 }}
							className="mb-2 p-3 rounded-xl bg-white/[0.04] border border-white/[0.08]"
						>
							<div className="flex gap-1.5 mb-2">
								{PROJECT_COLORS.map((c) => (
									<button
										key={c}
										type="button"
										onClick={() => setNewProjColor(c)}
										className={`w-5 h-5 rounded-full border-2 ${newProjColor === c ? "border-white" : "border-transparent"}`}
										style={{ backgroundColor: c }}
									/>
								))}
							</div>
							<input
								type="text"
								placeholder="Project name"
								value={newProjName}
								onChange={(e) => setNewProjName(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
								className="w-full px-3 py-2 rounded-lg bg-black/30 text-sm text-white/80 placeholder:text-white/30 outline-none border border-white/[0.06] mb-2"
							/>
							<div className="flex gap-2">
								<button type="button" onClick={handleCreateProject} className="px-3 py-1 rounded-lg bg-[#E0000F] text-white text-xs font-medium">Create</button>
								<button type="button" onClick={() => setShowNewProject(false)} className="px-3 py-1 rounded-lg bg-white/10 text-white/60 text-xs">Cancel</button>
							</div>
						</motion.div>
					)}
				</AnimatePresence>

				{/* All Recordings (unassigned) */}
				<button
					type="button"
					onClick={() => onSelectProject(null)}
					className={`w-full text-left px-3 py-2 rounded-xl mb-1 text-sm transition-colors ${
						activeProjectId === null ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.04]"
					}`}
				>
					All Recordings
					<span className="ml-2 text-xs text-white/30">{recordings.length}</span>
				</button>

				{/* Project List */}
				{filteredProjects.map((proj) => {
					const count = recordingsByProject.get(proj.id)?.length ?? 0;
					return (
						<div key={proj.id} className="group">
							<button
								type="button"
								onClick={() => onSelectProject(proj.id)}
								className={`w-full text-left px-3 py-2 rounded-xl mb-1 text-sm flex items-center gap-2 transition-colors ${
									activeProjectId === proj.id ? "bg-white/[0.08] text-white" : "text-white/60 hover:bg-white/[0.04]"
								}`}
							>
								<div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: proj.color }} />
								<span className="flex-1 truncate">{proj.name}</span>
								<span className="text-xs text-white/30">{count}</span>
								<button
									type="button"
									onClick={(e) => { e.stopPropagation(); onDeleteProject(proj.id); }}
									className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all"
								>
									<Trash2 className="w-3 h-3 text-white/40" />
								</button>
							</button>
						</div>
					);
				})}
			</div>

			{/* Recording List */}
			<div className="flex-1 overflow-y-auto px-3 border-t border-white/[0.06] pt-3">
				<span className="text-xs font-medium text-white/40 uppercase tracking-wider mb-2 block">Recordings</span>
				{(activeProjectId !== null
					? recordings.filter((r) => r.projectId === activeProjectId)
					: recordings
				).map((rec) => (
					<motion.div
						key={rec.id}
						layout
						className="group mb-2 p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.04] cursor-pointer transition-colors"
						onClick={() => onOpenRecording(rec)}
					>
						<div className="flex items-start justify-between">
							<div className="flex-1 min-w-0">
								<p className="text-sm text-white/80 truncate">{rec.title}</p>
								<div className="flex items-center gap-2 mt-1">
									<span className="text-xs text-white/30 tabular-nums">{formatDuration(rec.durationMs)}</span>
									<span className="text-xs text-white/20">·</span>
									<span className="text-xs text-white/30">{formatRelativeDate(rec.createdAt)}</span>
								</div>
								{rec.tags.length > 0 && (
									<div className="flex gap-1 mt-1.5 flex-wrap">
										{rec.tags.slice(0, 3).map((tag) => (
											<span key={tag} className="px-1.5 py-0.5 rounded text-[10px] bg-white/[0.06] text-white/40">{tag}</span>
										))}
									</div>
								)}
							</div>
							<button
								type="button"
								onClick={(e) => { e.stopPropagation(); onDeleteRecording(rec.id); }}
								className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all ml-2"
							>
								<Trash2 className="w-3.5 h-3.5 text-white/40" />
							</button>
						</div>
					</motion.div>
				))}
			</div>
		</div>
	);
}

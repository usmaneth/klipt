import { AnimatePresence, motion } from "framer-motion";
import { FolderOpen, X } from "lucide-react";
import { useEffect, useState } from "react";

interface RecentProject {
	name: string;
	path: string;
	mtime: number;
}

interface ProjectBrowserProps {
	isOpen: boolean;
	onClose: () => void;
	onOpenProject: (path: string) => void;
	currentProjectPath: string | null;
}

function formatRelativeTime(mtime: number): string {
	const now = Date.now();
	const diffMs = now - mtime;
	const diffMin = Math.floor(diffMs / 60_000);
	const diffHr = Math.floor(diffMs / 3_600_000);
	const diffDays = Math.floor(diffMs / 86_400_000);

	if (diffMin < 1) return "Just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	if (diffHr < 24) return `${diffHr}h ago`;
	if (diffDays < 7) return `${diffDays}d ago`;

	return new Date(mtime).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
}

export function ProjectBrowserDialog({
	isOpen,
	onClose,
	onOpenProject,
	currentProjectPath,
}: ProjectBrowserProps) {
	const [projects, setProjects] = useState<RecentProject[]>([]);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!isOpen) return;

		let mounted = true;
		setLoading(true);

		(async () => {
			try {
				const res = await window.electronAPI?.getRecentProjects();
				if (mounted && res?.success && res.projects) {
					setProjects(res.projects.slice(0, 12));
				}
			} catch (err) {
				console.error("Failed to load recent projects:", err);
			} finally {
				if (mounted) setLoading(false);
			}
		})();

		return () => {
			mounted = false;
		};
	}, [isOpen]);

	if (!isOpen) return null;

	return (
		<AnimatePresence>
			{isOpen && (
				<>
					{/* Overlay */}
					<motion.div
						className="fixed inset-0 z-[9998] bg-black/60 backdrop-blur-sm"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.2 }}
						onClick={onClose}
					/>

					{/* Dialog */}
					<motion.div
						className="fixed left-1/2 top-1/2 z-[9999] -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[560px] max-h-[80vh] rounded-2xl bg-black/80 backdrop-blur-xl border border-white/[0.08] shadow-[0_40px_100px_rgba(0,0,0,0.7)] overflow-hidden flex flex-col"
						initial={{ opacity: 0, scale: 0.95, y: "-48%" }}
						animate={{ opacity: 1, scale: 1, y: "-50%" }}
						exit={{ opacity: 0, scale: 0.95, y: "-48%" }}
						transition={{ duration: 0.2, ease: "easeOut" }}
						style={{ left: "50%", transform: "translateX(-50%)" }}
					>
						{/* Header */}
						<div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
							<div className="flex items-center gap-2.5">
								<FolderOpen className="w-4 h-4 text-white/40" />
								<span className="text-[13px] font-semibold text-white/80 tracking-wide">
									Projects
								</span>
							</div>
							<button
								onClick={onClose}
								className="flex items-center justify-center w-7 h-7 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/[0.06] transition-all duration-150"
							>
								<X className="w-4 h-4" />
							</button>
						</div>

						{/* Content */}
						<div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
							{loading ? (
								<div className="flex items-center justify-center py-16">
									<div className="w-5 h-5 border-2 border-white/10 border-t-white/40 rounded-full animate-spin" />
								</div>
							) : projects.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-16 text-center">
									<FolderOpen className="w-10 h-10 text-white/10 mb-3" />
									<p className="text-[12px] text-white/30 font-medium">
										No recent projects
									</p>
									<p className="text-[10px] text-white/15 mt-1">
										Save a project to see it here
									</p>
								</div>
							) : (
								<div className="grid grid-cols-2 gap-3">
									{projects.map((project) => {
										const isCurrent =
											currentProjectPath != null &&
											project.path === currentProjectPath;

										return (
											<button
												key={project.path}
												onClick={() => {
													onOpenProject(project.path);
													onClose();
												}}
												className="group relative flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.12] transition-all duration-200 overflow-hidden text-left cursor-pointer"
											>
												{/* Thumbnail placeholder — 16:10 gradient */}
												<div
													className="w-full aspect-[16/10] bg-gradient-to-br from-white/[0.04] to-white/[0.01] border-b border-white/[0.04] flex items-center justify-center"
												>
													<FolderOpen className="w-6 h-6 text-white/[0.08] group-hover:text-white/[0.15] transition-colors duration-200" />
												</div>

												{/* Info */}
												<div className="px-3 py-2.5 flex flex-col gap-0.5 min-w-0">
													<span className="text-[11px] font-medium text-white/70 truncate leading-tight">
														{project.name}
													</span>
													<span className="text-[9px] text-white/25 leading-tight">
														{formatRelativeTime(project.mtime)}
													</span>
												</div>

												{/* Current badge */}
												{isCurrent && (
													<div className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-white/[0.1] border border-white/[0.1]">
														<span className="text-[8px] font-bold uppercase tracking-wider text-white/50">
															Current
														</span>
													</div>
												)}
											</button>
										);
									})}
								</div>
							)}
						</div>

						{/* Footer hint */}
						<div className="px-6 py-3 border-t border-white/[0.04] flex items-center justify-center">
							<span className="text-[9px] text-white/20">
								<kbd className="px-1 py-[1px] text-[8px] font-mono text-white/25 rounded-[3px] mr-1" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
									&#8984;P
								</kbd>
								to toggle
							</span>
						</div>
					</motion.div>
				</>
			)}
		</AnimatePresence>
	);
}

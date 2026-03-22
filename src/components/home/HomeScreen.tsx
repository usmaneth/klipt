import { useEffect, useState } from "react";
import { CircleDot, Film, FileVideo } from "lucide-react";

/** Simple relative time formatter — avoids pulling in date-fns. */
function relativeTime(timestampMs: number): string {
	const seconds = Math.floor((Date.now() - timestampMs) / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	return `${months}mo ago`;
}

export function HomeScreen() {
	const [recentProjects, setRecentProjects] = useState<{ name: string; path: string; mtime: number }[]>([]);

	useEffect(() => {
		async function fetchProjects() {
			try {
				const res = await window.electronAPI?.getRecentProjects();
				if (res?.success && res.projects) {
					setRecentProjects(res.projects);
				}
			} catch (error) {
				console.error("Failed to load recent projects:", error);
			}
		}
		fetchProjects();
	}, []);

	const handleRecordClick = () => {
		window.electronAPI?.openHudOverlay().catch((err: unknown) => {
			// The home window may be destroyed before the IPC response arrives;
			// this is expected and safe to ignore.
			console.warn("openHudOverlay IPC interrupted:", err);
		});
	};

	const handleEditClick = async () => {
		try {
			const res = await window.electronAPI?.openVideoFilePicker();
			if (res && res.success && res.path) {
				await window.electronAPI?.setCurrentVideoPath(res.path);
				// switchToEditor will destroy this window; catch the expected rejection.
				window.electronAPI?.switchToEditor().catch(() => {
					// Window destroyed before IPC response — expected.
				});
			}
		} catch (err) {
			console.error("Failed to open video for editing:", err);
		}
	};

	const handleProjectClick = async (projectPath: string) => {
		try {
			await window.electronAPI?.openSpecificProject(projectPath);
		} catch {
			// The home window is destroyed when the editor opens, so the IPC
			// response may fail to deliver.  This is expected and safe to ignore.
		}
	};

	return (
		<div className="flex flex-col h-screen w-full bg-[#0D0D0D] text-[#F2F0ED] overflow-hidden items-center justify-center p-8 selection:bg-red-500/30" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>

			<div className="flex flex-col items-center mb-16" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
				<div className="w-16 h-16 relative flex items-center justify-center mb-4">
					{/* klipt logo shape simulation - three rotating rectangles */}
					<div className="absolute w-8 h-8 bg-transparent border-4 border-[#2E2E2E] rounded transform rotate-12" />
					<div className="absolute w-8 h-8 bg-transparent border-4 border-[#555] rounded transform -rotate-12" />
					<div className="absolute w-8 h-8 bg-[#E0000F] rounded transform rotate-45 shadow-[0_0_20px_rgba(224,0,15,0.4)]" />
				</div>
				<h1 className="text-4xl font-medium tracking-[-0.05em] text-white">klipt</h1>
				<p className="text-sm font-medium text-[#555] mt-2 tracking-wide uppercase">edit at the speed of thought.</p>
			</div>

			<div className="flex items-center gap-6 w-full max-w-2xl mb-12" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
				<div
					onClick={handleRecordClick}
					className="flex-1 flex flex-col items-start p-8 rounded-2xl bg-[#1C1C1C]/50 border border-[#2E2E2E] shadow-[0_10px_40px_rgba(0,0,0,0.5)] cursor-pointer group hover:bg-[#1C1C1C] hover:border-[#E0000F]/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(224,0,15,0.15)] relative overflow-hidden"
				>
					<div className="absolute inset-0 bg-gradient-to-br from-[#E0000F]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
					<div className="w-12 h-12 rounded-full bg-[#E0000F]/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 shadow-[0_0_15px_rgba(224,0,15,0.2)] group-hover:shadow-[0_0_25px_rgba(224,0,15,0.4)] ring-1 ring-[#E0000F]/30">
						<CircleDot className="w-6 h-6 text-[#E0000F]" />
					</div>
					<h2 className="text-xl font-semibold mb-2 text-white">New Recording</h2>
					<p className="text-sm text-[#888] font-medium leading-relaxed">Capture your screen with AI-powered editing</p>
				</div>

				<div
					onClick={handleEditClick}
					className="flex-1 flex flex-col items-start p-8 rounded-2xl bg-[#1C1C1C]/50 border border-[#2E2E2E] shadow-[0_10px_40px_rgba(0,0,0,0.5)] cursor-pointer group hover:bg-[#1C1C1C] hover:border-[#2563EB]/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_50px_rgba(37,99,235,0.15)] relative overflow-hidden"
				>
					<div className="absolute inset-0 bg-gradient-to-br from-[#2563EB]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
					<div className="w-12 h-12 rounded-full bg-[#2563EB]/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-300 shadow-[0_0_15px_rgba(37,99,235,0.2)] group-hover:shadow-[0_0_25px_rgba(37,99,235,0.4)] ring-1 ring-[#2563EB]/30">
						<Film className="w-6 h-6 text-[#2563EB]" />
					</div>
					<h2 className="text-xl font-semibold mb-2 text-white">Edit Video</h2>
					<p className="text-sm text-[#888] font-medium leading-relaxed">Open and edit an existing recording</p>
				</div>
			</div>

			{recentProjects.length > 0 && (
				<div className="w-full max-w-2xl flex flex-col" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
					<h3 className="text-xs font-bold uppercase tracking-widest text-[#555] mb-4">Recent Projects</h3>
					<div className="flex flex-col gap-2">
						{recentProjects.map((project) => (
							<div
								key={project.path}
								onClick={() => handleProjectClick(project.path)}
								className="flex items-center justify-between p-3 rounded-xl bg-[#1C1C1C]/30 border border-transparent hover:border-[#2E2E2E] hover:bg-[#1C1C1C] cursor-pointer transition-all duration-200 group"
							>
								<div className="flex items-center gap-3">
									<div className="w-10 h-10 rounded bg-[#0D0D0D] flex items-center justify-center border border-[#2E2E2E] group-hover:border-white/10 transition-colors">
										<FileVideo className="w-4 h-4 text-[#555] group-hover:text-white/80 transition-colors" />
									</div>
									<div className="flex flex-col">
										<span className="text-sm font-medium text-white/90 group-hover:text-white transition-colors">{project.name.replace('.klipt', '')}</span>
										<span className="text-xs text-[#555] mt-0.5">{relativeTime(project.mtime)}</span>
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			<div className="absolute bottom-6 flex items-center gap-4 text-[#555] font-mono text-[10px] tracking-wider pointer-events-none">
				<span>Made with klipt</span>
				<span className="w-1 h-1 rounded-full bg-[#2E2E2E]" />
				<span>v1.0.0</span>
			</div>
		</div>
	);
}

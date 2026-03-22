import { CircleDot, FileVideo, Film, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/*  CSS keyframes injected once into <head>                            */
/* ------------------------------------------------------------------ */
const KEYFRAMES = `
@keyframes hs-breathe {
	0%, 100% { transform: scale(1); }
	50%      { transform: scale(1.02); }
}
@keyframes hs-fadeSlideUp {
	from { opacity: 0; transform: translateY(12px); }
	to   { opacity: 1; transform: translateY(0); }
}
@keyframes hs-fadeIn {
	from { opacity: 0; }
	to   { opacity: 1; }
}
@keyframes hs-scaleIn {
	from { opacity: 0; transform: scale(0.8); }
	to   { opacity: 1; transform: scale(1); }
}
@keyframes hs-typewriter {
	0%   { opacity: 0; clip-path: inset(0 100% 0 0); }
	30%  { opacity: 1; clip-path: inset(0 100% 0 0); }
	100% { opacity: 1; clip-path: inset(0 0% 0 0); }
}
`;

let stylesInjected = false;
function injectStyles() {
	if (stylesInjected) return;
	stylesInjected = true;
	const style = document.createElement("style");
	style.textContent = KEYFRAMES;
	document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Simple relative time formatter -- avoids pulling in date-fns. */
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

const NOISE_SVG = `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.02'/%3E%3C/svg%3E")`;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function HomeScreen() {
	const [recentProjects, setRecentProjects] = useState<
		{ name: string; path: string; mtime: number }[]
	>([]);

	useEffect(() => {
		injectStyles();
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

	/* ---- handlers ---- */

	const handleRecordClick = () => {
		window.electronAPI?.openHudOverlay().catch((err: unknown) => {
			console.warn("openHudOverlay IPC interrupted:", err);
		});
	};

	const handleEditClick = async () => {
		try {
			const res = await window.electronAPI?.openVideoFilePicker();
			if (res && res.success && res.path) {
				await window.electronAPI?.setCurrentVideoPath(res.path);
				window.electronAPI?.switchToEditor().catch(() => {});
			}
		} catch (err) {
			console.error("Failed to open video for editing:", err);
		}
	};

	const handleProjectClick = async (projectPath: string) => {
		try {
			await window.electronAPI?.openSpecificProject(projectPath);
		} catch {
			// Window destroyed on editor open -- expected.
		}
	};

	/* ---- render ---- */

	return (
		<div
			className="relative flex flex-col h-screen w-full overflow-hidden font-sans selection:bg-[#E0000F]/30"
			style={{
				background: "#0A0A0A",
				WebkitAppRegion: "drag",
			} as React.CSSProperties}
		>
			{/* ============ BACKGROUND LAYER ============ */}
			{/* Red gradient orb -- top right */}
			<div
				className="pointer-events-none absolute"
				style={{
					top: "-100px",
					right: "-100px",
					width: 600,
					height: 600,
					borderRadius: "50%",
					background: "rgba(224,0,15,0.04)",
					filter: "blur(200px)",
				}}
			/>
			{/* Blue gradient orb -- bottom left */}
			<div
				className="pointer-events-none absolute"
				style={{
					bottom: "-80px",
					left: "-80px",
					width: 500,
					height: 500,
					borderRadius: "50%",
					background: "rgba(37,99,235,0.04)",
					filter: "blur(180px)",
				}}
			/>
			{/* Noise texture overlay */}
			<div
				className="pointer-events-none absolute inset-0"
				style={{
					backgroundImage: NOISE_SVG,
					backgroundRepeat: "repeat",
					opacity: 0.02,
					mixBlendMode: "overlay",
				}}
			/>

			{/* ============ FROSTED GLASS HEADER (Dynamic Island) ============ */}
			<div
				className="relative z-10 flex items-center justify-center shrink-0"
				style={{
					height: 52,
					backdropFilter: "blur(40px) saturate(180%)",
					WebkitBackdropFilter: "blur(40px) saturate(180%)",
					background: "rgba(10,10,10,0.6)",
					borderBottom: "1px solid rgba(255,255,255,0.06)",
					WebkitAppRegion: "drag",
				} as React.CSSProperties}
			>
				<span
					style={{
						fontFamily: "'Inter', system-ui, sans-serif",
						fontSize: 13,
						fontWeight: 600,
						letterSpacing: "0.08em",
						color: "rgba(255,255,255,0.5)",
						textTransform: "uppercase" as const,
					}}
				>
					klipt
				</span>
			</div>

			{/* ============ MAIN CONTENT ============ */}
			<div
				className="relative z-10 flex flex-1 flex-col items-center overflow-y-auto"
				style={{
					paddingTop: 48,
					paddingBottom: 48,
					paddingLeft: 32,
					paddingRight: 32,
					WebkitAppRegion: "no-drag",
				} as React.CSSProperties}
			>
				{/* ---- HERO SECTION ---- */}
				<div className="flex flex-col items-center mb-14">
					{/* Logo: three rotating rectangles */}
					<div
						style={{
							width: 72,
							height: 72,
							position: "relative",
							marginBottom: 20,
							animation: "hs-breathe 4s ease-in-out infinite",
							animationDelay: "0ms",
							opacity: 0,
							animationFillMode: "none",
						}}
					>
						{/* Wrapper for scale-in entrance */}
						<div
							style={{
								width: "100%",
								height: "100%",
								position: "relative",
								animation: "hs-scaleIn 600ms cubic-bezier(0.34, 1.56, 0.64, 1) 300ms both",
							}}
						>
							<div
								className="absolute inset-0 flex items-center justify-center"
								style={{ animation: "hs-breathe 4s ease-in-out infinite" }}
							>
								<div
									style={{
										position: "absolute",
										width: 32,
										height: 32,
										border: "3px solid rgba(255,255,255,0.08)",
										borderRadius: 6,
										transform: "rotate(12deg)",
									}}
								/>
								<div
									style={{
										position: "absolute",
										width: 32,
										height: 32,
										border: "3px solid rgba(255,255,255,0.15)",
										borderRadius: 6,
										transform: "rotate(-12deg)",
									}}
								/>
								<div
									style={{
										position: "absolute",
										width: 32,
										height: 32,
										borderRadius: 6,
										transform: "rotate(45deg)",
										background: "linear-gradient(135deg, #E0000F 0%, #FF4500 100%)",
										boxShadow: "0 0 40px rgba(224,0,15,0.5), inset 0 2px 4px rgba(255,255,255,0.3)",
									}}
								/>
							</div>
						</div>
					</div>

					{/* Title */}
					<h1
						style={{
							fontFamily: "'Inter', system-ui, sans-serif",
							fontSize: 48,
							fontWeight: 500,
							letterSpacing: "-0.05em",
							color: "#FFFFFF",
							margin: 0,
							lineHeight: 1,
							animation: "hs-fadeSlideUp 500ms ease-out 400ms both",
						}}
					>
						klipt
					</h1>

					{/* Tagline */}
					<p
						style={{
							fontFamily: "'Inter', system-ui, sans-serif",
							fontSize: 14,
							color: "#666666",
							marginTop: 12,
							fontWeight: 400,
							letterSpacing: "0.01em",
							animation: "hs-typewriter 1200ms ease-out 600ms both",
						}}
					>
						edit at the speed of thought.
					</p>
				</div>

				{/* ---- ACTION CARDS ---- */}
				<div className="flex gap-5 w-full max-w-xl mb-12">
					{/* Record Card */}
					<div
						onClick={handleRecordClick}
						className="group relative flex-1 cursor-pointer"
						style={{
							animation: "hs-fadeSlideUp 500ms ease-out 800ms both",
						}}
					>
						{/* Glow element behind card */}
						<div
							className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
							style={{
								background: "rgba(224,0,15,0.15)",
								filter: "blur(40px)",
								transform: "translateY(8px) scale(0.95)",
								zIndex: 0,
							}}
						/>
						<div
							className="relative z-10 flex flex-col items-start rounded-2xl transition-all duration-300 group-hover:-translate-y-1"
							style={{
								height: 200,
								padding: 28,
								background: "rgba(255,255,255,0.03)",
								backdropFilter: "blur(40px)",
								WebkitBackdropFilter: "blur(40px)",
								border: "1px solid rgba(255,255,255,0.06)",
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
							}}
						>
							<div
								className="flex items-center justify-center rounded-full mb-5 transition-transform duration-300 group-hover:scale-110"
								style={{
									width: 48,
									height: 48,
									background: "rgba(224,0,15,0.08)",
								}}
							>
								<CircleDot style={{ width: 24, height: 24, color: "#E0000F" }} />
							</div>
							<h2
								style={{
									fontFamily: "'Inter', system-ui, sans-serif",
									fontSize: 18,
									fontWeight: 600,
									color: "#FFFFFF",
									margin: 0,
									marginBottom: 8,
								}}
							>
								New Recording
							</h2>
							<p
								style={{
									fontFamily: "'Inter', system-ui, sans-serif",
									fontSize: 13,
									color: "#666",
									margin: 0,
									lineHeight: 1.5,
								}}
							>
								Capture your screen with AI-powered editing
							</p>
						</div>
					</div>

					{/* Edit Card */}
					<div
						onClick={handleEditClick}
						className="group relative flex-1 cursor-pointer"
						style={{
							animation: "hs-fadeSlideUp 500ms ease-out 900ms both",
						}}
					>
						{/* Glow element behind card */}
						<div
							className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
							style={{
								background: "rgba(37,99,235,0.15)",
								filter: "blur(40px)",
								transform: "translateY(8px) scale(0.95)",
								zIndex: 0,
							}}
						/>
						<div
							className="relative z-10 flex flex-col items-start rounded-2xl transition-all duration-300 group-hover:-translate-y-1"
							style={{
								height: 200,
								padding: 28,
								background: "rgba(255,255,255,0.03)",
								backdropFilter: "blur(40px)",
								WebkitBackdropFilter: "blur(40px)",
								border: "1px solid rgba(255,255,255,0.06)",
							}}
							onMouseEnter={(e) => {
								e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
							}}
							onMouseLeave={(e) => {
								e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
							}}
						>
							<div
								className="flex items-center justify-center rounded-full mb-5 transition-transform duration-300 group-hover:scale-110"
								style={{
									width: 48,
									height: 48,
									background: "rgba(37,99,235,0.08)",
								}}
							>
								<Film style={{ width: 24, height: 24, color: "#2563EB" }} />
							</div>
							<h2
								style={{
									fontFamily: "'Inter', system-ui, sans-serif",
									fontSize: 18,
									fontWeight: 600,
									color: "#FFFFFF",
									margin: 0,
									marginBottom: 8,
								}}
							>
								Edit Video
							</h2>
							<p
								style={{
									fontFamily: "'Inter', system-ui, sans-serif",
									fontSize: 13,
									color: "#666",
									margin: 0,
									lineHeight: 1.5,
								}}
							>
								Open and edit an existing recording
							</p>
						</div>
					</div>
				</div>

				{/* ---- RECENT PROJECTS ---- */}
				{recentProjects.length > 0 && (
					<div
						className="w-full max-w-xl flex flex-col"
						style={{
							animation: "hs-fadeIn 500ms ease-out 1000ms both",
						}}
					>
						<h3
							style={{
								fontFamily: "'Inter', system-ui, sans-serif",
								fontSize: 11,
								fontWeight: 600,
								textTransform: "uppercase",
								letterSpacing: "0.12em",
								color: "#444",
								marginBottom: 12,
							}}
						>
							Recent Projects
						</h3>
						<div className="flex flex-col gap-1">
							{recentProjects.map((project, i) => (
								<div
									key={project.path}
									onClick={() => handleProjectClick(project.path)}
									className="group flex items-center justify-between rounded-xl cursor-pointer transition-all duration-200 hover:translate-x-1"
									style={{
										padding: "10px 12px",
										background: "transparent",
										border: "1px solid transparent",
										animation: `hs-fadeSlideUp 400ms ease-out ${1000 + i * 80}ms both`,
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "rgba(255,255,255,0.03)";
										e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "transparent";
										e.currentTarget.style.borderColor = "transparent";
									}}
								>
									<div className="flex items-center gap-3">
										<div
											className="flex items-center justify-center rounded-lg transition-colors duration-200"
											style={{
												width: 36,
												height: 36,
												background: "rgba(255,255,255,0.04)",
												border: "1px solid rgba(255,255,255,0.06)",
											}}
										>
											<FileVideo
												style={{ width: 16, height: 16, color: "#555" }}
												className="group-hover:text-white/70 transition-colors duration-200"
											/>
										</div>
										<div className="flex flex-col">
											<span
												className="group-hover:text-white transition-colors duration-200"
												style={{
													fontFamily: "'Inter', system-ui, sans-serif",
													fontSize: 13,
													fontWeight: 500,
													color: "rgba(255,255,255,0.8)",
												}}
											>
												{project.name.replace(".klipt", "")}
											</span>
											<span
												style={{
													fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
													fontSize: 11,
													color: "#444",
													marginTop: 2,
												}}
											>
												{relativeTime(project.mtime)}
											</span>
										</div>
									</div>
									<ChevronRight
										className="opacity-0 group-hover:opacity-60 transition-all duration-200 translate-x-[-4px] group-hover:translate-x-0"
										style={{ width: 14, height: 14, color: "#666" }}
									/>
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{/* ============ FOOTER ============ */}
			<div
				className="relative z-10 flex items-center justify-center gap-3 shrink-0 pointer-events-none"
				style={{
					paddingBottom: 16,
					paddingTop: 8,
				}}
			>
				<span
					style={{
						fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
						fontSize: 10,
						color: "#333",
					}}
				>
					klipt
				</span>
				<span
					style={{
						width: 3,
						height: 3,
						borderRadius: "50%",
						background: "#333",
						display: "inline-block",
					}}
				/>
				<span
					style={{
						fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
						fontSize: 10,
						color: "#333",
					}}
				>
					v1.0
				</span>
			</div>
		</div>
	);
}

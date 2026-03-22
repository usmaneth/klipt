import { ChevronRight, CircleDot, Film } from "lucide-react";
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
	from { opacity: 0; transform: translateY(10px); }
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
@keyframes hs-drift {
	0%, 100% { transform: translateX(-20px); }
	50%      { transform: translateX(20px); }
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

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function HomeScreen() {
	const [videoPath, setVideoPath] = useState<string>("");
	const [recentProjects, setRecentProjects] = useState<
		{ name: string; path: string; mtime: number }[]
	>([]);

	useEffect(() => {
		window.electronAPI?.getVideoAssetPath("veo-bg.mp4").then((p) => {
			if (p) setVideoPath(p);
		});
	}, []);

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

	/* ---- keyboard shortcuts ---- */
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.metaKey && e.key === "n") {
				e.preventDefault();
				handleRecordClick();
			}
			if (e.metaKey && e.key === "o") {
				e.preventDefault();
				handleEditClick();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	/* ---- handlers ---- */

	const handleRecordClick = () => {
		window.electronAPI?.openHudOverlay().catch((err: unknown) => {
			console.warn("openHudOverlay IPC interrupted:", err);
		});
		// Close this home window as a fallback in case the main process wrapper
		// doesn't tear it down quickly enough.
		setTimeout(() => window.close(), 120);
	};

	const handleEditClick = async () => {
		try {
			const res = await window.electronAPI?.openVideoFilePicker();
			if (res && res.success && res.path) {
				await window.electronAPI?.setCurrentVideoPath(res.path);
				window.electronAPI?.switchToEditor().catch(() => {});
				setTimeout(() => window.close(), 120);
			}
		} catch (err) {
			console.error("Failed to open video for editing:", err);
		}
	};

	const handleProjectClick = async (projectPath: string) => {
		try {
			await window.electronAPI?.openSpecificProject(projectPath);
			setTimeout(() => window.close(), 120);
		} catch {
			// Window destroyed on editor open -- expected.
		}
	};

	/* ---- render ---- */

	return (
		<div
			className="relative flex flex-col items-center justify-center h-screen w-full overflow-hidden font-sans selection:bg-[#E0000F]/30"
			style={{
				background: "#000000",
				WebkitAppRegion: "drag",
			} as React.CSSProperties}
		>
			{/* ============ VEO VIDEO BACKGROUND ============ */}
			<div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
				{/* 
					Drop your Veo-generated video into public/veo-bg.mp4! 
					We're using a heavy blur and mix-blend-screen to make it feel like an ambient light source.
				*/}
				<video
					autoPlay
					loop
					muted
					playsInline
					className="absolute inset-0 w-[120%] h-[120%] -left-[10%] -top-[10%] object-cover opacity-[0.8] transition-opacity duration-1000"
					style={{ filter: "blur(20px)" }}
					src={videoPath || "/veo-bg.mp4"} 
					// Placeholder. Replace with your Veo generation! -> src="/veo-bg.mp4"
				/>
				
				{/* A deep radial gradient to ensure the center content remains highly legible */}
				<div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(10,10,10,0.1)_0%,rgba(10,10,10,0.8)_100%)] pointer-events-none" />
			</div>

			{/* ============ BACKGROUND ORBS ============ */}
			{/* Red ambient orb -- top center with drift */}
			<div
				className="pointer-events-none absolute"
				style={{
					top: "-100px",
					left: "50%",
					marginLeft: -200,
					width: 400,
					height: 400,
					borderRadius: "50%",
					background: "rgba(224,0,15,0.035)",
					filter: "blur(100px)",
					animation: "hs-drift 20s ease-in-out infinite",
				}}
			/>
			{/* Purple ambient orb -- bottom right */}
			<div
				className="pointer-events-none absolute"
				style={{
					bottom: "-60px",
					right: "-60px",
					width: 250,
					height: 250,
					borderRadius: "50%",
					background: "rgba(191,90,242,0.02)",
					filter: "blur(70px)",
				}}
			/>

			{/* ============ CENTERED CONTENT ============ */}
			<div
				className="relative z-10 flex flex-col items-center"
				style={{
					width: "100%",
					maxWidth: 640,
					WebkitAppRegion: "no-drag",
				} as React.CSSProperties}
			>
				{/* ---- LOGO ---- */}
				<div
					style={{
						width: 72,
						height: 72,
						position: "relative",
						animation: "hs-scaleIn 600ms cubic-bezier(0.34, 1.56, 0.64, 1) 300ms both",
					}}
				>
					<div
						style={{
							width: "100%",
							height: "100%",
							position: "relative",
							animation: "hs-breathe 4s ease-in-out infinite",
						}}
					>
						{/* Outer rectangle */}
						<div
							style={{
								position: "absolute",
								inset: 0,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
							}}
						>
							<div
								style={{
									width: 36,
									height: 36,
									border: "2.5px solid rgba(255,255,255,0.06)",
									borderRadius: 6,
									transform: "rotate(5deg)",
									position: "absolute",
								}}
							/>
							{/* Middle rectangle */}
							<div
								style={{
									width: 36,
									height: 36,
									border: "2.5px solid rgba(255,255,255,0.12)",
									borderRadius: 6,
									transform: "rotate(-5deg)",
									position: "absolute",
								}}
							/>
							{/* Inner solid rectangle */}
							<div
								style={{
									width: 36,
									height: 36,
									borderRadius: 6,
									transform: "rotate(20deg)",
									background: "#E0000F",
									boxShadow: "0 0 32px rgba(224,0,15,0.35)",
									position: "absolute",
								}}
							/>
						</div>
					</div>
				</div>

				{/* ---- WORDMARK ---- */}
				<h1
					style={{
						fontFamily: "'Inter', system-ui, sans-serif",
						fontSize: 64,
						fontWeight: 500,
						letterSpacing: "-0.05em",
						color: "#FFFFFF",
						margin: 0,
						marginTop: 24,
						lineHeight: 1,
						animation: "hs-fadeSlideUp 500ms ease-out 400ms both",
					}}
				>
					klipt
				</h1>

				{/* ---- TAGLINE ---- */}
				<p
					style={{
						fontFamily: "'Inter', system-ui, sans-serif",
						fontSize: 11,
						textTransform: "uppercase",
						letterSpacing: "0.08em",
						color: "rgba(255,255,255,0.15)",
						marginTop: 8,
						fontWeight: 400,
						animation: "hs-typewriter 1200ms ease-out 600ms both",
					}}
				>
					EDIT AT THE SPEED OF THOUGHT
				</p>

				{/* ---- ACTION BUTTONS ---- */}
				<div
					className="flex items-center gap-6 w-full max-w-2xl"
					style={{ marginTop: 40, marginBottom: 12, WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<div
						onClick={handleRecordClick}
						className="flex-1 flex flex-col items-start p-8 rounded-[24px] cursor-pointer group transition-all duration-500 relative overflow-hidden"
						style={{
							background: "rgba(255,255,255,0.02)",
							border: "1px solid rgba(255,255,255,0.05)",
							boxShadow: "0 10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
							backdropFilter: "blur(20px)",
							WebkitBackdropFilter: "blur(20px)",
							animation: "hs-fadeSlideUp 600ms ease-out 700ms both",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = "rgba(255,255,255,0.04)";
							e.currentTarget.style.borderColor = "rgba(224,0,15,0.3)";
							e.currentTarget.style.transform = "translateY(-4px)";
							e.currentTarget.style.boxShadow = "0 20px 50px rgba(224,0,15,0.2), inset 0 1px 0 rgba(255,255,255,0.1)";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = "rgba(255,255,255,0.02)";
							e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
							e.currentTarget.style.transform = "translateY(0px)";
							e.currentTarget.style.boxShadow = "0 10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)";
						}}
					>
						<div className="absolute inset-0 bg-gradient-to-br from-[#E0000F]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
						
						<div className="w-14 h-14 rounded-full bg-[#E0000F]/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 shadow-[0_0_15px_rgba(224,0,15,0.2)] group-hover:shadow-[0_0_30px_rgba(224,0,15,0.5)] border border-[#E0000F]/30">
							<CircleDot className="w-6 h-6 text-[#E0000F]" />
						</div>
						
						<h2 className="text-[20px] font-semibold mb-2 text-white font-sans tracking-tight">New Recording</h2>
						<p className="text-[13px] text-white/40 font-medium leading-relaxed font-sans">Capture your screen with AI-powered editing</p>
					</div>

					<div
						onClick={handleEditClick}
						className="flex-1 flex flex-col items-start p-8 rounded-[24px] cursor-pointer group transition-all duration-500 relative overflow-hidden"
						style={{
							background: "rgba(255,255,255,0.02)",
							border: "1px solid rgba(255,255,255,0.05)",
							boxShadow: "0 10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
							backdropFilter: "blur(20px)",
							WebkitBackdropFilter: "blur(20px)",
							animation: "hs-fadeSlideUp 600ms ease-out 850ms both",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = "rgba(255,255,255,0.04)";
							e.currentTarget.style.borderColor = "rgba(37,99,235,0.3)";
							e.currentTarget.style.transform = "translateY(-4px)";
							e.currentTarget.style.boxShadow = "0 20px 50px rgba(37,99,235,0.2), inset 0 1px 0 rgba(255,255,255,0.1)";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = "rgba(255,255,255,0.02)";
							e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
							e.currentTarget.style.transform = "translateY(0px)";
							e.currentTarget.style.boxShadow = "0 10px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)";
						}}
					>
						<div className="absolute inset-0 bg-gradient-to-br from-[#2563EB]/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
						
						<div className="w-14 h-14 rounded-full bg-[#2563EB]/10 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform duration-500 shadow-[0_0_15px_rgba(37,99,235,0.2)] group-hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] border border-[#2563EB]/30">
							<Film className="w-6 h-6 text-[#2563EB]" />
						</div>
						
						<h2 className="text-[20px] font-semibold mb-2 text-white font-sans tracking-tight">Edit Video</h2>
						<p className="text-[13px] text-white/40 font-medium leading-relaxed font-sans">Open and edit an existing recording</p>
					</div>
				</div>

				{/* ---- KEYBOARD HINTS ---- */}
				<div
					className="flex items-center gap-6"
					style={{
						marginTop: 20,
						animation: "hs-fadeIn 500ms ease-out 1000ms both",
						WebkitAppRegion: "no-drag",
					} as React.CSSProperties}
				>
					<span className="flex items-center gap-2">
						<kbd
							style={{
								background: "rgba(255,255,255,0.04)",
								border: "1px solid rgba(255,255,255,0.1)",
								borderRadius: 6,
								paddingLeft: 12,
								paddingRight: 12,
								paddingTop: 4,
								paddingBottom: 4,
								fontFamily: "'SF Mono', 'Fira Code', monospace",
								fontSize: 16,
								color: "rgba(255,255,255,0.7)",
								boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
							}}
						>
							⌘N
						</kbd>
						<span
							style={{
								fontSize: 15,
								color: "rgba(255,255,255,0.5)",
								fontWeight: 500,
								fontFamily: "'Inter', system-ui, sans-serif",
							}}
						>
							record
						</span>
					</span>
					<span className="flex items-center gap-2">
						<kbd
							style={{
								background: "rgba(255,255,255,0.04)",
								border: "1px solid rgba(255,255,255,0.1)",
								borderRadius: 6,
								paddingLeft: 12,
								paddingRight: 12,
								paddingTop: 4,
								paddingBottom: 4,
								fontFamily: "'SF Mono', 'Fira Code', monospace",
								fontSize: 16,
								color: "rgba(255,255,255,0.7)",
								boxShadow: "0 2px 10px rgba(0,0,0,0.2)",
							}}
						>
							⌘O
						</kbd>
						<span
							style={{
								fontSize: 15,
								color: "rgba(255,255,255,0.5)",
								fontWeight: 500,
								fontFamily: "'Inter', system-ui, sans-serif",
							}}
						>
							open
						</span>
					</span>
				</div>

				{/* ---- RECENT PROJECTS ---- */}
				{recentProjects.length > 0 && (
					<div
						className="w-full flex flex-col"
						style={{ marginTop: 48 }}
					>
						<h3
							style={{
								fontFamily: "'Inter', system-ui, sans-serif",
								fontSize: 12,
								fontWeight: 700,
								textTransform: "uppercase",
								letterSpacing: "0.15em",
								color: "rgba(255,255,255,0.4)",
								marginBottom: 6,
								marginTop: 0,
							}}
						>
							RECENT
						</h3>
						<div className="flex flex-col">
							{recentProjects.map((project, i) => (
								<div
									key={project.path}
									onClick={() => handleProjectClick(project.path)}
									className="group flex items-center justify-between cursor-pointer transition-colors duration-200"
									style={{
										padding: "7px 10px",
										borderRadius: 8,
										animation: `hs-fadeIn 400ms ease-out ${1000 + i * 80}ms both`,
									}}
									onMouseEnter={(e) => {
										e.currentTarget.style.background = "rgba(255,255,255,0.02)";
									}}
									onMouseLeave={(e) => {
										e.currentTarget.style.background = "transparent";
									}}
								>
									<div className="flex items-center gap-2">
										{/* Dot */}
										<div
											style={{
												width: 6,
												height: 6,
												borderRadius: 1,
												background: "rgba(255,255,255,0.06)",
												flexShrink: 0,
											}}
										/>
										<span
											className="transition-colors duration-200"
											style={{
												fontFamily: "'Inter', system-ui, sans-serif",
												fontSize: 15,
												fontWeight: 500,
												color: "rgba(255,255,255,0.8)",
											}}
											ref={(el) => {
												if (!el) return;
												const parent = el.closest(".group");
												if (!parent) return;
												parent.addEventListener("mouseenter", () => {
													el.style.color = "rgba(255,255,255,0.50)";
												});
												parent.addEventListener("mouseleave", () => {
													el.style.color = "rgba(255,255,255,0.35)";
												});
											}}
										>
											{project.name.replace(".klipt", "")}
										</span>
									</div>
									<div className="flex items-center gap-2">
										<span
											style={{
												fontFamily: "'SF Mono', 'Fira Code', monospace",
												fontSize: 13,
												color: "rgba(255,255,255,0.4)",
											}}
										>
											{relativeTime(project.mtime)}
										</span>
										<ChevronRight
											className="transition-transform duration-200 group-hover:translate-x-[2px]"
											style={{
												width: 10,
												height: 10,
												color: "rgba(255,255,255,0.08)",
											}}
										/>
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</div>

			{/* ============ FOOTER ============ */}
			<div
				className="absolute flex items-center justify-center gap-1.5 pointer-events-none"
				style={{
					bottom: 12,
					left: 0,
					right: 0,
				}}
			>
				<span
					style={{
						fontFamily: "'SF Mono', 'Fira Code', monospace",
						fontSize: 12,
						color: "rgba(255,255,255,0.3)",
					}}
				>
					klipt
				</span>
				<span
					style={{
						width: 2,
						height: 2,
						borderRadius: "50%",
						background: "rgba(255,255,255,0.08)",
						display: "inline-block",
					}}
				/>
				<span
					style={{
						fontFamily: "'SF Mono', 'Fira Code', monospace",
						fontSize: 12,
						color: "rgba(255,255,255,0.3)",
					}}
				>
					v1.0
				</span>
			</div>
		</div>
	);
}


import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "cmdk";
import { AnimatePresence, motion } from "framer-motion";
import {
	Download,
	Mic,
	Play,
	Save,
	Scissors,
	ZoomIn,
} from "lucide-react";
import { useEffect, useState } from "react";

export type CommandPaletteCallbacks = {
	onExportMp4: () => void;
	onExportGif: () => void;
	onAddZoomRegion: () => void;
	onAddTrimRegion: () => void;
	onAddSpeedRegion: () => void;
	onAddAnnotation: () => void;
	onPlayPause: () => void;
	onUndo: () => void;
	onRedo: () => void;
	onEnhanceAudio: () => void;
	onGenerateThumbnails: () => void;
	onSaveProject: () => void;
	onLoadProject: () => void;
	onOpenRecordingsFolder: () => void;
};

interface CommandPaletteProps extends CommandPaletteCallbacks {
	open: boolean;
	onClose: () => void;
}

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="ml-auto text-[14px] font-mono text-white/40 bg-white/[0.08] px-3 py-1 rounded-lg border border-white/10 shadow-sm">
			{children}
		</kbd>
	);
}

export function CommandPalette({
	open,
	onClose,
	onExportMp4,
	onAddZoomRegion,
	onAddTrimRegion,
	onPlayPause,
	onEnhanceAudio,
	onSaveProject,
}: CommandPaletteProps) {
	const [pulse, setPulse] = useState(false);

	useEffect(() => {
		if (!open) return;
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", handleKey);
		return () => window.removeEventListener("keydown", handleKey);
	}, [open, onClose]);

	const run = (action: () => void) => {
		setPulse(true);
		setTimeout(() => {
			setPulse(false);
			onClose();
			action();
		}, 600);
	};

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
					animate={{ opacity: 1, backdropFilter: "blur(80px)" }}
					exit={{ opacity: 0, backdropFilter: "blur(0px)", transition: { duration: 0.3 } }}
					transition={{ duration: 0.5, ease: "easeInOut" }}
					className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/60 pointer-events-auto"
					onClick={(e) => {
						if (e.target === e.currentTarget) onClose();
					}}
				>
					{/* Massive Light Pulse Effect when command executed */}
					{pulse && (
						<motion.div
							initial={{ scale: 0.8, opacity: 1 }}
							animate={{ scale: 5, opacity: 0 }}
							transition={{ duration: 0.6, ease: "easeOut" }}
							className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-white/30 rounded-full blur-3xl pointer-events-none z-0"
						/>
					)}

					<Command
						className="relative z-10 flex flex-col items-center w-[90vw] max-w-5xl bg-transparent outline-none"
						shouldFilter={true}
					>
						{/* Shifting Gradient Text Input */}
						<div className="relative w-full flex justify-center mb-12">
							<style dangerouslySetInnerHTML={{__html: `
								@keyframes aura-shift {
									0% { background-position: 0% 50%; }
									50% { background-position: 100% 50%; }
									100% { background-position: 0% 50%; }
								}
								.phantom-input {
									background: linear-gradient(90deg, rgba(255,255,255,0.8), rgba(255,255,255,1), rgba(255,255,255,0.8));
									background-size: 200% auto;
									color: transparent;
									-webkit-background-clip: text;
									background-clip: text;
									animation: aura-shift 4s linear infinite;
								}
								.phantom-input::placeholder {
									color: rgba(255,255,255,0.1);
								}
							`}} />
							<CommandInput
								placeholder="Ask the AI or type a command..."
								className="phantom-input w-full bg-transparent border-none outline-none text-center text-[48px] sm:text-[64px] md:text-[80px] font-bold tracking-tighter"
								autoFocus
							/>
						</div>

						<CommandList className="max-h-[40vh] w-full max-w-3xl overflow-y-auto overflow-x-hidden custom-scrollbar flex flex-col items-center gap-2">
							<CommandEmpty className="py-6 text-center text-white/30 text-xl font-medium tracking-wide">
								Press Enter to execute AI Prompt...
							</CommandEmpty>

							<CommandGroup className="w-full [&_[cmdk-group-heading]]:hidden">
								<CommandItem
									onSelect={() => run(onExportMp4)}
									className="flex items-center justify-between w-full px-8 py-5 rounded-[24px] text-2xl font-semibold text-white/40 cursor-pointer data-[selected=true]:bg-white/5 data-[selected=true]:text-white data-[selected=true]:scale-[1.02] data-[selected=true]:shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-300 group"
								>
									<span className="flex items-center gap-6">
										<Download className="w-8 h-8 group-data-[selected=true]:text-[#E0000F] transition-colors duration-300" /> Export as MP4
									</span>
									<Kbd>{"⌘"}E</Kbd>
								</CommandItem>
								<CommandItem
									onSelect={() => run(onPlayPause)}
									className="flex items-center justify-between w-full px-8 py-5 rounded-[24px] text-2xl font-semibold text-white/40 cursor-pointer data-[selected=true]:bg-white/5 data-[selected=true]:text-white data-[selected=true]:scale-[1.02] data-[selected=true]:shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-300 group"
								>
									<span className="flex items-center gap-6">
										<Play className="w-8 h-8 group-data-[selected=true]:text-white transition-colors duration-300" /> Play / Pause
									</span>
									<Kbd>Space</Kbd>
								</CommandItem>
								<CommandItem
									onSelect={() => run(onAddTrimRegion)}
									className="flex items-center justify-between w-full px-8 py-5 rounded-[24px] text-2xl font-semibold text-white/40 cursor-pointer data-[selected=true]:bg-white/5 data-[selected=true]:text-white data-[selected=true]:scale-[1.02] data-[selected=true]:shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-300 group"
								>
									<span className="flex items-center gap-6">
										<Scissors className="w-8 h-8 group-data-[selected=true]:text-white transition-colors duration-300" /> Add Trim Region
									</span>
									<Kbd>T</Kbd>
								</CommandItem>
								<CommandItem
									onSelect={() => run(onAddZoomRegion)}
									className="flex items-center justify-between w-full px-8 py-5 rounded-[24px] text-2xl font-semibold text-white/40 cursor-pointer data-[selected=true]:bg-white/5 data-[selected=true]:text-white data-[selected=true]:scale-[1.02] data-[selected=true]:shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-300 group"
								>
									<span className="flex items-center gap-6">
										<ZoomIn className="w-8 h-8 group-data-[selected=true]:text-white transition-colors duration-300" /> Add Zoom Region
									</span>
									<Kbd>Z</Kbd>
								</CommandItem>
								<CommandItem
									onSelect={() => run(onEnhanceAudio)}
									className="flex items-center justify-between w-full px-8 py-5 rounded-[24px] text-2xl font-semibold text-white/40 cursor-pointer data-[selected=true]:bg-white/5 data-[selected=true]:text-white data-[selected=true]:scale-[1.02] data-[selected=true]:shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-300 group"
								>
									<span className="flex items-center gap-6">
										<Mic className="w-8 h-8 group-data-[selected=true]:text-white transition-colors duration-300" /> Enhance Audio
									</span>
								</CommandItem>
								<CommandItem
									onSelect={() => run(onSaveProject)}
									className="flex items-center justify-between w-full px-8 py-5 rounded-[24px] text-2xl font-semibold text-white/40 cursor-pointer data-[selected=true]:bg-white/5 data-[selected=true]:text-white data-[selected=true]:scale-[1.02] data-[selected=true]:shadow-[0_20px_50px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-300 group"
								>
									<span className="flex items-center gap-6">
										<Save className="w-8 h-8 group-data-[selected=true]:text-[#2563EB] transition-colors duration-300" /> Save Project
									</span>
									<Kbd>{"⌘"}S</Kbd>
								</CommandItem>
							</CommandGroup>
						</CommandList>
					</Command>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

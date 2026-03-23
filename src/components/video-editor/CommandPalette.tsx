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
					animate={{ opacity: 1, backdropFilter: "blur(40px)" }}
					exit={{ opacity: 0, backdropFilter: "blur(0px)", transition: { duration: 0.2 } }}
					transition={{ duration: 0.4, ease: "easeOut" }}
					className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/50 pointer-events-auto"
					onClick={(e) => {
						if (e.target === e.currentTarget) onClose();
					}}
				>
					{/* Execution Pulse */}
					{pulse && (
						<motion.div
							initial={{ scale: 0.8, opacity: 1 }}
							animate={{ scale: 3, opacity: 0 }}
							transition={{ duration: 0.6, ease: "easeOut" }}
							className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] bg-[#E0000F]/30 rounded-full blur-3xl pointer-events-none z-0"
						/>
					)}

					<motion.div
						initial={{ opacity: 0, scale: 0.95, y: 20 }}
						animate={{ opacity: 1, scale: 1, y: 0 }}
						exit={{ opacity: 0, scale: 0.95, y: 10, transition: { duration: 0.2 } }}
						transition={{ type: "spring", bounce: 0.3, duration: 0.6 }}
						className="relative z-10 w-full max-w-3xl bg-[rgba(18,18,20,0.7)] backdrop-blur-3xl border border-white/[0.08] shadow-[0_40px_100px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.1)] rounded-[32px] overflow-hidden"
					>
						<Command className="flex flex-col w-full bg-transparent outline-none" shouldFilter={true}>
							
							{/* Shifting Gradient Text Input */}
							<div className="relative w-full border-b border-white/[0.06] px-8 py-6">
								<style dangerouslySetInnerHTML={{__html: `
									@keyframes aura-shift {
										0% { background-position: 0% 50%; }
										50% { background-position: 100% 50%; }
										100% { background-position: 0% 50%; }
									}
									.phantom-input {
										background: linear-gradient(90deg, rgba(255,255,255,0.9), rgba(255,255,255,1), rgba(224,0,15,0.8), rgba(255,255,255,0.9));
										background-size: 200% auto;
										color: transparent;
										-webkit-background-clip: text;
										background-clip: text;
										animation: aura-shift 5s linear infinite;
									}
									.phantom-input::placeholder {
										color: rgba(255,255,255,0.2);
									}
								`}} />
								<CommandInput
									placeholder="Ask the AI or search commands..."
									className="phantom-input w-full bg-transparent border-none outline-none text-[36px] sm:text-[44px] font-bold tracking-tight"
									autoFocus
								/>
							</div>

							<CommandList className="max-h-[50vh] w-full overflow-y-auto overflow-x-hidden custom-scrollbar px-4 py-4 flex flex-col gap-1">
								<CommandEmpty className="py-12 text-center text-white/40 text-lg font-medium tracking-wide">
									Press Enter to execute AI Prompt...
								</CommandEmpty>

								<CommandGroup className="w-full [&_[cmdk-group-heading]]:hidden">
									<CommandItem
										onSelect={() => run(onExportMp4)}
										className="flex items-center justify-between w-full px-6 py-4 rounded-[16px] text-[18px] font-semibold text-white/50 cursor-pointer data-[selected=true]:bg-white/10 data-[selected=true]:text-white data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-200 group"
									>
										<span className="flex items-center gap-5">
											<Download className="w-6 h-6 group-data-[selected=true]:text-[#E0000F] transition-colors" /> Export as MP4
										</span>
										<Kbd>{"\u2318"}E</Kbd>
									</CommandItem>
									<CommandItem
										onSelect={() => run(onPlayPause)}
										className="flex items-center justify-between w-full px-6 py-4 rounded-[16px] text-[18px] font-semibold text-white/50 cursor-pointer data-[selected=true]:bg-white/10 data-[selected=true]:text-white data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-200 group"
									>
										<span className="flex items-center gap-5">
											<Play className="w-6 h-6 group-data-[selected=true]:text-white transition-colors" /> Play / Pause
										</span>
										<Kbd>Space</Kbd>
									</CommandItem>
									<CommandItem
										onSelect={() => run(onAddTrimRegion)}
										className="flex items-center justify-between w-full px-6 py-4 rounded-[16px] text-[18px] font-semibold text-white/50 cursor-pointer data-[selected=true]:bg-white/10 data-[selected=true]:text-white data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-200 group"
									>
										<span className="flex items-center gap-5">
											<Scissors className="w-6 h-6 group-data-[selected=true]:text-white transition-colors" /> Add Trim Region
										</span>
										<Kbd>T</Kbd>
									</CommandItem>
									<CommandItem
										onSelect={() => run(onAddZoomRegion)}
										className="flex items-center justify-between w-full px-6 py-4 rounded-[16px] text-[18px] font-semibold text-white/50 cursor-pointer data-[selected=true]:bg-white/10 data-[selected=true]:text-white data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-200 group"
									>
										<span className="flex items-center gap-5">
											<ZoomIn className="w-6 h-6 group-data-[selected=true]:text-white transition-colors" /> Add Zoom Region
										</span>
										<Kbd>Z</Kbd>
									</CommandItem>
									<CommandItem
										onSelect={() => run(onEnhanceAudio)}
										className="flex items-center justify-between w-full px-6 py-4 rounded-[16px] text-[18px] font-semibold text-white/50 cursor-pointer data-[selected=true]:bg-white/10 data-[selected=true]:text-white data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-200 group"
									>
										<span className="flex items-center gap-5">
											<Mic className="w-6 h-6 group-data-[selected=true]:text-white transition-colors" /> Enhance Audio
										</span>
									</CommandItem>
									<CommandItem
										onSelect={() => run(onSaveProject)}
										className="flex items-center justify-between w-full px-6 py-4 rounded-[16px] text-[18px] font-semibold text-white/50 cursor-pointer data-[selected=true]:bg-white/10 data-[selected=true]:text-white data-[selected=true]:shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] transition-all duration-200 group"
									>
										<span className="flex items-center gap-5">
											<Save className="w-6 h-6 group-data-[selected=true]:text-[#2563EB] transition-colors" /> Save Project
										</span>
										<Kbd>{"\u2318"}S</Kbd>
									</CommandItem>
								</CommandGroup>
							</CommandList>
						</Command>
					</motion.div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

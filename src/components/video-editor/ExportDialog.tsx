import { Download, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner"; // Add this import
import { Button } from "@/components/ui/button";
import type { ExportProgress } from "@/lib/exporter";
import { useScopedT } from "../../contexts/I18nContext";

interface ExportDialogProps {
	isOpen: boolean;
	onClose: () => void;
	progress: ExportProgress | null;
	isExporting: boolean;
	error: string | null;
	onCancel?: () => void;
	onRetrySave?: () => void;
	canRetrySave?: boolean;
	exportFormat?: "mp4" | "gif";
	exportedFilePath?: string;
}

export function ExportDialog({
	isOpen,
	onClose,
	progress,
	isExporting,
	error,
	onCancel,
	onRetrySave,
	canRetrySave = false,
	exportFormat = "mp4",
	exportedFilePath, // Add this line
}: ExportDialogProps) {
	const t = useScopedT("dialogs");
	const [showSuccess, setShowSuccess] = useState(false);

	// Reset showSuccess when a new export starts or dialog reopens
	useEffect(() => {
		if (isExporting) {
			setShowSuccess(false);
		}
	}, [isExporting]);

	// Reset showSuccess when dialog opens fresh
	useEffect(() => {
		if (isOpen && !isExporting && !progress) {
			setShowSuccess(false);
		}
	}, [isOpen, isExporting, progress]);

	useEffect(() => {
		if (!isExporting && progress && progress.percentage >= 100 && !error) {
			setShowSuccess(true);
			const timer = setTimeout(() => {
				setShowSuccess(false);
				onClose();
			}, 2000);
			return () => clearTimeout(timer);
		}
	}, [isExporting, progress, error, onClose]);

	if (!isOpen) return null;

	const formatLabel = exportFormat === "gif" ? "GIF" : "Video";

	// Determine if we're in the compiling phase (frames done but still exporting)
	const isCompiling =
		isExporting && progress && progress.percentage >= 100 && exportFormat === "gif";
	const isFinalizing = progress?.phase === "finalizing";
	const renderProgress = progress?.renderProgress;

	// Get status message based on phase
	const getStatusMessage = () => {
		if (error) return t("export.pleaseTryAgain");
		if (isCompiling || isFinalizing) {
			if (renderProgress !== undefined && renderProgress > 0) {
				return t("export.compilingGifProgress", undefined, { progress: renderProgress });
			}
			return t("export.compilingGifWait");
		}
		return t("export.takeMoment");
	};

	// Get title based on phase
	const getTitle = () => {
		if (error) return t("export.exportFailed");
		if (isCompiling || isFinalizing) return t("export.compilingGifTitle");
		return t("export.exportingFormat", undefined, { format: formatLabel });
	};

	const handleClickShowInFolder = async () => {
		if (exportedFilePath) {
			try {
				const result = await window.electronAPI.revealInFolder(exportedFilePath);
				if (!result.success) {
					const errorMessage = result.error || result.message || "Failed to reveal item in folder.";
					console.error("Failed to reveal in folder:", errorMessage);
					toast.error(errorMessage);
				}
			} catch (err) {
				const errorMessage = String(err);
				console.error("Error calling revealInFolder IPC:", errorMessage);
				toast.error(`Error revealing in folder: ${errorMessage}`);
			}
		}
	};

	return (
		<>
			<div
				className="fixed inset-0 bg-black/80 backdrop-blur-2xl z-50 animate-in fade-in duration-300"
				onClick={isExporting ? undefined : onClose}
			/>
			<div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] bg-[#0A0D14]/90 backdrop-blur-3xl rounded-3xl shadow-[0_0_80px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.1)] border border-white/10 p-10 w-[90vw] max-w-md animate-in zoom-in-95 duration-300">
				<div className="flex items-center justify-between mb-8">
					<div className="flex items-center gap-5">
						{showSuccess ? (
							<>
								<div className="w-14 h-14 rounded-full bg-cyan-500/20 flex items-center justify-center ring-1 ring-cyan-400/50 shadow-[0_0_20px_rgba(34,211,238,0.4)]">
									<Download className="w-7 h-7 text-cyan-400" />
								</div>
								<div className="flex flex-col gap-1.5">
									<span className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] block">
										{t("export.exportComplete")}
									</span>
									<span className="text-sm text-cyan-300/80 font-medium">
										{t("export.formatReady", undefined, { format: formatLabel.toLowerCase() })}
									</span>
									{exportedFilePath && (
										<Button
											variant="secondary"
											onClick={handleClickShowInFolder}
											className="mt-2 w-fit px-3 py-1 text-sm rounded-md bg-white/10 hover:bg-white/20 text-slate-200"
										>
											{t("export.showInFolder")}
										</Button>
									)}
									{exportedFilePath && (
										<span className="text-xs text-slate-500 break-all max-w-xs mt-1">
											{exportedFilePath.split("/").pop()}
										</span>
									)}
								</div>
							</>
						) : (
							<>
								{isExporting ? (
									<div className="w-14 h-14 rounded-full bg-blue-600/20 flex items-center justify-center ring-1 ring-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.3)]">
										<Loader2 className="w-7 h-7 text-blue-400 animate-spin drop-shadow-[0_0_8px_rgba(96,165,250,0.6)]" />
									</div>
								) : (
									<div className="w-14 h-14 rounded-full bg-white/5 flex items-center justify-center border border-white/10 shadow-[0_0_15px_rgba(255,255,255,0.05)]">
										<Download className="w-7 h-7 text-slate-300" />
									</div>
								)}
								<div className="flex flex-col gap-1">
									<span className="text-xl font-bold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-[#E0000F] to-[#FF2215] drop-shadow-[0_0_8px_rgba(224,0,15,0.4)] block">
										{getTitle()}
									</span>
									<span className="text-sm font-medium text-slate-400">{getStatusMessage()}</span>
								</div>
							</>
						)}
					</div>
					{!isExporting && (
						<Button
							variant="ghost"
							size="icon"
							onClick={onClose}
							className="hover:bg-white/10 text-slate-400 hover:text-white rounded-full transition-colors"
						>
							<X className="w-6 h-6" />
						</Button>
					)}
				</div>

				{error && (
					<div className="mb-8 animate-in slide-in-from-top-2">
						<div className="bg-gradient-to-r from-red-600/20 to-red-500/10 border border-red-500/30 shadow-[0_0_15px_rgba(239,68,68,0.2)] rounded-2xl p-4 flex items-start gap-4">
							<div className="p-1.5 bg-red-500/20 rounded-full shadow-[0_0_10px_rgba(239,68,68,0.4)]">
								<X className="w-4 h-4 text-red-400" />
							</div>
							<p className="text-sm font-medium text-red-300 leading-relaxed">{error}</p>
						</div>
						{!isExporting && canRetrySave && onRetrySave && (
							<Button
								onClick={onRetrySave}
								className="w-full mt-4 py-6 bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-bold tracking-wide hover:scale-[1.02] shadow-[0_0_20px_rgba(6,182,212,0.4)] border-none rounded-xl transition-all"
							>
								Save Again
							</Button>
						)}
					</div>
				)}

				{isExporting && progress && (
					<div className="space-y-8">
						<div className="space-y-3">
							<div className="flex justify-between text-xs font-bold text-cyan-400/80 uppercase tracking-widest drop-shadow-[0_0_5px_rgba(34,211,238,0.3)]">
								<span>
									{isCompiling || isFinalizing
										? t("export.compiling")
										: t("export.renderingFrames")}
								</span>
								<span className="font-mono text-cyan-300 drop-shadow-[0_0_8px_rgba(103,232,249,0.8)]">
									{isCompiling || isFinalizing ? (
										renderProgress !== undefined && renderProgress > 0 ? (
											`${renderProgress}%`
										) : (
											<span className="flex items-center gap-2 text-blue-300">
												<Loader2 className="w-3.5 h-3.5 animate-spin" />
												{t("export.processing")}
											</span>
										)
									) : (
										`${progress.percentage.toFixed(0)}%`
									)}
								</span>
							</div>
							<div className="h-3 bg-black/50 shadow-[inset_0_1px_3px_rgba(0,0,0,0.8)] rounded-full overflow-hidden border border-white/5 relative">
								{isCompiling || isFinalizing ? (
									// Show render progress if available, otherwise animated indeterminate bar
									renderProgress !== undefined && renderProgress > 0 ? (
										<div
											className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.6)] transition-all duration-300 ease-out rounded-full"
											style={{ width: `${renderProgress}%` }}
										/>
									) : (
										<div className="h-full w-full relative overflow-hidden rounded-full">
											<div
												className="absolute h-full w-1/2 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_20px_rgba(34,211,238,0.8)] opacity-80"
												style={{
													animation: "indeterminate 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite",
												}}
											/>
											<style>{`
                        @keyframes indeterminate {
                          0% { transform: translateX(-150%); }
                          100% { transform: translateX(250%); }
                        }
                      `}</style>
										</div>
									)
								) : (
									<div
										className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.6)] transition-all duration-300 ease-out rounded-full"
										style={{ width: `${Math.min(progress.percentage, 100)}%` }}
									/>
								)}
							</div>
						</div>

						<div className="grid grid-cols-2 gap-4">
							<div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
								<div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
									{isCompiling || isFinalizing ? t("export.status") : t("export.format")}
								</div>
								<div className="text-slate-200 font-semibold text-sm">
									{isCompiling || isFinalizing ? t("export.compilingStatus") : formatLabel}
								</div>
							</div>
							<div className="bg-white/5 rounded-2xl p-4 border border-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
								<div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">
									{t("export.frames")}
								</div>
								<div className="text-slate-200 font-semibold text-sm font-mono tracking-wide">
									{progress.currentFrame} / {progress.totalFrames}
								</div>
							</div>
						</div>

						{onCancel && (
							<div className="pt-4">
								<Button
									onClick={onCancel}
									variant="destructive"
									className="w-full py-6 font-bold tracking-wide bg-gradient-to-r from-red-600/20 to-red-500/10 text-red-400 border border-red-500/30 hover:from-red-600/30 hover:to-red-500/20 hover:border-red-500/50 transition-all rounded-xl hover:shadow-[0_0_20px_rgba(239,68,68,0.3)] hover:scale-[1.02]"
								>
									{t("export.cancelExport")}
								</Button>
							</div>
						)}
					</div>
				)}

				{showSuccess && (
					<div className="text-center py-4 animate-in zoom-in-95">
						<p className="text-lg text-slate-200 font-medium">
							{t("export.savedSuccess", undefined, { format: formatLabel })}
						</p>
					</div>
				)}
			</div>
		</>
	);
}

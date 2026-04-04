import { ClipboardCopy, Copy, Download, Globe, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
	const [isCopying, setIsCopying] = useState(false);
	const [shareUrl, setShareUrl] = useState<string | null>(null);
	const [isStartingShare, setIsStartingShare] = useState(false);
	const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

	// Clean up share server when dialog closes
	useEffect(() => {
		if (!isOpen && shareUrl) {
			window.electronAPI.stopShareServer();
			setShareUrl(null);
		}
	}, [isOpen, shareUrl]);

	useEffect(() => {
		if (!isExporting && progress && progress.percentage >= 100 && !error) {
			setShowSuccess(true);
			const timer = setTimeout(() => {
				// Don't auto-close if user has started sharing
				if (!shareUrl) {
					setShowSuccess(false);
					onClose();
				}
			}, 2000);
			successTimerRef.current = timer;
			return () => clearTimeout(timer);
		}
	}, [isExporting, progress, error, onClose, shareUrl]);

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

	const handleCopyToClipboard = async () => {
		if (!exportedFilePath) return;
		setIsCopying(true);
		// Keep dialog open while user interacts
		if (successTimerRef.current) {
			clearTimeout(successTimerRef.current);
			successTimerRef.current = null;
		}
		try {
			const result = await window.electronAPI.copyFileToClipboard(exportedFilePath);
			if (result.success) {
				toast.success("Copied to clipboard");
			} else {
				toast.error(result.error || "Failed to copy to clipboard");
			}
		} catch (err) {
			toast.error(`Failed to copy: ${String(err)}`);
		} finally {
			setIsCopying(false);
		}
	};

	const handleStartShare = async () => {
		if (!exportedFilePath) return;
		setIsStartingShare(true);
		// Keep dialog open while user interacts
		if (successTimerRef.current) {
			clearTimeout(successTimerRef.current);
			successTimerRef.current = null;
		}
		try {
			const result = await window.electronAPI.startShareServer(exportedFilePath);
			if (result.success && result.url) {
				setShareUrl(result.url);
				toast.success("Share server started");
			} else {
				toast.error(result.error || "Failed to start share server");
			}
		} catch (err) {
			toast.error(`Failed to start sharing: ${String(err)}`);
		} finally {
			setIsStartingShare(false);
		}
	};

	const handleStopShare = async () => {
		try {
			await window.electronAPI.stopShareServer();
			setShareUrl(null);
			toast.success("Sharing stopped");
		} catch (err) {
			toast.error(`Failed to stop sharing: ${String(err)}`);
		}
	};

	const handleCopyShareLink = async () => {
		if (!shareUrl) return;
		try {
			await navigator.clipboard.writeText(shareUrl);
			toast.success("Link copied to clipboard");
		} catch (err) {
			toast.error(`Failed to copy link: ${String(err)}`);
		}
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
				className="fixed inset-0 bg-black/70 backdrop-blur-xl z-50 animate-in fade-in duration-200"
				onClick={isExporting ? undefined : onClose}
			/>
			<div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] bg-[#0c0c10]/95 backdrop-blur-2xl rounded-2xl shadow-[0_4px_40px_rgba(0,0,0,0.6)] border border-white/[0.07] p-8 w-[90vw] max-w-md animate-in zoom-in-95 duration-200">
				<div className="flex items-center justify-between mb-6">
					<div className="flex items-center gap-4">
						{showSuccess ? (
							<>
								<div className="w-11 h-11 rounded-full bg-emerald-500/10 flex items-center justify-center ring-1 ring-emerald-400/20">
									<Download className="w-5 h-5 text-emerald-400" />
								</div>
								<div className="flex flex-col gap-1">
									<span className="text-base font-semibold text-white/90">
										{t("export.exportComplete")}
									</span>
									<span className="text-sm text-white/40">
										{t("export.formatReady", undefined, { format: formatLabel.toLowerCase() })}
									</span>
									{exportedFilePath && (
										<div className="flex flex-wrap gap-2 mt-2">
											<Button
												variant="secondary"
												onClick={handleClickShowInFolder}
												className="w-fit px-3 py-1 text-xs rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/60 border-0"
											>
												{t("export.showInFolder")}
											</Button>
											<Button
												variant="secondary"
												onClick={handleCopyToClipboard}
												disabled={isCopying}
												className="w-fit px-3 py-1 text-xs rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/60 border-0"
											>
												{isCopying ? (
													<Loader2 className="w-3 h-3 animate-spin mr-1" />
												) : (
													<Copy className="w-3 h-3 mr-1" />
												)}
												Copy File
											</Button>
											{!shareUrl ? (
												<Button
													variant="secondary"
													onClick={handleStartShare}
													disabled={isStartingShare}
													className="w-fit px-3 py-1 text-xs rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/60 border-0"
												>
													{isStartingShare ? (
														<Loader2 className="w-3 h-3 animate-spin mr-1" />
													) : (
														<Globe className="w-3 h-3 mr-1" />
													)}
													Share Link
												</Button>
											) : (
												<Button
													variant="secondary"
													onClick={handleStopShare}
													className="w-fit px-3 py-1 text-xs rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400/80 border-0"
												>
													<X className="w-3 h-3 mr-1" />
													Stop Sharing
												</Button>
											)}
										</div>
									)}
									{shareUrl && (
										<div className="mt-2 flex items-center gap-2 bg-white/[0.04] rounded-lg px-2 py-1.5 border border-white/[0.06]">
											<span className="text-[11px] text-white/50 font-mono truncate flex-1">
												{shareUrl}
											</span>
											<button
												type="button"
												onClick={handleCopyShareLink}
												className="text-white/40 hover:text-white/70 transition-colors shrink-0"
												title="Copy link"
											>
												<ClipboardCopy className="w-3.5 h-3.5" />
											</button>
										</div>
									)}
									{exportedFilePath && !shareUrl && (
										<span className="text-[11px] text-white/25 break-all max-w-xs mt-1">
											{exportedFilePath.split("/").pop()}
										</span>
									)}
								</div>
							</>
						) : (
							<>
								{isExporting ? (
									<div className="w-11 h-11 rounded-full bg-white/[0.04] flex items-center justify-center ring-1 ring-white/10">
										<Loader2 className="w-5 h-5 text-white/50 animate-spin" />
									</div>
								) : (
									<div className="w-11 h-11 rounded-full bg-white/[0.04] flex items-center justify-center ring-1 ring-white/10">
										<Download className="w-5 h-5 text-white/40" />
									</div>
								)}
								<div className="flex flex-col gap-0.5">
									<span className="text-base font-semibold text-white/90">
										{getTitle()}
									</span>
									<span className="text-sm text-white/35">{getStatusMessage()}</span>
								</div>
							</>
						)}
					</div>
					{!isExporting && (
						<Button
							variant="ghost"
							size="icon"
							onClick={onClose}
							className="hover:bg-white/[0.06] text-white/30 hover:text-white/60 rounded-lg transition-colors h-8 w-8"
						>
							<X className="w-4 h-4" />
						</Button>
					)}
				</div>

				{error && (
					<div className="mb-6 animate-in slide-in-from-top-2">
						<div className="bg-red-500/[0.06] border border-red-500/15 rounded-xl p-3.5 flex items-start gap-3">
							<div className="p-1 bg-red-500/10 rounded-md mt-0.5">
								<X className="w-3.5 h-3.5 text-red-400/80" />
							</div>
							<p className="text-sm text-red-300/80 leading-relaxed">{error}</p>
						</div>
						{!isExporting && canRetrySave && onRetrySave && (
							<Button
								onClick={onRetrySave}
								className="w-full mt-3 py-5 bg-white/[0.06] text-white/70 font-medium hover:bg-white/10 border border-white/[0.07] rounded-xl transition-colors"
							>
								Save Again
							</Button>
						)}
					</div>
				)}

				{isExporting && progress && (
					<div className="space-y-6">
						<div className="space-y-2.5">
							<div className="flex justify-between text-[11px] font-medium text-white/35 uppercase tracking-wider">
								<span>
									{isCompiling || isFinalizing
										? t("export.compiling")
										: t("export.renderingFrames")}
								</span>
								<span className="font-mono text-white/50">
									{isCompiling || isFinalizing ? (
										renderProgress !== undefined && renderProgress > 0 ? (
											`${renderProgress}%`
										) : (
											<span className="flex items-center gap-1.5 text-white/35">
												<Loader2 className="w-3 h-3 animate-spin" />
												{t("export.processing")}
											</span>
										)
									) : (
										`${progress.percentage.toFixed(0)}%`
									)}
								</span>
							</div>
							<div className="h-1.5 bg-white/[0.04] rounded-full overflow-hidden border border-white/[0.04] relative">
								{isCompiling || isFinalizing ? (
									renderProgress !== undefined && renderProgress > 0 ? (
										<div
											className="h-full bg-white/60 transition-all duration-300 ease-out rounded-full"
											style={{ width: `${renderProgress}%` }}
										/>
									) : (
										<div className="h-full w-full relative overflow-hidden rounded-full">
											<div
												className="absolute h-full w-1/3 bg-white/30 rounded-full"
												style={{
													animation: "indeterminate 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite",
												}}
											/>
											<style>{`
                        @keyframes indeterminate {
                          0% { transform: translateX(-150%); }
                          100% { transform: translateX(400%); }
                        }
                      `}</style>
										</div>
									)
								) : (
									<div
										className="h-full bg-white/60 transition-all duration-300 ease-out rounded-full"
										style={{ width: `${Math.min(progress.percentage, 100)}%` }}
									/>
								)}
							</div>
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="bg-white/[0.03] rounded-xl p-3.5 border border-white/[0.05]">
								<div className="text-[10px] font-medium text-white/25 uppercase tracking-wider mb-1">
									{isCompiling || isFinalizing ? t("export.status") : t("export.format")}
								</div>
								<div className="text-white/70 font-medium text-sm">
									{isCompiling || isFinalizing ? t("export.compilingStatus") : formatLabel}
								</div>
							</div>
							<div className="bg-white/[0.03] rounded-xl p-3.5 border border-white/[0.05]">
								<div className="text-[10px] font-medium text-white/25 uppercase tracking-wider mb-1">
									{t("export.frames")}
								</div>
								<div className="text-white/70 font-medium text-sm font-mono">
									{progress.currentFrame} / {progress.totalFrames}
								</div>
							</div>
						</div>

						{onCancel && (
							<div className="pt-2">
								<Button
									onClick={onCancel}
									variant="destructive"
									className="w-full py-5 font-medium bg-red-500/[0.06] text-red-400/80 border border-red-500/15 hover:bg-red-500/10 hover:border-red-500/25 transition-colors rounded-xl"
								>
									{t("export.cancelExport")}
								</Button>
							</div>
						)}
					</div>
				)}

				{showSuccess && (
					<div className="text-center py-3 animate-in zoom-in-95">
						<p className="text-sm text-white/50">
							{t("export.savedSuccess", undefined, { format: formatLabel })}
						</p>
					</div>
				)}
			</div>
		</>
	);
}

import { BarChart3, Check, ChevronDown, ClipboardCopy, Cloud, Copy, Download, Eye, Globe, Loader2, Lock, ShieldCheck, Users, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ExportProgress } from "@/lib/exporter";
import { useScopedT } from "../../contexts/I18nContext";

type SuccessTab = "share" | "cloud" | "protect";

const CLOUD_PRESETS: Record<string, { label: string; endpoint: string }> = {
	aws: { label: "AWS S3", endpoint: "https://s3.amazonaws.com" },
	r2: { label: "Cloudflare R2", endpoint: "https://<account-id>.r2.cloudflarestorage.com" },
	minio: { label: "MinIO", endpoint: "http://localhost:9000" },
	other: { label: "Other", endpoint: "" },
};

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
	const [password, setPassword] = useState("");
	const [isEncrypting, setIsEncrypting] = useState(false);
	const [encryptedFilePath, setEncryptedFilePath] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
	const [s3Config, setS3Config] = useState(() => {
		try {
			const saved = localStorage.getItem("klipt-s3-config");
			if (saved) return JSON.parse(saved) as {
				endpoint: string;
				bucket: string;
				accessKeyId: string;
				secretAccessKey: string;
				region: string;
				pathStyle: boolean;
			};
		} catch { /* ignore */ }
		return {
			endpoint: "",
			bucket: "",
			accessKeyId: "",
			secretAccessKey: "",
			region: "us-east-1",
			pathStyle: false,
		};
	});
	const [analytics, setAnalytics] = useState<ViewerAnalytics | null>(null);
	const [activeTab, setActiveTab] = useState<SuccessTab>("share");
	const [cloudPreset, setCloudPreset] = useState("other");
	const [uploadProgress, setUploadProgress] = useState(0);
	const [isTestingConnection, setIsTestingConnection] = useState(false);
	const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const analyticsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchAnalytics = useCallback(async () => {
		try {
			const result = await window.electronAPI.getShareAnalytics();
			if (result.success && result.analytics) {
				setAnalytics(result.analytics);
			}
		} catch {
			// Silently ignore analytics fetch errors
		}
	}, []);

	// Poll analytics every 5 seconds when share is active
	useEffect(() => {
		if (shareUrl) {
			fetchAnalytics();
			analyticsIntervalRef.current = setInterval(fetchAnalytics, 5000);
		} else {
			setAnalytics(null);
			if (analyticsIntervalRef.current) {
				clearInterval(analyticsIntervalRef.current);
				analyticsIntervalRef.current = null;
			}
		}
		return () => {
			if (analyticsIntervalRef.current) {
				clearInterval(analyticsIntervalRef.current);
				analyticsIntervalRef.current = null;
			}
		};
	}, [shareUrl, fetchAnalytics]);

	// Reset showSuccess when a new export starts or dialog reopens
	useEffect(() => {
		if (isExporting) {
			setShowSuccess(false);
			setPassword("");
			setEncryptedFilePath(null);
			setIsUploading(false);
			setUploadedUrl(null);
			setActiveTab("share");
			setUploadProgress(0);
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
				// Don't auto-close if user has started sharing or cloud upload
				if (!shareUrl && !uploadedUrl) {
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

	const handleEncrypt = async () => {
		if (!exportedFilePath || !password) return;
		setIsEncrypting(true);
		// Keep dialog open while encrypting
		if (successTimerRef.current) {
			clearTimeout(successTimerRef.current);
			successTimerRef.current = null;
		}
		try {
			const result = await window.electronAPI.encryptExportedFile(exportedFilePath, password);
			if (result.success && result.encryptedPath) {
				setEncryptedFilePath(result.encryptedPath);
				toast.success("File encrypted successfully");
			} else {
				toast.error(result.error || "Failed to encrypt file");
			}
		} catch (err) {
			toast.error(`Failed to encrypt: ${String(err)}`);
		} finally {
			setIsEncrypting(false);
		}
	};

	const handleUploadToS3 = async () => {
		if (!exportedFilePath) return;
		if (!s3Config.endpoint || !s3Config.bucket || !s3Config.accessKeyId || !s3Config.secretAccessKey) {
			toast.error("Please fill in all required S3 fields");
			return;
		}
		setIsUploading(true);
		if (successTimerRef.current) {
			clearTimeout(successTimerRef.current);
			successTimerRef.current = null;
		}
		try {
			// Save config (without secret key) to localStorage for reuse
			localStorage.setItem(
				"klipt-s3-config",
				JSON.stringify(s3Config),
			);
			const result = await window.electronAPI.uploadToS3(exportedFilePath, s3Config);
			if (result.success && result.url) {
				setUploadedUrl(result.url);
				toast.success("Uploaded to cloud storage");
			} else {
				toast.error(result.error || "Upload failed");
			}
		} catch (err) {
			toast.error(`Upload failed: ${String(err)}`);
		} finally {
			setIsUploading(false);
		}
	};

	const handleCopyUploadedUrl = async () => {
		if (!uploadedUrl) return;
		try {
			await navigator.clipboard.writeText(uploadedUrl);
			toast.success("URL copied to clipboard");
		} catch (err) {
			toast.error(`Failed to copy URL: ${String(err)}`);
		}
	};

	const handleSelectPreset = (preset: string) => {
		setCloudPreset(preset);
		const presetConfig = CLOUD_PRESETS[preset];
		if (presetConfig && presetConfig.endpoint) {
			setS3Config((c) => ({ ...c, endpoint: presetConfig.endpoint }));
		}
	};

	const handleTestConnection = async () => {
		if (!s3Config.endpoint || !s3Config.bucket || !s3Config.accessKeyId || !s3Config.secretAccessKey) {
			toast.error("Please fill in all required fields first");
			return;
		}
		setIsTestingConnection(true);
		try {
			const result = await window.electronAPI.testS3Connection(s3Config);
			if (result.success) {
				toast.success("Connection successful");
			} else {
				toast.error(result.error || "Connection failed");
			}
		} catch (err) {
			toast.error(`Connection test failed: ${String(err)}`);
		} finally {
			setIsTestingConnection(false);
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

				{showSuccess && exportedFilePath && (
					<div className="animate-in zoom-in-95">
						{/* Tab bar */}
						<div className="flex gap-1 mb-4 bg-white/[0.03] rounded-lg p-1 border border-white/[0.06]">
							{([
								{ id: "share" as const, label: "Share", icon: Globe },
								{ id: "cloud" as const, label: "Cloud", icon: Cloud },
								{ id: "protect" as const, label: "Protect", icon: ShieldCheck },
							]).map(({ id, label, icon: Icon }) => (
								<button
									key={id}
									type="button"
									onClick={() => {
										setActiveTab(id);
										if (successTimerRef.current) {
											clearTimeout(successTimerRef.current);
											successTimerRef.current = null;
										}
									}}
									className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
										activeTab === id
											? "bg-white/[0.08] text-white/80"
											: "text-white/30 hover:text-white/50"
									}`}
								>
									<Icon className="w-3 h-3" />
									{label}
								</button>
							))}
						</div>

						{/* Share tab */}
						{activeTab === "share" && (
							<div className="space-y-3">
								<div className="flex gap-2">
									<Button
										variant="secondary"
										onClick={handleClickShowInFolder}
										className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/60 border-0"
									>
										<Download className="w-3 h-3 mr-1.5" />
										{t("export.showInFolder")}
									</Button>
									<Button
										variant="secondary"
										onClick={handleCopyToClipboard}
										disabled={isCopying}
										className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/60 border-0"
									>
										{isCopying ? (
											<Loader2 className="w-3 h-3 animate-spin mr-1.5" />
										) : (
											<Copy className="w-3 h-3 mr-1.5" />
										)}
										Copy File
									</Button>
								</div>

								<div className="bg-white/[0.03] rounded-lg p-3 border border-white/[0.06] space-y-2.5">
									<div className="flex items-center justify-between">
										<span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">
											Share Link
										</span>
										{!shareUrl ? (
											<Button
												variant="secondary"
												onClick={handleStartShare}
												disabled={isStartingShare}
												className="px-2.5 py-1 text-[11px] rounded-md bg-white/[0.06] hover:bg-white/10 text-white/50 border-0 h-auto"
											>
												{isStartingShare ? (
													<Loader2 className="w-3 h-3 animate-spin mr-1" />
												) : (
													<Globe className="w-3 h-3 mr-1" />
												)}
												Start
											</Button>
										) : (
											<Button
												variant="secondary"
												onClick={handleStopShare}
												className="px-2.5 py-1 text-[11px] rounded-md bg-red-500/10 hover:bg-red-500/20 text-red-400/80 border-0 h-auto"
											>
												<X className="w-3 h-3 mr-1" />
												Stop
											</Button>
										)}
									</div>

									{shareUrl && (
										<>
											<div className="flex items-center gap-2 bg-white/[0.04] rounded-lg px-2 py-1.5 border border-white/[0.06]">
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

											{analytics && (
												<div className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5">
													<div className="flex items-center gap-1.5 mb-2">
														<BarChart3 className="w-3 h-3 text-white/40" />
														<span className="text-[10px] font-medium text-white/40 uppercase tracking-wider">
															Viewer Analytics
														</span>
													</div>
													<div className="grid grid-cols-2 gap-2 mb-2">
														<div className="flex items-center gap-1.5 bg-white/[0.03] rounded-md px-2 py-1.5 border border-white/[0.05]">
															<Eye className="w-3 h-3 text-white/30" />
															<div>
																<div className="text-xs font-medium text-white/70">{analytics.totalViews}</div>
																<div className="text-[9px] text-white/30">Total Views</div>
															</div>
														</div>
														<div className="flex items-center gap-1.5 bg-white/[0.03] rounded-md px-2 py-1.5 border border-white/[0.05]">
															<Users className="w-3 h-3 text-white/30" />
															<div>
																<div className="text-xs font-medium text-white/70">{analytics.uniqueViewers}</div>
																<div className="text-[9px] text-white/30">Unique Viewers</div>
															</div>
														</div>
													</div>
													{analytics.viewEvents.length > 0 && (
														<div className="space-y-1 max-h-24 overflow-y-auto">
															{analytics.viewEvents
																.slice(-5)
																.reverse()
																.map((event, i) => {
																	const time = new Date(event.timestamp);
																	const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
																	const truncatedIp = event.ip.replace(/^::ffff:/, "").replace(/\.\d+$/, ".*");
																	return (
																		<div
																			key={`${event.timestamp}-${i}`}
																			className="flex items-center justify-between text-[10px] text-white/40 px-1.5 py-0.5 rounded bg-white/[0.02]"
																		>
																			<span className="font-mono">{timeStr}</span>
																			<span className="font-mono">{truncatedIp}</span>
																		</div>
																	);
																})}
														</div>
													)}
												</div>
											)}
										</>
									)}
								</div>
							</div>
						)}

						{/* Cloud tab */}
						{activeTab === "cloud" && (
							<div className="space-y-3">
								{uploadedUrl ? (
									<div className="flex items-center gap-2 bg-sky-500/[0.06] rounded-lg px-3 py-2 border border-sky-500/15">
										<Check className="w-3.5 h-3.5 text-sky-400/70 shrink-0" />
										<span className="text-[11px] text-sky-300/70 font-mono truncate flex-1">
											{uploadedUrl}
										</span>
										<button
											type="button"
											onClick={handleCopyUploadedUrl}
											className="text-white/40 hover:text-white/70 transition-colors shrink-0"
											title="Copy URL"
										>
											<ClipboardCopy className="w-3.5 h-3.5" />
										</button>
									</div>
								) : (
									<div className="space-y-2.5 bg-white/[0.03] rounded-lg p-3 border border-white/[0.06]">
										<div className="text-[10px] font-medium text-white/30 uppercase tracking-wider mb-1">
											S3-Compatible Storage
										</div>

										{/* Provider preset */}
										<div className="relative">
											<select
												value={cloudPreset}
												onChange={(e) => handleSelectPreset(e.target.value)}
												className="w-full px-2 py-1.5 text-xs rounded-lg bg-white/[0.06] border border-white/[0.1] text-white/80 outline-none focus:border-white/20 appearance-none cursor-pointer"
											>
												{Object.entries(CLOUD_PRESETS).map(([key, { label }]) => (
													<option key={key} value={key} className="bg-[#1a1a20] text-white/80">
														{label}
													</option>
												))}
											</select>
											<ChevronDown className="w-3 h-3 text-white/30 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
										</div>

										<input
											type="text"
											value={s3Config.endpoint}
											onChange={(e) =>
												setS3Config((c) => ({ ...c, endpoint: e.target.value }))
											}
											placeholder="Endpoint (e.g. https://s3.amazonaws.com)"
											className="w-full px-2 py-1 text-xs rounded-lg bg-white/[0.06] border border-white/[0.1] text-white/80 placeholder:text-white/30 outline-none focus:border-white/20"
										/>
										<input
											type="text"
											value={s3Config.bucket}
											onChange={(e) =>
												setS3Config((c) => ({ ...c, bucket: e.target.value }))
											}
											placeholder="Bucket name"
											className="w-full px-2 py-1 text-xs rounded-lg bg-white/[0.06] border border-white/[0.1] text-white/80 placeholder:text-white/30 outline-none focus:border-white/20"
										/>
										<input
											type="text"
											value={s3Config.accessKeyId}
											onChange={(e) =>
												setS3Config((c) => ({ ...c, accessKeyId: e.target.value }))
											}
											placeholder="Access Key ID"
											className="w-full px-2 py-1 text-xs rounded-lg bg-white/[0.06] border border-white/[0.1] text-white/80 placeholder:text-white/30 outline-none focus:border-white/20"
										/>
										<input
											type="password"
											value={s3Config.secretAccessKey}
											onChange={(e) =>
												setS3Config((c) => ({
													...c,
													secretAccessKey: e.target.value,
												}))
											}
											placeholder="Secret Access Key"
											className="w-full px-2 py-1 text-xs rounded-lg bg-white/[0.06] border border-white/[0.1] text-white/80 placeholder:text-white/30 outline-none focus:border-white/20"
										/>
										<div className="flex gap-2">
											<input
												type="text"
												value={s3Config.region}
												onChange={(e) =>
													setS3Config((c) => ({ ...c, region: e.target.value }))
												}
												placeholder="Region (us-east-1)"
												className="flex-1 px-2 py-1 text-xs rounded-lg bg-white/[0.06] border border-white/[0.1] text-white/80 placeholder:text-white/30 outline-none focus:border-white/20"
											/>
											<label className="flex items-center gap-1 text-[10px] text-white/40 whitespace-nowrap cursor-pointer">
												<input
													type="checkbox"
													checked={s3Config.pathStyle}
													onChange={(e) =>
														setS3Config((c) => ({
															...c,
															pathStyle: e.target.checked,
														}))
													}
													className="rounded"
												/>
												Path style
											</label>
										</div>

										{/* Upload progress */}
										{isUploading && (
											<div className="h-1 bg-white/[0.04] rounded-full overflow-hidden">
												<div
													className="h-full bg-sky-400/60 transition-all duration-300 ease-out rounded-full"
													style={{ width: `${uploadProgress > 0 ? uploadProgress : 100}%`, animation: uploadProgress === 0 ? "indeterminate 1.5s cubic-bezier(0.4, 0, 0.2, 1) infinite" : undefined }}
												/>
											</div>
										)}

										<div className="flex gap-2">
											<Button
												variant="secondary"
												onClick={handleTestConnection}
												disabled={isTestingConnection || isUploading}
												className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/50 border border-white/[0.07]"
											>
												{isTestingConnection ? (
													<Loader2 className="w-3 h-3 animate-spin mr-1" />
												) : (
													<Check className="w-3 h-3 mr-1" />
												)}
												Test
											</Button>
											<Button
												variant="secondary"
												onClick={handleUploadToS3}
												disabled={isUploading}
												className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300/80 border border-sky-500/15"
											>
												{isUploading ? (
													<>
														<Loader2 className="w-3 h-3 animate-spin mr-1" />
														Uploading...
													</>
												) : (
													<>
														<Cloud className="w-3 h-3 mr-1" />
														Upload
													</>
												)}
											</Button>
										</div>
									</div>
								)}
							</div>
						)}

						{/* Protect tab */}
						{activeTab === "protect" && (
							<div className="space-y-3">
								{encryptedFilePath ? (
									<div className="flex items-center gap-2 bg-emerald-500/[0.06] rounded-lg px-3 py-2.5 border border-emerald-500/15">
										<Lock className="w-3.5 h-3.5 text-emerald-400/70 shrink-0" />
										<div className="flex flex-col min-w-0">
											<span className="text-[11px] text-emerald-300/70 font-medium">Encrypted successfully</span>
											<span className="text-[11px] text-emerald-300/50 truncate">
												{encryptedFilePath.split("/").pop() ?? encryptedFilePath.split("\\").pop()}
											</span>
										</div>
									</div>
								) : (
									<div className="bg-white/[0.03] rounded-lg p-4 border border-white/[0.06] space-y-3">
										<div className="flex items-start gap-3">
											<div className="w-8 h-8 rounded-lg bg-white/[0.04] flex items-center justify-center ring-1 ring-white/[0.08] shrink-0">
												<Lock className="w-4 h-4 text-white/40" />
											</div>
											<div>
												<div className="text-xs font-medium text-white/70 mb-0.5">Password Protection</div>
												<p className="text-[11px] text-white/35 leading-relaxed">
													Encrypt the exported file with a password. The recipient will need the password to play it.
												</p>
											</div>
										</div>
										<div className="flex items-center gap-2">
											<input
												type="password"
												value={password}
												onChange={(e) => setPassword(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter" && password) handleEncrypt();
												}}
												placeholder="Enter password"
												className="flex-1 px-2.5 py-1.5 text-xs rounded-lg bg-white/[0.06] border border-white/[0.1] text-white/80 placeholder:text-white/30 outline-none focus:border-white/20"
											/>
											<Button
												variant="secondary"
												onClick={handleEncrypt}
												disabled={isEncrypting || !password}
												className="px-3 py-1.5 text-xs rounded-lg bg-white/[0.06] hover:bg-white/10 text-white/60 border border-white/[0.07]"
											>
												{isEncrypting ? (
													<Loader2 className="w-3 h-3 animate-spin mr-1" />
												) : (
													<Lock className="w-3 h-3 mr-1" />
												)}
												Encrypt
											</Button>
										</div>
									</div>
								)}
							</div>
						)}
					</div>
				)}

				{showSuccess && !exportedFilePath && (
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

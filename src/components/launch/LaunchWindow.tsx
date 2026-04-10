import { Camera, CameraOff, Eye, EyeOff, FolderOpen, Loader2, Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FiMinus, FiX } from "react-icons/fi";
import { MdMic, MdMicOff, MdMonitor, MdVideoFile, MdVolumeOff, MdVolumeUp } from "react-icons/md";
import { RxDragHandleDots2 } from "react-icons/rx";
import { useI18n } from "@/contexts/I18nContext";
import { useWebcamDevices } from "@/hooks/useWebcamDevices";
import { useWebcamRecorder } from "@/hooks/useWebcamRecorder";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { useScopedT } from "../../contexts/I18nContext";
import { useAudioLevelMeter } from "../../hooks/useAudioLevelMeter";
import { useMicrophoneDevices } from "../../hooks/useMicrophoneDevices";
import { useScreenRecorder } from "../../hooks/useScreenRecorder";
import { AudioLevelMeter } from "../ui/audio-level-meter";
import { ContentClamp } from "../ui/content-clamp";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import styles from "./LaunchWindow.module.css";

type WebcamShape = "circle" | "rounded-square" | "square";

const CAMERA_SIZE = 120;

/** Compute height for each of the 5 inline mic-level bars */
function micBarHeight(level: number, index: number): number {
	const thresholds = [10, 25, 45, 65, 85];
	const minH = 4;
	const maxH = 16;
	if (level < thresholds[index]) return minH;
	const ratio = Math.min((level - thresholds[index]) / (100 - thresholds[index]), 1);
	return minH + ratio * (maxH - minH);
}

export function LaunchWindow() {
	const { locale, setLocale } = useI18n();
	const t = useScopedT("launch");

	const LOCALE_LABELS: Record<string, string> = { en: "EN" };
	const {
		recording,
		starting,
		countdownActive,
		toggleRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
		microphoneDeviceId,
		setMicrophoneDeviceId,
		systemAudioEnabled,
		setSystemAudioEnabled,
		countdownDelay,
		setCountdownDelay,
	} = useScreenRecorder();
	const [recordingStart, setRecordingStart] = useState<number | null>(null);
	const [elapsed, setElapsed] = useState(0);
	const showMicControls = microphoneEnabled && !recording;
	const { devices, selectedDeviceId, setSelectedDeviceId } =
		useMicrophoneDevices(microphoneEnabled);
	const { level } = useAudioLevelMeter({
		enabled: showMicControls,
		deviceId: microphoneDeviceId,
	});

	const [cameraEnabled, setCameraEnabled] = useState(false);
	const [webcamShape, setWebcamShape] = useState<WebcamShape>("circle");
	const {
		devices: cameraDevices,
		selectedDeviceId: cameraDeviceId,
		setSelectedDeviceId: setCameraDeviceId,
	} = useWebcamDevices(true);
	const webcamRecorder = useWebcamRecorder({
		enabled: cameraEnabled,
		deviceId: cameraDeviceId,
		previewVisible: true,
	});

	const webcamVideoRef = useRef<HTMLVideoElement>(null);
	const prevRecordingRef = useRef(false);

	// Attach webcam stream to preview video element
	useEffect(() => {
		const video = webcamVideoRef.current;
		if (video && webcamRecorder.stream) {
			video.srcObject = webcamRecorder.stream;
		} else if (video) {
			video.srcObject = null;
		}
	}, [webcamRecorder.stream]);

	// Coordinate webcam with screen recording start/stop.
	// Destructure stable useCallback refs to avoid re-firing on every render
	// (webcamRecorder is a new object each render).
	const { startRecording: startWebcamRecording, stopAndSave: stopWebcamAndSave } = webcamRecorder;
	useEffect(() => {
		const wasRecording = prevRecordingRef.current;
		prevRecordingRef.current = recording;

		if (!wasRecording && recording && cameraEnabled) {
			void startWebcamRecording();
		}

		if (wasRecording && !recording && cameraEnabled) {
			void (async () => {
				const webcamPath = await stopWebcamAndSave();
				if (webcamPath) {
					await window.electronAPI.setCurrentWebcamPath(webcamPath);
				}
			})();
		}
	}, [recording, cameraEnabled, startWebcamRecording, stopWebcamAndSave]);

	const toggleCamera = useCallback(() => {
		if (!recording) {
			setCameraEnabled((prev) => !prev);
		}
	}, [recording]);

	useEffect(() => {
		if (selectedDeviceId && selectedDeviceId !== "default") {
			setMicrophoneDeviceId(selectedDeviceId);
		}
	}, [selectedDeviceId, setMicrophoneDeviceId]);

	// Not a stale closure: recordingStart is null on the first pass, which triggers
	// setRecordingStart(Date.now()). That state update re-runs this effect (via the
	// [recordingStart] dep), and the second pass creates the interval with the real value.
	useEffect(() => {
		let timer: NodeJS.Timeout | null = null;
		if (recording) {
			if (!recordingStart) setRecordingStart(Date.now());
			timer = setInterval(() => {
				if (recordingStart) {
					setElapsed(Math.floor((Date.now() - recordingStart) / 1000));
				}
			}, 1000);
		} else {
			setRecordingStart(null);
			setElapsed(0);
			if (timer) clearInterval(timer);
		}
		return () => {
			if (timer) clearInterval(timer);
		};
	}, [recording, recordingStart]);

	const formatTime = (seconds: number) => {
		const m = Math.floor(seconds / 60)
			.toString()
			.padStart(2, "0");
		const s = (seconds % 60).toString().padStart(2, "0");
		return `${m}:${s}`;
	};

	const [selectedSource, setSelectedSource] = useState("Screen");
	const [hasSelectedSource, setHasSelectedSource] = useState(false);
	const [recordingsDirectory, setRecordingsDirectory] = useState<string | null>(null);
	const [hideHudFromCapture, setHideHudFromCapture] = useState(true);
	const [platform, setPlatform] = useState<string | null>(null);

	useEffect(() => {
		const checkSelectedSource = async () => {
			if (window.electronAPI) {
				const source = await window.electronAPI.getSelectedSource();
				if (source) {
					setSelectedSource(source.name);
					setHasSelectedSource(true);
				} else {
					setSelectedSource("Screen");
					setHasSelectedSource(false);
				}
			}
		};

		void checkSelectedSource();
		// Skip polling during active recording — the source can't change.
		if (recording) return;
		const interval = setInterval(checkSelectedSource, 500);
		return () => clearInterval(interval);
	}, [recording]);

	useEffect(() => {
		let cancelled = false;

		const loadPlatform = async () => {
			try {
				const nextPlatform = await window.electronAPI.getPlatform();
				if (!cancelled) {
					setPlatform(nextPlatform);
				}
			} catch (error) {
				console.error("Failed to load platform:", error);
			}
		};

		void loadPlatform();

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;

		const loadHudCaptureProtection = async () => {
			try {
				const result = await window.electronAPI.getHudOverlayCaptureProtection();
				if (!cancelled && result.success) {
					setHideHudFromCapture(result.enabled);
				}
			} catch (error) {
				console.error("Failed to load HUD capture protection state:", error);
			}
		};

		void loadHudCaptureProtection();

		return () => {
			cancelled = true;
		};
	}, []);

	const openSourceSelector = () => {
		window.electronAPI?.openSourceSelector();
	};

	const openVideoFile = async () => {
		const result = await window.electronAPI.openVideoFilePicker();
		if (result.canceled) {
			return;
		}

		if (result.success && result.path) {
			await window.electronAPI.setCurrentVideoPath(result.path);
			await window.electronAPI.switchToEditor();
		}
	};

	const openProjectFile = async () => {
		const result = await window.electronAPI.loadProjectFile();
		if (result.canceled || !result.success) {
			return;
		}
		await window.electronAPI.switchToEditor();
	};

	// Fire-and-forget IPC calls; failure is non-critical
	const sendHudOverlayHide = () => {
		try {
			void window.electronAPI?.hudOverlayHide?.();
		} catch {
			/* ignore */
		}
	};

	const sendHudOverlayClose = () => {
		try {
			void window.electronAPI?.hudOverlayClose?.();
		} catch {
			/* ignore */
		}
	};

	const toggleHudCaptureProtection = async () => {
		const nextValue = !hideHudFromCapture;

		setHideHudFromCapture(nextValue);

		try {
			const result = await window.electronAPI.setHudOverlayCaptureProtection(nextValue);

			if (!result.success) {
				setHideHudFromCapture(!nextValue);
				return;
			}

			setHideHudFromCapture(result.enabled);
		} catch (error) {
			console.error("Failed to update HUD capture protection:", error);
			setHideHudFromCapture(!nextValue);
		}
	};

	const chooseRecordingsDirectory = async () => {
		const result = await window.electronAPI.chooseRecordingsDirectory();
		if (result.canceled) {
			return;
		}
		if (result.success && result.path) {
			setRecordingsDirectory(result.path);
		}
	};

	useEffect(() => {
		const loadRecordingsDirectory = async () => {
			const result = await window.electronAPI.getRecordingsDirectory();
			if (result.success) {
				setRecordingsDirectory(result.path);
			}
		};

		void loadRecordingsDirectory();
	}, []);

	const recordingsDirectoryName = recordingsDirectory
		? recordingsDirectory.split(/[\\/]/).filter(Boolean).pop() || recordingsDirectory
		: "recordings";
	const dividerClass = styles.separator;
	const supportsHudCaptureProtection = platform !== "linux";

	const toggleMicrophone = () => {
		if (!recording) {
			setMicrophoneEnabled(!microphoneEnabled);
		}
	};

	// Open/close camera bubble as a separate draggable window
	useEffect(() => {
		if (cameraEnabled) {
			window.electronAPI?.openCameraBubble?.(CAMERA_SIZE);
		} else {
			window.electronAPI?.closeCameraBubble?.();
		}
	}, [cameraEnabled]);

	return (
		<div className="flex h-full w-full items-end justify-center overflow-hidden bg-transparent px-3 pb-8 pt-2">
			<div
				className={`flex flex-col items-center gap-3 mx-auto ${styles.electronDrag}`}
			>
				{/* Microphone bar — separate, above main bar */}
				{showMicControls && (
					<div className={`${styles.electronNoDrag} ${styles.micBarWrapper}`}>
						<div className={`flex items-center gap-2 px-4 py-3 ${styles.micBar}`}>
							<select
								value={microphoneDeviceId || selectedDeviceId}
								onChange={(event) => {
									setSelectedDeviceId(event.target.value);
									setMicrophoneDeviceId(event.target.value);
								}}
								className={`max-w-[250px] rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 text-[13px] text-slate-100 outline-none transition-colors hover:bg-white/[0.07] ${styles.micSelect}`}
							>
								{devices.map((device) => (
									<option key={device.deviceId} value={device.deviceId}>
										{device.label}
									</option>
								))}
							</select>
							<AudioLevelMeter level={level} className="w-20 ml-1" />
						</div>
					</div>
				)}

				{/* Camera bubble — opens as separate draggable window */}

				{/* Main HUD Bar */}
				<div className={`${styles.electronDrag} ${styles.hudBarWrapper}`}>
					<div
						className={`mx-auto inline-flex max-w-full items-center gap-1.5 px-4 py-3 ${styles.hudBar}`}
					>
						{/* Drag handle */}
						<div className={`flex items-center ${styles.electronDrag}`}>
							<RxDragHandleDots2 size={16} className="text-white/20" />
						</div>

						{/* Source selector */}
						<button
							type="button"
							className={`inline-flex items-center gap-1.5 px-4 py-2 text-[13px] text-white/70 rounded-lg bg-white/[0.03] transition-colors hover:bg-white/[0.06] disabled:opacity-40 ${styles.electronNoDrag}`}
							onClick={openSourceSelector}
							disabled={recording}
							title={selectedSource}
						>
							<MdMonitor size={16} className="text-white/50" />
							<ContentClamp truncateLength={12}>{selectedSource}</ContentClamp>
						</button>

						<div className={dividerClass} />

						{/* Toggle controls — 26px squares */}
						<div className={`flex items-center gap-1 ${styles.electronNoDrag}`}>
							{supportsHudCaptureProtection && (
								<button
									type="button"
									onClick={() => void toggleHudCaptureProtection()}
									title={
										hideHudFromCapture
											? t("recording.showHudInVideo")
											: t("recording.hideHudFromVideo")
									}
									className={`${styles.toggleBtn} ${
										!hideHudFromCapture ? styles.toggleBtnActiveRed : ""
									}`}
								>
									{hideHudFromCapture ? (
										<EyeOff size={18} strokeWidth={1.5} className="text-white/25" />
									) : (
										<Eye size={18} strokeWidth={1.5} className="text-[#E0000F]" />
									)}
								</button>
							)}

							{/* Camera toggle */}
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button
										type="button"
										onClick={toggleCamera}
										disabled={recording || cameraDevices.length === 0}
										title={
											cameraDevices.length === 0
												? t("recording.camera.noDevices")
												: cameraEnabled
													? t("recording.camera.disable")
													: t("recording.camera.enable")
										}
										className={`${styles.toggleBtn} ${
											cameraEnabled ? styles.toggleBtnActiveGreen : ""
										}`}
									>
										{cameraEnabled ? (
											<Camera size={18} strokeWidth={1.5} className="text-[#22C55E]" />
										) : (
											<CameraOff size={18} strokeWidth={1.5} className="text-white/25" />
										)}
									</button>
								</DropdownMenuTrigger>
								{cameraEnabled && !recording && (
									<DropdownMenuContent
										side="top"
										align="center"
										className={`min-w-[120px] max-h-none overflow-visible ${styles.dropdownGlass}`}
									>
										{/* Camera device selector */}
										{cameraDevices.length > 1 &&
											cameraDevices.map((device) => (
												<DropdownMenuItem
													key={device.deviceId}
													onSelect={() => setCameraDeviceId(device.deviceId)}
													className={`cursor-pointer text-[13px] py-1.5 px-2.5 ${styles.dropdownItem} ${
														cameraDeviceId === device.deviceId
															? "font-medium text-white"
															: "text-white/70"
													}`}
												>
													{device.label}
												</DropdownMenuItem>
											))}
										{/* Shape selector */}
										<div className="flex items-center gap-1 px-4 py-2.5 border-t border-white/5">
											{(["circle", "rounded-square", "square"] as const).map((shape) => (
												<button
													key={shape}
													type="button"
													onClick={() => setWebcamShape(shape)}
													className={`w-6 h-6 rounded text-[13px] flex items-center justify-center transition-colors ${
														webcamShape === shape
															? "bg-white/10 text-white"
															: "bg-white/[0.03] text-white/40 hover:bg-white/[0.06]"
													}`}
												>
													{shape === "circle" ? "\u25CF" : shape === "rounded-square" ? "\u25A2" : "\u25A0"}
												</button>
											))}
										</div>
									</DropdownMenuContent>
								)}
							</DropdownMenu>

							{/* Mic toggle */}
							<button
								type="button"
								onClick={toggleMicrophone}
								disabled={recording}
								title={
									microphoneEnabled
										? t("recording.disableMicrophone")
										: t("recording.enableMicrophone")
								}
								className={`${styles.toggleBtn} ${
									microphoneEnabled ? styles.toggleBtnActiveRed : ""
								}`}
							>
								{microphoneEnabled ? (
									<MdMic size={18} className="text-[#E0000F]" />
								) : (
									<MdMicOff size={18} className="text-white/25" />
								)}
							</button>

							{/* Mic inline level bars — shown when mic active */}
							{microphoneEnabled && (
								<div className={styles.micLevelBars}>
									{[0, 1, 2, 3, 4].map((i) => (
										<div
											key={i}
											className={styles.micLevelBar}
											style={{ height: micBarHeight(level, i) }}
										/>
									))}
								</div>
							)}

							{/* System audio toggle */}
							<button
								type="button"
								onClick={() => setSystemAudioEnabled(!systemAudioEnabled)}
								disabled={recording}
								title={
									systemAudioEnabled
										? t("recording.disableSystemAudio")
										: t("recording.enableSystemAudio")
								}
								className={`${styles.toggleBtn} ${
									systemAudioEnabled ? styles.toggleBtnActiveRed : ""
								}`}
							>
								{systemAudioEnabled ? (
									<MdVolumeUp size={18} className="text-[#E0000F]" />
								) : (
									<MdVolumeOff size={18} className="text-white/25" />
								)}
							</button>
						</div>

						<div className={dividerClass} />

						{/* Record button */}
						{recording ? (
							<div className={`${styles.recordBtnRecording} ${styles.electronNoDrag}`}>
								<span className={styles.pulsingDot} />
								<span
									className="font-mono font-semibold tabular-nums"
									style={{ fontSize: 14, color: "#E0000F" }}
								>
									{formatTime(elapsed)}
								</span>
								<button
									type="button"
									onClick={toggleRecording}
									className={styles.stopBtn}
									title="Stop recording"
								>
									<span className={styles.stopBtnInner} />
								</button>
							</div>
						) : starting ? (
							<div className={`inline-flex items-center gap-1.5 px-4 py-2 ${styles.electronNoDrag}`}>
								<Loader2 size={18} className="animate-spin text-white/50" />
								<span className="text-white/50 font-medium text-[13px]">
									{t("recording.starting")}
								</span>
							</div>
						) : (
							<button
								type="button"
								onClick={hasSelectedSource ? toggleRecording : openSourceSelector}
								disabled={countdownActive || starting || (!hasSelectedSource && !recording)}
								className={`${styles.recordBtnIdle} ${styles.electronNoDrag}`}
							>
								<span className={styles.recordDot} />
								<span className="text-white font-semibold" style={{ fontSize: 13 }}>
									{t("recording.record")}
								</span>
							</button>
						)}

						{/* File path — inline after record */}
						<button
							type="button"
							onClick={chooseRecordingsDirectory}
							disabled={recording}
							title={
								recordingsDirectory
									? t("recording.recordingFolder", undefined, {
											path: recordingsDirectory,
										})
									: t("recording.chooseRecordingsFolder")
							}
							className={`${styles.filePathBtn} ${styles.electronNoDrag}`}
						>
							<FolderOpen size={18} className="text-white/15" />
							<span
								className="text-white/15 underline"
								style={{ fontSize: 11 }}
							>
								<ContentClamp truncateLength={16}>
									{recordingsDirectoryName}
								</ContentClamp>
							</span>
						</button>

						{/* Timer delay — inline pill buttons */}
						<div className={`flex items-center gap-1 ${styles.electronNoDrag}`}>
							<Timer size={18} className="text-white/20" />
							{[0, 3, 5, 10].map((delay) => (
								<button
									key={delay}
									type="button"
									onClick={() => setCountdownDelay(delay)}
									disabled={recording || countdownActive}
									className={`${styles.delayPill} ${
										countdownDelay === delay ? styles.delayPillActive : ""
									}`}
								>
									{delay}s
								</button>
							))}
						</div>

						<div className={dividerClass} />

						{/* Quick actions */}
						<div className={`flex items-center gap-1 ${styles.electronNoDrag}`}>
							<button
								type="button"
								onClick={() => void openVideoFile()}
								disabled={recording}
								title={t("recording.openVideoFile")}
								className={styles.quickActionBtn}
							>
								<MdVideoFile size={17} className="text-white/15" />
							</button>
							<button
								type="button"
								onClick={() => void openProjectFile()}
								disabled={recording}
								title={t("recording.openProject")}
								className={styles.quickActionBtn}
							>
								<FolderOpen size={16} className="text-white/15" />
							</button>
						</div>

						{/* Language selector */}
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									title="Language"
									className={`${styles.quickActionBtn} ${styles.electronNoDrag}`}
									style={{ fontSize: 11, color: "rgba(255,255,255,0.15)" }}
								>
									{LOCALE_LABELS[locale] ?? locale}
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								side="top"
								align="end"
								className={`min-w-[80px] ${styles.dropdownGlass}`}
							>
								{SUPPORTED_LOCALES.map((code) => (
									<DropdownMenuItem
										key={code}
										onSelect={() => setLocale(code as AppLocale)}
										className={`text-[13px] py-1.5 px-2.5 cursor-pointer ${styles.dropdownItem} ${
											locale === code ? "text-white font-medium" : "text-white/70"
										}`}
									>
										{LOCALE_LABELS[code] ?? code}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>

						<div className={dividerClass} />

						{/* Minimize + Close */}
						<div className={`flex items-center gap-0.5 ${styles.electronNoDrag}`}>
							<button
								type="button"
								onClick={sendHudOverlayHide}
								title={t("recording.hideHud")}
								className={styles.windowControlBtn}
							>
								<FiMinus size={18} className="text-white/12 hover:text-white/30" />
							</button>
							<button
								type="button"
								onClick={sendHudOverlayClose}
								title={t("recording.closeApp")}
								className={styles.windowControlBtn}
							>
								<FiX size={18} className="text-white/12 hover:text-white/30" />
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

import { Camera, CameraOff, Eye, EyeOff, Languages, Loader2, Timer } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BsRecordCircle } from "react-icons/bs";
import { FaRegStopCircle } from "react-icons/fa";
import { FaFolderOpen } from "react-icons/fa6";
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
import { Button } from "../ui/button";
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
const HUD_BAR_STYLE = { minHeight: 52 } as const;

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

	// Coordinate webcam with screen recording start/stop
	useEffect(() => {
		const wasRecording = prevRecordingRef.current;
		prevRecordingRef.current = recording;

		if (!wasRecording && recording && cameraEnabled) {
			void webcamRecorder.startRecording();
		}

		if (wasRecording && !recording && cameraEnabled) {
			void (async () => {
				const webcamPath = await webcamRecorder.stopAndSave();
				if (webcamPath) {
					await window.electronAPI.setCurrentWebcamPath(webcamPath);
				}
			})();
		}
	}, [recording, cameraEnabled, webcamRecorder]);

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
		const interval = setInterval(checkSelectedSource, 500);
		return () => clearInterval(interval);
	}, []);

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
			<div className={`flex flex-col items-center gap-4 mx-auto ${styles.electronDrag} ${styles.floatingHud}`}>

				{/* Microphone bar */}
				{showMicControls && (
					<div className={`${styles.electronNoDrag} ${styles.micBarWrapper}`}>
						<div className={`flex items-center gap-2 px-4 py-2.5 ${styles.micBar}`}>
							<select
								value={microphoneDeviceId || selectedDeviceId}
								onChange={(event) => {
									setSelectedDeviceId(event.target.value);
									setMicrophoneDeviceId(event.target.value);
								}}
								className={`max-w-[220px] rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-100 outline-none transition-colors hover:bg-white/[0.07] ${styles.micSelect}`}
							>
								{devices.map((device) => (
									<option key={device.deviceId} value={device.deviceId}>
										{device.label}
									</option>
								))}
							</select>
							<AudioLevelMeter level={level} className="w-24 ml-2" />
						</div>
					</div>
				)}

				{/* Camera bubble — opens as separate draggable window */}

				{/* Main HUD Bar */}
				<div className={`${styles.electronDrag} ${styles.hudBarWrapper}`}>
					<div
						className={`mx-auto inline-flex max-w-full items-center gap-2 px-4 py-2.5 ${styles.hudBar}`}
						style={HUD_BAR_STYLE}
					>
					{/* Drag handle */}
					<div className={`flex items-center px-0.5 ${styles.electronDrag}`}>
						<RxDragHandleDots2 size={15} className="text-white/25" />
					</div>

					{/* Source selector */}
					<Button
						variant="link"
						size="sm"
						className={`gap-1.5 text-white/90 bg-transparent px-2.5 py-1.5 text-sm rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
						onClick={openSourceSelector}
						disabled={recording}
						title={selectedSource}
					>
						<MdMonitor size={17} className="text-white/80" />
						<ContentClamp truncateLength={12}>{selectedSource}</ContentClamp>
					</Button>

					<div className={dividerClass} />

					{/* Toggle controls group */}
					<div className={`flex items-center gap-1.5 ${styles.electronNoDrag}`}>
						{supportsHudCaptureProtection && (
							<Button
								variant="link"
								size="icon"
								onClick={() => void toggleHudCaptureProtection()}
								title={
									hideHudFromCapture
										? t("recording.showHudInVideo")
										: t("recording.hideHudFromVideo")
								}
								className={`text-white/90 rounded-xl ${styles.hudBtn} ${
									!hideHudFromCapture ? styles.toggleBtnActive : ""
								}`}
							>
								{hideHudFromCapture ? (
									<EyeOff size={18} className="text-white/40" />
								) : (
									<Eye size={18} className="text-blue-400" />
								)}
							</Button>
						)}
						<Button
							variant="link"
							size="icon"
							onClick={() => setSystemAudioEnabled(!systemAudioEnabled)}
							disabled={recording}
							title={
								systemAudioEnabled
									? t("recording.disableSystemAudio")
									: t("recording.enableSystemAudio")
							}
							className={`text-white/90 rounded-xl ${styles.hudBtn} ${
								systemAudioEnabled ? styles.toggleBtnActive : ""
							}`}
						>
							{systemAudioEnabled ? (
								<MdVolumeUp size={18} className="text-blue-400" />
							) : (
								<MdVolumeOff size={18} className="text-white/40" />
							)}
						</Button>
						<Button
							variant="link"
							size="icon"
							onClick={toggleMicrophone}
							disabled={recording}
							title={
								microphoneEnabled
									? t("recording.disableMicrophone")
									: t("recording.enableMicrophone")
							}
							className={`text-white/90 rounded-xl ${styles.hudBtn} ${
								microphoneEnabled ? styles.toggleBtnActive : ""
							}`}
						>
							{microphoneEnabled ? (
								<MdMic size={18} className="text-blue-400" />
							) : (
								<MdMicOff size={18} className="text-white/40" />
							)}
						</Button>
						<Button
							variant="link"
							size="icon"
							onClick={toggleCamera}
							disabled={recording || cameraDevices.length === 0}
							title={
								cameraDevices.length === 0
									? t("recording.camera.noDevices")
									: cameraEnabled
										? t("recording.camera.disable")
										: t("recording.camera.enable")
							}
							className={`text-white/90 rounded-xl ${styles.hudBtn} ${
								cameraEnabled ? styles.toggleBtnActiveGreen : ""
							}`}
						>
							{cameraEnabled ? (
								<Camera size={18} className="text-green-400" />
							) : (
								<CameraOff size={18} className="text-white/40" />
							)}
						</Button>
					</div>

					{/* Camera device selector — hidden with 1 device */}
					{cameraEnabled && cameraDevices.length > 1 && !recording && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="link"
									size="sm"
									title={t("recording.camera.enable")}
									className={`gap-1.5 px-2 py-1.5 text-sm text-white/80 rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
								>
									<Camera size={16} />
									<ContentClamp truncateLength={10}>
										{cameraDevices.find((d) => d.deviceId === cameraDeviceId)?.label ?? "Camera"}
									</ContentClamp>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								side="top"
								align="center"
								className={`min-w-[120px] max-h-none overflow-visible ${styles.dropdownGlass}`}
							>
								{cameraDevices.map((device) => (
									<DropdownMenuItem
										key={device.deviceId}
										onSelect={() => setCameraDeviceId(device.deviceId)}
										className={`cursor-pointer text-sm py-2 px-3 ${styles.dropdownItem} ${
											cameraDeviceId === device.deviceId
												? "font-medium text-white"
												: "text-white/70"
										}`}
									>
										{device.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					)}

					{/* Camera shape selector */}
					{cameraEnabled && !recording && (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="link"
									size="sm"
									title="Camera shape"
									className={`px-2 py-1.5 text-xs text-white/70 rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
								>
									{webcamShape === "circle"
										? "\u25CF"
										: webcamShape === "rounded-square"
											? "\u25A2"
											: "\u25A0"}
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								side="top"
								align="center"
								className={`min-w-[100px] max-h-none overflow-visible ${styles.dropdownGlass}`}
							>
								<DropdownMenuItem
									onSelect={() => setWebcamShape("circle")}
									className={`cursor-pointer text-sm py-2 px-3 ${styles.dropdownItem} ${webcamShape === "circle" ? "font-medium text-white" : "text-white/70"}`}
								>
									Circle
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => setWebcamShape("rounded-square")}
									className={`cursor-pointer text-sm py-2 px-3 ${styles.dropdownItem} ${webcamShape === "rounded-square" ? "font-medium text-white" : "text-white/70"}`}
								>
									Rounded
								</DropdownMenuItem>
								<DropdownMenuItem
									onSelect={() => setWebcamShape("square")}
									className={`cursor-pointer text-sm py-2 px-3 ${styles.dropdownItem} ${webcamShape === "square" ? "font-medium text-white" : "text-white/70"}`}
								>
									Square
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}

					<div className={dividerClass} />

					{/* Countdown delay */}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="link"
								size="sm"
								disabled={recording || countdownActive}
								title={t("recording.countdownDelay")}
								className={`gap-1.5 px-2 py-1.5 text-sm text-white/80 rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
							>
								<Timer size={16} />
								<span>{countdownDelay > 0 ? `${countdownDelay}s` : t("recording.noDelay")}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent
							side="top"
							align="center"
							className={`min-w-[80px] max-h-none overflow-visible ${styles.dropdownGlass}`}
						>
							{[0, 3, 5, 10].map((delay) => (
								<DropdownMenuItem
									key={delay}
									onSelect={() => setCountdownDelay(delay)}
									className={`cursor-pointer text-sm py-2 px-3 ${styles.dropdownItem} ${
										countdownDelay === delay ? "font-medium text-white" : "text-white/70"
									}`}
								>
									{delay === 0 ? t("recording.noDelay") : `${delay}s`}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>

					{/* Record button */}
					<Button
						variant="link"
						size="sm"
						onClick={hasSelectedSource ? toggleRecording : openSourceSelector}
						disabled={countdownActive || starting || (!hasSelectedSource && !recording)}
						className={`gap-2 px-3 py-1.5 text-sm ml-1 rounded-full ${styles.electronNoDrag} ${styles.hudBtn} ${
							recording ? styles.recordBtnRecording : !starting ? styles.recordBtnIdle : ""
						}`}
					>
						{recording ? (
							<>
								<FaRegStopCircle size={18} className={`text-red-400 ${styles.pulseRecord}`} />
								<span className="text-red-400 font-bold tabular-nums drop-shadow-[0_0_4px_rgba(239,68,68,0.8)]">{formatTime(elapsed)}</span>
							</>
						) : starting ? (
							<>
								<Loader2 size={18} className="animate-spin text-white/70" />
								<span className="text-white/70 font-medium tracking-wide">{t("recording.starting")}</span>
							</>
						) : (
							<>
								<BsRecordCircle
									size={18}
									className={hasSelectedSource ? "text-white drop-shadow-[0_0_4px_rgba(255,255,255,0.8)]" : "text-white/40"}
								/>
								<span className={hasSelectedSource ? "text-white font-medium tracking-wide drop-shadow-[0_0_2px_rgba(255,255,255,0.8)]" : "text-white/40"}>
									{t("recording.record")}
								</span>
							</>
						)}
					</Button>

					{/* Recordings folder */}
					<Button
						variant="link"
						size="sm"
						onClick={chooseRecordingsDirectory}
						disabled={recording}
						title={
							recordingsDirectory
								? t("recording.recordingFolder", undefined, {
										path: recordingsDirectory,
									})
								: t("recording.chooseRecordingsFolder")
						}
						className={`text-white/70 px-2 py-1.5 ml-1 text-sm underline decoration-white/30 underline-offset-4 rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
					>
						<ContentClamp truncateLength={24}>
							{t("recording.folderPath", undefined, {
								name: recordingsDirectoryName,
							})}
						</ContentClamp>
					</Button>

					{/* Right-side actions */}
					<div className="ml-auto flex items-center gap-1.5">
						<div className={dividerClass} />
						<Button
							variant="link"
							size="icon"
							onClick={openVideoFile}
							disabled={recording}
							title={t("recording.openVideoFile")}
							className={`text-white/80 rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
						>
							<MdVideoFile size={18} />
						</Button>
						<Button
							variant="link"
							size="icon"
							onClick={openProjectFile}
							disabled={recording}
							title={t("recording.openProject")}
							className={`text-white/80 rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
						>
							<FaFolderOpen size={17} />
						</Button>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="link"
									size="icon"
									title="Language"
									className={`text-white/80 rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
								>
									<Languages size={17} />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								side="top"
								align="end"
								className={`min-w-[90px] ${styles.dropdownGlass}`}
							>
								{SUPPORTED_LOCALES.map((code) => (
									<DropdownMenuItem
										key={code}
										onSelect={() => setLocale(code as AppLocale)}
										className={`text-sm py-2 px-3 cursor-pointer ${styles.dropdownItem} ${
											locale === code ? "text-white font-medium" : "text-white/70"
										}`}
									>
										{LOCALE_LABELS[code] ?? code}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
						<div className={dividerClass} />
						<Button
							variant="link"
							size="icon"
							onClick={sendHudOverlayHide}
							title={t("recording.hideHud")}
							className={`text-white/80 rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
						>
							<FiMinus size={18} />
						</Button>
						<Button
							variant="link"
							size="icon"
							onClick={sendHudOverlayClose}
							title={t("recording.closeApp")}
							className={`text-white/80 rounded-xl ${styles.electronNoDrag} ${styles.hudBtn}`}
						>
							<FiX size={18} />
						</Button>
					</div>
				</div>
				</div>
			</div>
		</div>
	);
}

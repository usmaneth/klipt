import type { Span } from "dnd-timeline";
import {
	ChevronDown,
	Download,
	FolderOpen,
	Languages,
	Redo2,
	Search,
	Share,
	Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { toast } from "sonner";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { getAssetPath } from "@/lib/assetPath";
import { SFX_DURATIONS } from "@/lib/audio/soundEffectSynth";
import {
	calculateOutputDimensions,
	type ExportFormat,
	type ExportProgress,
	type ExportQuality,
	type ExportSettings,
	GIF_SIZE_PRESETS,
	GifExporter,
	type GifFrameRate,
	type GifSizePreset,
	VideoExporter,
} from "@/lib/exporter";
import { canFastExport } from "@/lib/exporter/fastExport";
import { matchesShortcut } from "@/lib/shortcuts";
import { type HighlightCandidate, detectHighlights } from "@/lib/ai/highlightDetector";
import { DEFAULT_WALLPAPER_RELATIVE_PATH } from "@/lib/wallpapers";
import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { CommandPalette } from "./CommandPalette";
import {
	type AISuggestion,
	CreativeWorkspace,
	type ScratchPadClip,
	type WorkspaceNote,
	type WorkspacePanel,
} from "./CreativeWorkspace";
import type { CaptionCue } from "./captionLayout";
import type { CaptionSettings } from "./captionStyle";
import { DEFAULT_CAPTION_SETTINGS } from "./captionStyle";
import { ExportDialog } from "./ExportDialog";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import PlaybackControls from "./PlaybackControls";
import { ProjectBrowserDialog } from "./ProjectBrowserDialog";
import {
	createProjectData,
	deriveNextId,
	fromFileUrl,
	normalizeProjectEditor,
	toFileUrl,
	validateProjectData,
} from "./projectPersistence";
import { SettingsPanel } from "./SettingsPanel";
import TimelineEditor from "./timeline/TimelineEditor";
import {
	detectInteractionCandidates,
	normalizeCursorTelemetry,
} from "./timeline/zoomSuggestionUtils";
import {
	type AnnotationRegion,
	type AudioRegion,
	type ColorCorrectionProfile,
	type CropRegion,
	type CursorStyle,
	type CursorTelemetryPoint,
	clampFocusToDepth,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_ZOOM_DEPTH,
	type AutoStopDuration,
	type ClickHighlightSize,
	DEFAULT_CLICK_HIGHLIGHT_SETTINGS,
	DEFAULT_RECORDING_TIMER_SETTINGS,
	type FaceBlurRegion,
	type FaceBlurStyle,
	type FigureData,
	type PlaybackSpeed,
	type SoundEffectId,
	type SoundEffectRegion,
	type SpeedRegion,
	type TimelineComment,
	type TransitionRegion,
	type TransitionType,
	type TrimRegion,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomRegion,
} from "./types";
import { ClickHighlightOverlay, type ClickEvent } from "./ClickHighlightOverlay";
import VideoPlayback, { VideoPlaybackRef } from "./VideoPlayback";
import {
	buildLoopedCursorTelemetry,
	getDisplayedTimelineWindowMs,
} from "./videoPlayback/cursorLoopTelemetry";
import { findDominantRegion } from "./videoPlayback/zoomRegionUtils";

const LOOP_CURSOR_END_WINDOW_MS = 670;

// Static style constants extracted from JSX to avoid re-creating on every render
const STYLE_PREVIEW_CONTAINER: React.CSSProperties = { flex: "1 1 auto", margin: "12px 0 0" };
const STYLE_PLAYBACK_CONTROLS_WRAPPER: React.CSSProperties = {
	height: "64px",
	flexShrink: 0,
	padding: "8px 24px",
	margin: "8px 0 16px 0",
};
const STYLE_PLAYBACK_CONTROLS_INNER: React.CSSProperties = { width: "100%", maxWidth: "700px" };

function formatAiMs(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

type EditorHistorySnapshot = {
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	soundEffectRegions: SoundEffectRegion[];
	transitionRegions: TransitionRegion[];
	selectedZoomId: string | null;
	selectedTrimId: string | null;
	selectedSpeedId: string | null;
	selectedAnnotationId: string | null;
	selectedAudioId: string | null;
};

type PendingExportSave = {
	fileName: string;
	arrayBuffer: ArrayBuffer;
};

function LanguageSwitcher() {
	const { locale, setLocale, t } = useI18n();
	const idx = SUPPORTED_LOCALES.indexOf(locale as (typeof SUPPORTED_LOCALES)[number]);
	const next = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length] as AppLocale;
	const labels: Record<string, string> = {
		en: "EN",
	};
	return (
		<button
			type="button"
			onClick={() => setLocale(next)}
			className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-white/30 transition hover:text-white/60 cursor-pointer"
			title={t("common.app.language", "Language")}
			aria-label={t("common.app.language", "Language")}
		>
			<Languages className="h-3.5 w-3.5" />
			<span className="text-[11px] font-normal">{labels[locale] ?? locale.toUpperCase()}</span>
		</button>
	);
}

export default function VideoEditor() {
	const { t } = useI18n();
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const [videoPath, setVideoPath] = useState<string | null>(null);
	const [videoSourcePath, setVideoSourcePath] = useState<string | null>(null);
	const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);
	const [wallpaper, setWallpaper] = useState<string>(initialEditorPreferences.wallpaper);
	const [shadowIntensity, setShadowIntensity] = useState(initialEditorPreferences.shadowIntensity);
	const [backgroundBlur, setBackgroundBlur] = useState(initialEditorPreferences.backgroundBlur);
	const [zoomMotionBlur, setZoomMotionBlur] = useState(initialEditorPreferences.zoomMotionBlur);
	const [connectZooms, setConnectZooms] = useState(initialEditorPreferences.connectZooms);
	const [showCursor, setShowCursor] = useState(initialEditorPreferences.showCursor);
	const [loopCursor, setLoopCursor] = useState(initialEditorPreferences.loopCursor);
	const [cursorSize, setCursorSize] = useState(initialEditorPreferences.cursorSize);
	const [cursorSmoothing, setCursorSmoothing] = useState(initialEditorPreferences.cursorSmoothing);
	const [cursorMotionBlur, setCursorMotionBlur] = useState(
		initialEditorPreferences.cursorMotionBlur,
	);
	const [cursorClickBounce, setCursorClickBounce] = useState(
		initialEditorPreferences.cursorClickBounce,
	);
	const [cursorSway, setCursorSway] = useState(initialEditorPreferences.cursorSway);
	const [cursorStyle, setCursorStyle] = useState<CursorStyle>("default");
	const [borderRadius, setBorderRadius] = useState(initialEditorPreferences.borderRadius);
	const [padding, setPadding] = useState(initialEditorPreferences.padding);
	const [cropRegion, setCropRegion] = useState<CropRegion>(initialEditorPreferences.cropRegion);
	const [zoomRegions, setZoomRegions] = useState<ZoomRegion[]>([]);
	const [cursorTelemetry, setCursorTelemetry] = useState<CursorTelemetryPoint[]>([]);
	const [selectedZoomId, setSelectedZoomId] = useState<string | null>(null);
	const [trimRegions, setTrimRegions] = useState<TrimRegion[]>([]);
	const [cuttingRoomFloor, setCuttingRoomFloor] = useState<TrimRegion[]>([]);
	const [selectedTrimId, setSelectedTrimId] = useState<string | null>(null);
	const [speedRegions, setSpeedRegions] = useState<SpeedRegion[]>([]);
	const [selectedSpeedId, setSelectedSpeedId] = useState<string | null>(null);
	const [annotationRegions, setAnnotationRegions] = useState<AnnotationRegion[]>([]);
	const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
	const [audioRegions, setAudioRegions] = useState<AudioRegion[]>([]);
	const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
	const [soundEffectRegions, setSoundEffectRegions] = useState<SoundEffectRegion[]>([]);
	const [transitionRegions, setTransitionRegions] = useState<TransitionRegion[]>([]);
	const [audioEnhanced, setAudioEnhanced] = useState(false);
	const [enhancedAudioUrl, setEnhancedAudioUrl] = useState<string | null>(null);
	const [isExporting, setIsExporting] = useState(false);
	const [isMouseMoving, setIsMouseMoving] = useState(true);
	const [activeWorkspacePanel, setActiveWorkspacePanel] = useState<WorkspacePanel | null>(null);
	const [workspaceNotes, setWorkspaceNotes] = useState<WorkspaceNote[]>([]);
	const [timelineComments, setTimelineComments] = useState<TimelineComment[]>([]);
	const [scratchPadClips, setScratchPadClips] = useState<ScratchPadClip[]>([]);
	const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([]);
	const [aiAnalysisProgress, setAiAnalysisProgress] = useState<number | null>(null);
	const [highlights, setHighlights] = useState<HighlightCandidate[]>([]);
	const [isDetectingHighlights, setIsDetectingHighlights] = useState(false);
	const [captionCues, setCaptionCues] = useState<CaptionCue[]>([]);
	const [captionSettings, setCaptionSettings] = useState<CaptionSettings>(DEFAULT_CAPTION_SETTINGS);
	const [isTranscribingCaptions, setIsTranscribingCaptions] = useState(false);
	const [captionTranscriptionProgress, setCaptionTranscriptionProgress] = useState<number | null>(
		null,
	);
	const [captionTranscriptionLabel, setCaptionTranscriptionLabel] = useState<string | null>(null);
	const [translatedCaptionCues, setTranslatedCaptionCues] = useState<CaptionCue[] | null>(null);
	const [captionTranslationLang, setCaptionTranslationLang] = useState<string | null>(null);
	const [isTranslatingCaptions, setIsTranslatingCaptions] = useState(false);
	const [captionTranslationProgress, setCaptionTranslationProgress] = useState<number | null>(null);

	// Scene detection state
	const [sceneMarkers, setSceneMarkers] = useState<Array<{ timeMs: number; confidence: number }>>([]);
	const [isDetectingScenes, setIsDetectingScenes] = useState(false);

	// Dubbing state
	const [dubbedAudioPath, setDubbedAudioPath] = useState<string | null>(null);
	const [isDubbing, setIsDubbing] = useState(false);
	const [dubbingProgress, setDubbingProgress] = useState<{
		phase: string;
		percent: number;
		message: string;
	} | null>(null);
	const [useDubbedAudio, setUseDubbedAudio] = useState(false);

	// Face Detection & Auto-Blur state
	const [faceBlurRegions, setFaceBlurRegions] = useState<FaceBlurRegion[]>([]);
	const [isDetectingFaces, setIsDetectingFaces] = useState(false);
	const [faceDetectionProgress, setFaceDetectionProgress] = useState<number | null>(null);

	// Auto Color Correction state
	const [colorCorrectionProfile, setColorCorrectionProfile] =
		useState<ColorCorrectionProfile | null>(null);
	const [isColorCorrecting, setIsColorCorrecting] = useState(false);
	const [originalVideoPath, setOriginalVideoPath] = useState<string | null>(null);

	// Click Highlight state
	const [clickHighlightEnabled, setClickHighlightEnabled] = useState(
		DEFAULT_CLICK_HIGHLIGHT_SETTINGS.enabled,
	);
	const [clickHighlightColor, setClickHighlightColor] = useState(
		DEFAULT_CLICK_HIGHLIGHT_SETTINGS.color,
	);
	const [clickHighlightSize, setClickHighlightSize] = useState<ClickHighlightSize>(
		DEFAULT_CLICK_HIGHLIGHT_SETTINGS.size,
	);

	// Recording Timer state
	const [recordingAutoStopMs, setRecordingAutoStopMs] = useState<AutoStopDuration>(
		DEFAULT_RECORDING_TIMER_SETTINGS.autoStopMs,
	);
	const [recordingShowTimerOverlay, setRecordingShowTimerOverlay] = useState(
		DEFAULT_RECORDING_TIMER_SETTINGS.showTimerOverlay,
	);

	useEffect(() => {
		let timeout: NodeJS.Timeout;
		const handleMouseMove = () => {
			setIsMouseMoving(true);
			clearTimeout(timeout);
			timeout = setTimeout(() => setIsMouseMoving(false), 2000);
		};
		window.addEventListener("mousemove", handleMouseMove);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			clearTimeout(timeout);
		};
	}, []);

	const isFocusVoid = isPlaying && !isMouseMoving && !isExporting;

	const [ambilightEnabled, setAmbilightEnabled] = useState(true);
	const ambilightCanvasRef = useRef<HTMLCanvasElement>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);

	// Setup AudioContext for Ambilight (Polling until video ref is available)
	useEffect(() => {
		let audioCtx: AudioContext;
		let source: MediaElementAudioSourceNode;
		let analyser: AnalyserNode;
		let checkInterval: NodeJS.Timeout;

		const initAudio = (video: HTMLVideoElement) => {
			if (analyserRef.current) return;
			try {
				audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
				analyser = audioCtx.createAnalyser();
				analyser.fftSize = 256;

				if (!(video as any)._audioSourceConnected) {
					source = audioCtx.createMediaElementSource(video);
					source.connect(analyser);
					analyser.connect(audioCtx.destination);
					(video as any)._audioSourceConnected = true;
				}
				analyserRef.current = analyser;
			} catch (e) {
				console.warn("AudioContext setup failed:", e);
			}
		};

		checkInterval = setInterval(() => {
			const video = videoPlaybackRef.current?.video;
			if (video) {
				clearInterval(checkInterval);
				video.addEventListener("play", () => initAudio(video), { once: true });
			}
		}, 500);

		return () => {
			clearInterval(checkInterval);
			if (audioCtx) audioCtx.close().catch(() => {});
		};
	}, [videoPath]);

	// Ambilight Update Loop (High Performance DOM mutation)
	useEffect(() => {
		let rafId: number;
		let lastDrawTime = 0;
		let audioDataArray: Uint8Array;
		let currentVolume = 0;

		const updateAmbilight = (timestamp: number) => {
			const video = videoPlaybackRef.current?.video;
			const canvas = ambilightCanvasRef.current;

			if (video && canvas && !video.paused && timestamp - lastDrawTime > 60) {
				const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
				if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
					canvas.width = 128;
					canvas.height = Math.floor(128 * (video.videoHeight / video.videoWidth));
					ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
					lastDrawTime = timestamp;
				}
			}

			if (analyserRef.current && video && !video.paused) {
				if (!audioDataArray) audioDataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
				analyserRef.current.getByteFrequencyData(audioDataArray as any);
				let sum = 0;
				for (let i = 0; i < audioDataArray.length; i++) {
					sum += audioDataArray[i];
				}
				const avg = sum / audioDataArray.length;
				currentVolume = currentVolume * 0.8 + (avg / 255) * 0.2;
			} else {
				currentVolume = currentVolume * 0.9;
			}

			// Direct DOM mutation for 60fps performance without React renders
			if (canvas) {
				canvas.style.opacity = (0.5 + currentVolume * 1.5).toString();
				canvas.style.transform = `scale(${1.1 + currentVolume * 0.3})`;
			}

			rafId = requestAnimationFrame(updateAmbilight);
		};

		rafId = requestAnimationFrame(updateAmbilight);
		return () => cancelAnimationFrame(rafId);
	}, []);

	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [exportError, setExportError] = useState<string | null>(null);
	const [showExportDialog, setShowExportDialog] = useState(false);
	const [showCommandPalette, setShowCommandPalette] = useState(false);
	const [showProjectBrowser, setShowProjectBrowser] = useState(false);
	const [aspectRatio, setAspectRatio] = useState<AspectRatio>(initialEditorPreferences.aspectRatio);
	const [exportQuality, setExportQuality] = useState<ExportQuality>(
		initialEditorPreferences.exportQuality,
	);
	const [exportFormat, setExportFormat] = useState<ExportFormat>(
		initialEditorPreferences.exportFormat,
	);
	const [gifFrameRate, setGifFrameRate] = useState<GifFrameRate>(
		initialEditorPreferences.gifFrameRate,
	);
	const [gifLoop, setGifLoop] = useState(initialEditorPreferences.gifLoop);
	const [gifSizePreset, setGifSizePreset] = useState<GifSizePreset>(
		initialEditorPreferences.gifSizePreset,
	);
	const [exportedFilePath, setExportedFilePath] = useState<string | undefined>(undefined);
	const [hasPendingExportSave, setHasPendingExportSave] = useState(false);
	const pendingExportFormatRef = useRef<boolean>(false);
	const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string | null>(null);
	const [projectName, setProjectName] = useState("Untitled Project");
	const [isEditingProjectName, setIsEditingProjectName] = useState(false);

	// Webcam overlay state
	const [webcamPath, setWebcamPath] = useState<string | null>(null);
	const [webcamVisible, setWebcamVisible] = useState(true);
	const [webcamShape, setWebcamShape] = useState<"circle" | "rounded-rect" | "square">("circle");
	const [webcamSize, setWebcamSize] = useState(150);
	const [webcamOpacity, setWebcamOpacity] = useState(100);
	const [webcamBorderColor, setWebcamBorderColor] = useState("#ffffff");
	const [webcamBorderWidth, setWebcamBorderWidth] = useState(2);
	const [webcamShadow, setWebcamShadow] = useState(30);
	const [webcamPosition, setWebcamPosition] = useState({ x: 0.9, y: 0.85 });
	const [webcamBgMode, setWebcamBgMode] = useState<"none" | "remove" | "blur" | "color">("none");
	const [webcamBgBlur, setWebcamBgBlur] = useState(10);
	const [webcamBgColor, setWebcamBgColor] = useState("#00FF00");

	const videoPlaybackRef = useRef<VideoPlaybackRef>(null);
	const nextZoomIdRef = useRef(1);
	const nextTrimIdRef = useRef(1);
	const nextSpeedIdRef = useRef(1);
	const nextAudioIdRef = useRef(1);
	const nextSfxIdRef = useRef(1);
	const nextTransitionIdRef = useRef(1);

	const { shortcuts, isMac } = useShortcuts();
	const nextAnnotationIdRef = useRef(1);
	const nextAnnotationZIndexRef = useRef(1); // Track z-index for stacking order
	const exporterRef = useRef<VideoExporter | null>(null);
	const autoSuggestedVideoPathRef = useRef<string | null>(null);
	const historyPastRef = useRef<EditorHistorySnapshot[]>([]);
	const historyFutureRef = useRef<EditorHistorySnapshot[]>([]);
	const historyCurrentRef = useRef<EditorHistorySnapshot | null>(null);
	const applyingHistoryRef = useRef(false);
	const pendingExportSaveRef = useRef<PendingExportSave | null>(null);

	const cloneSnapshot = useCallback((snapshot: EditorHistorySnapshot): EditorHistorySnapshot => {
		return {
			zoomRegions: JSON.parse(JSON.stringify(snapshot.zoomRegions)),
			trimRegions: JSON.parse(JSON.stringify(snapshot.trimRegions)),
			speedRegions: JSON.parse(JSON.stringify(snapshot.speedRegions)),
			annotationRegions: JSON.parse(JSON.stringify(snapshot.annotationRegions)),
			audioRegions: JSON.parse(JSON.stringify(snapshot.audioRegions)),
			soundEffectRegions: JSON.parse(JSON.stringify(snapshot.soundEffectRegions)),
			transitionRegions: JSON.parse(JSON.stringify(snapshot.transitionRegions)),
			selectedZoomId: snapshot.selectedZoomId,
			selectedTrimId: snapshot.selectedTrimId,
			selectedSpeedId: snapshot.selectedSpeedId,
			selectedAnnotationId: snapshot.selectedAnnotationId,
			selectedAudioId: snapshot.selectedAudioId,
		};
	}, []);

	const buildHistorySnapshot = useCallback((): EditorHistorySnapshot => {
		return {
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			soundEffectRegions,
			transitionRegions,
			selectedZoomId,
			selectedTrimId,
			selectedSpeedId,
			selectedAnnotationId,
			selectedAudioId,
		};
	}, [
		zoomRegions,
		trimRegions,
		speedRegions,
		annotationRegions,
		audioRegions,
		soundEffectRegions,
		transitionRegions,
		selectedZoomId,
		selectedTrimId,
		selectedSpeedId,
		selectedAnnotationId,
		selectedAudioId,
	]);

	const applyHistorySnapshot = useCallback(
		(snapshot: EditorHistorySnapshot) => {
			applyingHistoryRef.current = true;
			const cloned = cloneSnapshot(snapshot);
			setZoomRegions(cloned.zoomRegions);
			setTrimRegions(cloned.trimRegions);
			setSpeedRegions(cloned.speedRegions);
			setAnnotationRegions(cloned.annotationRegions);
			setAudioRegions(cloned.audioRegions);
			setSoundEffectRegions(cloned.soundEffectRegions);
			setTransitionRegions(cloned.transitionRegions);
			setSelectedZoomId(cloned.selectedZoomId);
			setSelectedTrimId(cloned.selectedTrimId);
			setSelectedSpeedId(cloned.selectedSpeedId);
			setSelectedAnnotationId(cloned.selectedAnnotationId);
			setSelectedAudioId(cloned.selectedAudioId);

			nextZoomIdRef.current = deriveNextId(
				"zoom",
				cloned.zoomRegions.map((region) => region.id),
			);
			nextTrimIdRef.current = deriveNextId(
				"trim",
				cloned.trimRegions.map((region) => region.id),
			);
			nextSpeedIdRef.current = deriveNextId(
				"speed",
				cloned.speedRegions.map((region) => region.id),
			);
			nextAnnotationIdRef.current = deriveNextId(
				"annotation",
				cloned.annotationRegions.map((region) => region.id),
			);
			nextAudioIdRef.current = deriveNextId(
				"audio",
				cloned.audioRegions.map((region) => region.id),
			);
			nextAnnotationZIndexRef.current =
				cloned.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) + 1;
		},
		[cloneSnapshot],
	);

	const handleUndo = useCallback(() => {
		if (historyPastRef.current.length === 0) return;

		const current = historyCurrentRef.current ?? cloneSnapshot(buildHistorySnapshot());
		const previous = historyPastRef.current.pop();
		if (!previous) return;

		historyFutureRef.current.push(cloneSnapshot(current));
		historyCurrentRef.current = cloneSnapshot(previous);
		applyHistorySnapshot(previous);
	}, [applyHistorySnapshot, buildHistorySnapshot, cloneSnapshot]);

	const handleRedo = useCallback(() => {
		if (historyFutureRef.current.length === 0) return;

		const current = historyCurrentRef.current ?? cloneSnapshot(buildHistorySnapshot());
		const next = historyFutureRef.current.pop();
		if (!next) return;

		historyPastRef.current.push(cloneSnapshot(current));
		historyCurrentRef.current = cloneSnapshot(next);
		applyHistorySnapshot(next);
	}, [applyHistorySnapshot, buildHistorySnapshot, cloneSnapshot]);

	const applyLoadedProject = useCallback(async (candidate: unknown, path?: string | null) => {
		if (!validateProjectData(candidate)) {
			return false;
		}

		const project = candidate;
		const sourcePath = fromFileUrl(project.videoPath);
		const normalizedEditor = normalizeProjectEditor(project.editor);

		try {
			videoPlaybackRef.current?.pause();
		} catch {
			// no-op
		}
		setIsPlaying(false);
		setCurrentTime(0);
		setDuration(0);

		setError(null);
		setVideoSourcePath(sourcePath);
		setVideoPath(toFileUrl(sourcePath));
		setCurrentProjectPath(path ?? null);

		setWallpaper(normalizedEditor.wallpaper);
		setShadowIntensity(normalizedEditor.shadowIntensity);
		setBackgroundBlur(normalizedEditor.backgroundBlur);
		setZoomMotionBlur(normalizedEditor.zoomMotionBlur);
		setConnectZooms(normalizedEditor.connectZooms);
		setShowCursor(normalizedEditor.showCursor);
		setLoopCursor(normalizedEditor.loopCursor);
		setCursorSize(normalizedEditor.cursorSize);
		setCursorSmoothing(normalizedEditor.cursorSmoothing);
		setCursorMotionBlur(normalizedEditor.cursorMotionBlur);
		setCursorClickBounce(normalizedEditor.cursorClickBounce);
		setCursorSway(normalizedEditor.cursorSway);
		setBorderRadius(normalizedEditor.borderRadius);
		setPadding(normalizedEditor.padding);
		setCropRegion(normalizedEditor.cropRegion);
		setZoomRegions(normalizedEditor.zoomRegions);
		setTrimRegions(normalizedEditor.trimRegions);
		setSpeedRegions(normalizedEditor.speedRegions);
		setAnnotationRegions(normalizedEditor.annotationRegions);
		setAudioRegions(normalizedEditor.audioRegions);
		setSoundEffectRegions(normalizedEditor.soundEffectRegions ?? []);
		setTransitionRegions(normalizedEditor.transitionRegions ?? []);
		setTimelineComments(normalizedEditor.timelineComments ?? []);
		setAspectRatio(normalizedEditor.aspectRatio);
		setExportQuality(normalizedEditor.exportQuality);
		setExportFormat(normalizedEditor.exportFormat);
		setGifFrameRate(normalizedEditor.gifFrameRate);
		setGifLoop(normalizedEditor.gifLoop);
		setGifSizePreset(normalizedEditor.gifSizePreset);

		// Restore webcam state from project
		if (normalizedEditor.webcam) {
			setWebcamPath(normalizedEditor.webcam.path);
			setWebcamVisible(normalizedEditor.webcam.visible);
			setWebcamShape(normalizedEditor.webcam.shape);
			setWebcamSize(normalizedEditor.webcam.size);
			setWebcamOpacity(normalizedEditor.webcam.opacity);
			setWebcamBorderColor(normalizedEditor.webcam.borderColor);
			setWebcamBorderWidth(normalizedEditor.webcam.borderWidth);
			setWebcamShadow(normalizedEditor.webcam.shadow);
			setWebcamPosition(normalizedEditor.webcam.position);
		} else {
			setWebcamPath(null);
			setWebcamVisible(true);
			setWebcamShape("circle");
			setWebcamSize(150);
			setWebcamOpacity(100);
			setWebcamBorderColor("#ffffff");
			setWebcamBorderWidth(2);
			setWebcamShadow(30);
			setWebcamPosition({ x: 0.9, y: 0.85 });
		}

		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedSpeedId(null);
		setSelectedAnnotationId(null);
		setSelectedAudioId(null);

		nextZoomIdRef.current = deriveNextId(
			"zoom",
			normalizedEditor.zoomRegions.map((region) => region.id),
		);
		nextTrimIdRef.current = deriveNextId(
			"trim",
			normalizedEditor.trimRegions.map((region) => region.id),
		);
		nextSpeedIdRef.current = deriveNextId(
			"speed",
			normalizedEditor.speedRegions.map((region) => region.id),
		);
		nextAudioIdRef.current = deriveNextId(
			"audio",
			normalizedEditor.audioRegions.map((region) => region.id),
		);
		nextAnnotationIdRef.current = deriveNextId(
			"annotation",
			normalizedEditor.annotationRegions.map((region) => region.id),
		);
		nextAnnotationZIndexRef.current =
			normalizedEditor.annotationRegions.reduce((max, region) => Math.max(max, region.zIndex), 0) +
			1;

		setLastSavedSnapshot(JSON.stringify(createProjectData(sourcePath, normalizedEditor)));
		return true;
	}, []);

	const currentProjectSnapshot = useMemo(() => {
		const sourcePath = videoSourcePath ?? (videoPath ? fromFileUrl(videoPath) : null);
		if (!sourcePath) {
			return null;
		}
		return JSON.stringify(
			createProjectData(sourcePath, {
				wallpaper,
				shadowIntensity,
				backgroundBlur,
				zoomMotionBlur,
				connectZooms,
				showCursor,
				loopCursor,
				cursorSize,
				cursorSmoothing,
				cursorMotionBlur,
				cursorClickBounce,
				cursorSway,
				borderRadius,
				padding,
				cropRegion,
				zoomRegions,
				trimRegions,
				speedRegions,
				annotationRegions,
				audioRegions,
				soundEffectRegions,
				transitionRegions,
				timelineComments,
				aspectRatio,
				exportQuality,
				exportFormat,
				gifFrameRate,
				gifLoop,
				gifSizePreset,
				webcam: webcamPath
					? {
							path: webcamPath,
							visible: webcamVisible,
							shape: webcamShape,
							size: webcamSize,
							opacity: webcamOpacity,
							borderColor: webcamBorderColor,
							borderWidth: webcamBorderWidth,
							shadow: webcamShadow,
							position: webcamPosition,
						}
					: undefined,
			}),
		);
	}, [
		videoPath,
		videoSourcePath,
		wallpaper,
		shadowIntensity,
		backgroundBlur,
		zoomMotionBlur,
		connectZooms,
		showCursor,
		loopCursor,
		cursorSize,
		cursorSmoothing,
		cursorMotionBlur,
		cursorClickBounce,
		cursorSway,
		borderRadius,
		padding,
		cropRegion,
		zoomRegions,
		trimRegions,
		speedRegions,
		audioRegions,
		annotationRegions,
		timelineComments,
		aspectRatio,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		webcamPath,
		webcamVisible,
		webcamShape,
		webcamSize,
		webcamOpacity,
		webcamBorderColor,
		webcamBorderWidth,
		webcamShadow,
		webcamPosition,
	]);

	useEffect(() => {
		const snapshot = cloneSnapshot(buildHistorySnapshot());

		if (!historyCurrentRef.current) {
			historyCurrentRef.current = snapshot;
			return;
		}

		if (applyingHistoryRef.current) {
			historyCurrentRef.current = snapshot;
			applyingHistoryRef.current = false;
			return;
		}

		const currentSerialized = JSON.stringify(historyCurrentRef.current);
		const nextSerialized = JSON.stringify(snapshot);
		if (currentSerialized === nextSerialized) {
			return;
		}

		historyPastRef.current.push(cloneSnapshot(historyCurrentRef.current));
		if (historyPastRef.current.length > 100) {
			historyPastRef.current.shift();
		}
		historyCurrentRef.current = snapshot;
		historyFutureRef.current = [];
	}, [buildHistorySnapshot, cloneSnapshot]);

	const hasUnsavedChanges = Boolean(
		currentProjectPath &&
			currentProjectSnapshot &&
			lastSavedSnapshot &&
			currentProjectSnapshot !== lastSavedSnapshot,
	);

	useEffect(() => {
		async function loadInitialData() {
			try {
				const currentProjectResult = await window.electronAPI.loadCurrentProjectFile();
				if (currentProjectResult.success && currentProjectResult.project) {
					const restored = await applyLoadedProject(
						currentProjectResult.project,
						currentProjectResult.path ?? null,
					);
					if (restored) {
						return;
					}
				}

				const result = await window.electronAPI.getCurrentVideoPath();
				if (result.success && result.path) {
					const sourcePath = fromFileUrl(result.path);
					setVideoSourcePath(sourcePath);
					setVideoPath(toFileUrl(sourcePath));
					setCurrentProjectPath(null);
					setLastSavedSnapshot(null);
				} else {
					setError("No video to load. Please record or select a video.");
				}
			} catch (err) {
				setError("Error loading video: " + String(err));
			} finally {
				setLoading(false);
			}
		}

		loadInitialData();
	}, [applyLoadedProject]);

	// On mount, check for webcam recording from the capture session
	useEffect(() => {
		window.electronAPI.getCurrentWebcamPath().then((result) => {
			if (result.success && result.path) {
				setWebcamPath(result.path);
			}
		});
	}, []);

	useEffect(() => {
		saveEditorPreferences({
			wallpaper,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			connectZooms,
			showCursor,
			loopCursor,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorSway,
			borderRadius,
			padding,
			cropRegion,
			aspectRatio,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
		});
	}, [
		wallpaper,
		shadowIntensity,
		backgroundBlur,
		zoomMotionBlur,
		connectZooms,
		showCursor,
		loopCursor,
		cursorSize,
		cursorSmoothing,
		cursorMotionBlur,
		cursorClickBounce,
		cursorSway,
		borderRadius,
		padding,
		cropRegion,
		aspectRatio,
		exportQuality,
		exportFormat,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
	]);

	const saveProject = useCallback(
		async (forceSaveAs: boolean) => {
			if (!videoPath) {
				toast.error("No video loaded");
				return;
			}

			const sourcePath = videoSourcePath ?? fromFileUrl(videoPath);
			if (!sourcePath) {
				toast.error("Unable to determine source video path");
				return;
			}

			const projectData = createProjectData(sourcePath, {
				wallpaper,
				shadowIntensity,
				backgroundBlur,
				zoomMotionBlur,
				connectZooms,
				showCursor,
				loopCursor,
				cursorSize,
				cursorSmoothing,
				cursorMotionBlur,
				cursorClickBounce,
				cursorSway,
				borderRadius,
				padding,
				cropRegion,
				zoomRegions,
				trimRegions,
				speedRegions,
				annotationRegions,
				audioRegions,
				soundEffectRegions,
				transitionRegions,
				timelineComments,
				aspectRatio,
				exportQuality,
				exportFormat,
				gifFrameRate,
				gifLoop,
				gifSizePreset,
				webcam: webcamPath
					? {
							path: webcamPath,
							visible: webcamVisible,
							shape: webcamShape,
							size: webcamSize,
							opacity: webcamOpacity,
							borderColor: webcamBorderColor,
							borderWidth: webcamBorderWidth,
							shadow: webcamShadow,
							position: webcamPosition,
						}
					: undefined,
			});

			const fileNameBase =
				projectName && projectName !== "Untitled Project"
					? projectName
					: sourcePath
							.split(/[\\/]/)
							.pop()
							?.replace(/\.[^.]+$/, "") || `project-${Date.now()}`;
			const projectSnapshot = JSON.stringify(projectData);
			const result = await window.electronAPI.saveProjectFile(
				projectData,
				fileNameBase,
				forceSaveAs ? undefined : (currentProjectPath ?? undefined),
			);

			if (result.canceled) {
				toast.info("Project save canceled");
				return;
			}

			if (!result.success) {
				toast.error(result.message || "Failed to save project");
				return;
			}

			if (result.path) {
				setCurrentProjectPath(result.path);
			}
			setLastSavedSnapshot(projectSnapshot);

			toast.success(`Project saved to ${result.path}`);
		},
		[
			videoPath,
			videoSourcePath,
			currentProjectPath,
			projectName,
			wallpaper,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			connectZooms,
			showCursor,
			loopCursor,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorSway,
			borderRadius,
			padding,
			cropRegion,
			zoomRegions,
			trimRegions,
			speedRegions,
			annotationRegions,
			audioRegions,
			aspectRatio,
			exportQuality,
			exportFormat,
			gifFrameRate,
			gifLoop,
			gifSizePreset,
			webcamPath,
			webcamVisible,
			webcamShape,
			webcamSize,
			webcamOpacity,
			webcamBorderColor,
			webcamBorderWidth,
			webcamShadow,
			webcamPosition,
		],
	);

	useEffect(() => {
		const handleBeforeUnload = (event: BeforeUnloadEvent) => {
			if (!hasUnsavedChanges) {
				return;
			}

			event.preventDefault();
			event.returnValue = "";
		};

		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [hasUnsavedChanges]);

	useEffect(() => {
		window.electronAPI.setHasUnsavedChanges(hasUnsavedChanges);
	}, [hasUnsavedChanges]);

	useEffect(() => {
		const cleanup = window.electronAPI.onRequestSaveBeforeClose(async () => {
			await saveProject(false);
		});

		return () => cleanup?.();
	}, [saveProject]);

	const handleSaveProject = useCallback(async () => {
		await saveProject(false);
	}, [saveProject]);

	const handleSaveProjectAs = useCallback(async () => {
		await saveProject(true);
	}, [saveProject]);

	const handleLoadProject = useCallback(async () => {
		const result = await window.electronAPI.loadProjectFile();

		if (result.canceled) {
			return;
		}

		if (!result.success) {
			toast.error(result.message || "Failed to load project");
			return;
		}

		const restored = await applyLoadedProject(result.project, result.path ?? null);
		if (!restored) {
			toast.error("Invalid project file format");
			return;
		}

		toast.success(`Project loaded from ${result.path}`);
	}, [applyLoadedProject]);

	useEffect(() => {
		const removeLoadListener = window.electronAPI.onMenuLoadProject(handleLoadProject);
		const removeSaveListener = window.electronAPI.onMenuSaveProject(handleSaveProject);
		const removeSaveAsListener = window.electronAPI.onMenuSaveProjectAs(handleSaveProjectAs);

		return () => {
			removeLoadListener?.();
			removeSaveListener?.();
			removeSaveAsListener?.();
		};
	}, [handleLoadProject, handleSaveProject, handleSaveProjectAs]);

	useEffect(() => {
		let mounted = true;

		async function loadCursorTelemetry() {
			if (!videoPath) {
				if (mounted) {
					setCursorTelemetry([]);
				}
				return;
			}

			try {
				const result = await window.electronAPI.getCursorTelemetry(fromFileUrl(videoPath));
				if (mounted) {
					setCursorTelemetry(result.success ? result.samples : []);
				}
			} catch (telemetryError) {
				console.warn("Unable to load cursor telemetry:", telemetryError);
				if (mounted) {
					setCursorTelemetry([]);
				}
			}
		}

		loadCursorTelemetry();

		return () => {
			mounted = false;
		};
	}, [videoPath]);

	const normalizedCursorTelemetry = useMemo(() => {
		if (cursorTelemetry.length === 0) {
			return [] as CursorTelemetryPoint[];
		}

		const totalMs = Math.max(0, Math.round(duration * 1000));
		return normalizeCursorTelemetry(
			cursorTelemetry,
			totalMs > 0 ? totalMs : Number.MAX_SAFE_INTEGER,
		);
	}, [cursorTelemetry, duration]);

	const displayedTimelineWindow = useMemo(() => {
		const totalMs = Math.max(0, Math.round(duration * 1000));
		return getDisplayedTimelineWindowMs(totalMs, trimRegions);
	}, [duration, trimRegions]);

	const effectiveCursorTelemetry = useMemo(() => {
		if (!loopCursor) {
			return normalizedCursorTelemetry;
		}

		if (
			normalizedCursorTelemetry.length < 2 ||
			displayedTimelineWindow.endMs <= displayedTimelineWindow.startMs
		) {
			return normalizedCursorTelemetry;
		}

		return buildLoopedCursorTelemetry(
			normalizedCursorTelemetry,
			displayedTimelineWindow.endMs,
			displayedTimelineWindow.startMs,
		);
	}, [loopCursor, normalizedCursorTelemetry, displayedTimelineWindow]);

	// Extract click events from cursor telemetry for click highlight overlay
	const clickEvents = useMemo<ClickEvent[]>(() => {
		if (!clickHighlightEnabled) return [];
		return effectiveCursorTelemetry
			.filter(
				(p) =>
					p.interactionType === "click" ||
					p.interactionType === "double-click" ||
					p.interactionType === "right-click" ||
					p.interactionType === "middle-click",
			)
			.map((p) => ({ timeMs: p.timeMs, x: p.cx, y: p.cy }));
	}, [effectiveCursorTelemetry, clickHighlightEnabled]);

	const effectiveZoomRegions = useMemo(() => {
		if (!loopCursor || zoomRegions.length === 0) {
			return zoomRegions;
		}

		if (displayedTimelineWindow.endMs <= displayedTimelineWindow.startMs) {
			return zoomRegions;
		}

		const dominantAtStart = findDominantRegion(zoomRegions, displayedTimelineWindow.startMs, {
			connectZooms,
		}).region;
		if (!dominantAtStart) {
			return zoomRegions;
		}

		const endWindowStartMs = Math.max(
			displayedTimelineWindow.startMs,
			displayedTimelineWindow.endMs - LOOP_CURSOR_END_WINDOW_MS,
		);
		const loopEndRegion: ZoomRegion = {
			id: `${dominantAtStart.id}__loop-end-sync`,
			startMs: endWindowStartMs,
			endMs: displayedTimelineWindow.endMs,
			depth: dominantAtStart.depth,
			focus: {
				cx: dominantAtStart.focus.cx,
				cy: dominantAtStart.focus.cy,
			},
		};

		return [...zoomRegions.filter((region) => region.id !== loopEndRegion.id), loopEndRegion];
	}, [loopCursor, zoomRegions, displayedTimelineWindow, connectZooms]);

	useEffect(() => {
		if (
			!videoPath ||
			duration <= 0 ||
			zoomRegions.length > 0 ||
			normalizedCursorTelemetry.length < 2
		) {
			return;
		}

		if (autoSuggestedVideoPathRef.current === videoPath) {
			return;
		}

		const totalMs = Math.max(0, Math.round(duration * 1000));
		if (totalMs <= 0) {
			return;
		}

		const candidates = detectInteractionCandidates(normalizedCursorTelemetry);
		if (candidates.length === 0) {
			autoSuggestedVideoPathRef.current = videoPath;
			return;
		}

		const DEFAULT_DURATION_MS = 1100;
		const MIN_SPACING_MS = 1800;
		const sortedCandidates = [...candidates].sort((a, b) => b.strength - a.strength);
		const acceptedCenters: number[] = [];

		setZoomRegions((prev) => {
			if (prev.length > 0) {
				return prev;
			}

			const reservedSpans: Array<{ start: number; end: number }> = [];
			const additions: ZoomRegion[] = [];
			let nextId = nextZoomIdRef.current;

			sortedCandidates.forEach((candidate) => {
				const tooCloseToAccepted = acceptedCenters.some(
					(center) => Math.abs(center - candidate.centerTimeMs) < MIN_SPACING_MS,
				);
				if (tooCloseToAccepted) {
					return;
				}

				const centeredStart = Math.round(candidate.centerTimeMs - DEFAULT_DURATION_MS / 2);
				const startMs = Math.max(0, Math.min(centeredStart, totalMs - DEFAULT_DURATION_MS));
				const endMs = Math.min(totalMs, startMs + DEFAULT_DURATION_MS);

				const hasOverlap = reservedSpans.some((span) => endMs > span.start && startMs < span.end);
				if (hasOverlap) {
					return;
				}

				additions.push({
					id: `zoom-${nextId++}`,
					startMs,
					endMs,
					depth: DEFAULT_ZOOM_DEPTH,
					focus: clampFocusToDepth(candidate.focus, DEFAULT_ZOOM_DEPTH),
				});
				reservedSpans.push({ start: startMs, end: endMs });
				acceptedCenters.push(candidate.centerTimeMs);
			});

			if (additions.length === 0) {
				return prev;
			}

			nextZoomIdRef.current = nextId;
			return [...prev, ...additions];
		});

		autoSuggestedVideoPathRef.current = videoPath;
	}, [videoPath, duration, normalizedCursorTelemetry, zoomRegions.length]);

	// Initialize default wallpaper with resolved asset path
	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				const resolvedPath = await getAssetPath(DEFAULT_WALLPAPER_RELATIVE_PATH);
				if (mounted) {
					setWallpaper(resolvedPath);
				}
			} catch (err) {
				// If resolution fails, keep the fallback
				console.warn("Failed to resolve default wallpaper path:", err);
			}
		})();
		return () => {
			mounted = false;
		};
	}, []);

	const togglePlayPause = useCallback(() => {
		const playback = videoPlaybackRef.current;
		const video = playback?.video;
		if (!playback || !video) return;

		if (isPlaying) {
			playback.pause();
		} else {
			playback.play().catch((err: unknown) => console.error("Video play failed:", err));
		}
	}, [isPlaying]);

	const handleSeek = useCallback((time: number) => {
		const video = videoPlaybackRef.current?.video;
		if (!video) return;
		video.currentTime = time;
	}, []);

	const handleSelectZoom = useCallback((id: string | null) => {
		setSelectedZoomId(id);
		if (id) {
			setSelectedTrimId(null);
			setSelectedAudioId(null);
		}
	}, []);

	const handleSelectTrim = useCallback((id: string | null) => {
		setSelectedTrimId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
		}
	}, []);

	const handleSelectAnnotation = useCallback((id: string | null) => {
		setSelectedAnnotationId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAudioId(null);
		}
	}, []);

	const handleZoomAdded = useCallback((span: Span) => {
		const id = `zoom-${nextZoomIdRef.current++}`;
		const newRegion: ZoomRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			depth: DEFAULT_ZOOM_DEPTH,
			focus: { cx: 0.5, cy: 0.5 },
		};
		setZoomRegions((prev) => [...prev, newRegion]);
		setSelectedZoomId(id);
		setSelectedTrimId(null);
		setSelectedAnnotationId(null);
	}, []);

	const handleZoomSuggested = useCallback((span: Span, focus: ZoomFocus) => {
		const id = `zoom-${nextZoomIdRef.current++}`;
		const newRegion: ZoomRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			depth: DEFAULT_ZOOM_DEPTH,
			focus: clampFocusToDepth(focus, DEFAULT_ZOOM_DEPTH),
		};
		setZoomRegions((prev) => [...prev, newRegion]);
		setSelectedZoomId(id);
		setSelectedTrimId(null);
		setSelectedAnnotationId(null);
	}, []);

	const handleAutoZoomFace = useCallback(async () => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		const sourcePath = videoSourcePath ?? fromFileUrl(videoPath);
		toast.info("Detecting face regions...");

		try {
			const result = await window.electronAPI.detectFaceRegions(sourcePath, 2000);

			if (!result.success || !result.faceRegions || result.faceRegions.length === 0) {
				toast.info("No face regions detected in this recording.", {
					description: result.error ?? "Try a recording with more on-screen activity.",
				});
				return;
			}

			// Group consecutive face positions into zoom spans.
			// If face center stays within a threshold for 5+ seconds, merge into one region.
			const MERGE_THRESHOLD = 0.15; // normalized distance threshold
			const MIN_SPAN_MS = 3000; // minimum 3s to create a zoom region
			const ZOOM_PADDING_MS = 500; // padding before/after the detected span

			interface FaceGroup {
				startMs: number;
				endMs: number;
				samples: Array<{ cx: number; cy: number }>;
			}

			const groups: FaceGroup[] = [];
			let currentGroup: FaceGroup | null = null;

			for (const sample of result.faceRegions) {
				if (!currentGroup) {
					currentGroup = {
						startMs: sample.timeMs,
						endMs: sample.timeMs,
						samples: [{ cx: sample.cx, cy: sample.cy }],
					};
					continue;
				}

				const avgCx =
					currentGroup.samples.reduce((s, p) => s + p.cx, 0) / currentGroup.samples.length;
				const avgCy =
					currentGroup.samples.reduce((s, p) => s + p.cy, 0) / currentGroup.samples.length;
				const dist = Math.hypot(sample.cx - avgCx, sample.cy - avgCy);

				if (dist <= MERGE_THRESHOLD) {
					currentGroup.endMs = sample.timeMs;
					currentGroup.samples.push({ cx: sample.cx, cy: sample.cy });
				} else {
					groups.push(currentGroup);
					currentGroup = {
						startMs: sample.timeMs,
						endMs: sample.timeMs,
						samples: [{ cx: sample.cx, cy: sample.cy }],
					};
				}
			}
			if (currentGroup) {
				groups.push(currentGroup);
			}

			// Filter to groups with sufficient duration and build zoom regions
			const existingSpans = zoomRegions
				.map((r) => ({ start: r.startMs, end: r.endMs }))
				.sort((a, b) => a.start - b.start);

			let addedCount = 0;

			for (const group of groups) {
				const spanDuration = group.endMs - group.startMs;
				if (spanDuration < MIN_SPAN_MS) continue;

				const startMs = Math.max(0, group.startMs - ZOOM_PADDING_MS);
				const endMs = group.endMs + ZOOM_PADDING_MS;

				// Skip if overlapping existing zoom regions
				const hasOverlap = existingSpans.some(
					(span) => endMs > span.start && startMs < span.end,
				);
				if (hasOverlap) continue;

				const avgCx =
					group.samples.reduce((s, p) => s + p.cx, 0) / group.samples.length;
				const avgCy =
					group.samples.reduce((s, p) => s + p.cy, 0) / group.samples.length;

				const focus: ZoomFocus = { cx: avgCx, cy: avgCy };

				handleZoomSuggested(
					{ start: startMs, end: endMs },
					focus,
				);

				existingSpans.push({ start: startMs, end: endMs });
				addedCount++;
			}

			if (addedCount === 0) {
				toast.info("No usable face regions found.", {
					description:
						"Detected regions overlap existing zooms or are too short.",
				});
			} else {
				toast.success(
					`Added ${addedCount} face-tracked zoom${addedCount === 1 ? "" : "s"}`,
				);
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error("Face detection failed", { description: message });
		}
	}, [videoPath, videoSourcePath, zoomRegions, handleZoomSuggested]);

	const handleTrimAdded = useCallback((span: Span) => {
		const id = `trim-${nextTrimIdRef.current++}`;
		const newRegion: TrimRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
		};
		setTrimRegions((prev) => [...prev, newRegion]);
		setSelectedTrimId(id);
		setSelectedZoomId(null);
		setSelectedAnnotationId(null);
	}, []);

	const handleAutoSilenceCut = useCallback(async () => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		try {
			toast.info("Analyzing audio for silences...");
			const result = await window.electronAPI.detectSilences(videoPath, {
				thresholdDb: -30,
				minDurationMs: 500,
				paddingMs: 200,
			});

			if (!result.success) {
				toast.error(`Silence detection failed: ${result.error}`);
				return;
			}

			if (result.silences.length === 0) {
				toast.info("No silences detected in the audio");
				return;
			}

			// Create a trim region for each detected silence
			const newTrimRegions: TrimRegion[] = result.silences.map((silence) => {
				const id = `trim-${nextTrimIdRef.current++}`;
				return {
					id,
					startMs: silence.startMs,
					endMs: silence.endMs,
				};
			});

			setTrimRegions((prev) => [...prev, ...newTrimRegions]);
			toast.success(`Added ${newTrimRegions.length} trim region${newTrimRegions.length === 1 ? "" : "s"} for detected silences`);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error(`Silence detection failed: ${message}`);
		}
	}, [videoPath]);

	const handleZoomSpanChange = useCallback((id: string, span: Span) => {
		setZoomRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
							...region,
							startMs: Math.round(span.start),
							endMs: Math.round(span.end),
						}
					: region,
			),
		);
	}, []);

	const handleTrimSpanChange = useCallback((id: string, span: Span) => {
		setTrimRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
							...region,
							startMs: Math.round(span.start),
							endMs: Math.round(span.end),
						}
					: region,
			),
		);
	}, []);

	const handleZoomFocusChange = useCallback((id: string, focus: ZoomFocus) => {
		setZoomRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
							...region,
							focus: clampFocusToDepth(focus, region.depth),
						}
					: region,
			),
		);
	}, []);

	const handleZoomDepthChange = useCallback(
		(depth: ZoomDepth) => {
			if (!selectedZoomId) return;
			setZoomRegions((prev) =>
				prev.map((region) =>
					region.id === selectedZoomId
						? {
								...region,
								depth,
								focus: clampFocusToDepth(region.focus, depth),
							}
						: region,
				),
			);
		},
		[selectedZoomId],
	);

	const handleZoomDelete = useCallback(
		(id: string) => {
			setZoomRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedZoomId === id) {
				setSelectedZoomId(null);
			}
		},
		[selectedZoomId],
	);

	const handleTrimDelete = useCallback(
		(id: string) => {
			setTrimRegions((prev) => {
				const region = prev.find((r) => r.id === id);
				if (region) {
					setCuttingRoomFloor((floor) => [...floor, region]);
				}
				return prev.filter((r) => r.id !== id);
			});
			if (selectedTrimId === id) {
				setSelectedTrimId(null);
			}
		},
		[selectedTrimId],
	);

	const handleRestoreFromFloor = useCallback((id: string) => {
		setCuttingRoomFloor((prev) => {
			const region = prev.find((r) => r.id === id);
			if (region) {
				setTrimRegions((trims) => [...trims, region]);
			}
			return prev.filter((r) => r.id !== id);
		});
	}, []);

	// ── Caption generation ──────────────────────────────────────────────────
	const handleGenerateCaptions = useCallback(async () => {
		if (!videoPath) return;

		setIsTranscribingCaptions(true);
		setCaptionTranscriptionProgress(0);
		setCaptionTranscriptionLabel(null);

		// ── Auto-download Whisper model if needed ────────────────────────
		try {
			const modelStatus = await window.electronAPI.getWhisperModelStatus();
			if (!modelStatus.downloaded) {
				setCaptionTranscriptionLabel("Downloading Whisper model...");
				setCaptionTranscriptionProgress(0);

				const cleanupDownload = window.electronAPI.onWhisperModelDownloadProgress(
					(progress: { percent: number }) => {
						setCaptionTranscriptionProgress(progress.percent);
					},
				);

				try {
					const downloadResult = await window.electronAPI.downloadWhisperModel();
					if (!downloadResult.success) {
						toast.error(downloadResult.error ?? "Failed to download Whisper model");
						setIsTranscribingCaptions(false);
						setCaptionTranscriptionProgress(null);
						setCaptionTranscriptionLabel(null);
						cleanupDownload();
						return;
					}
				} catch (downloadErr) {
					console.error("[VideoEditor] Whisper model download failed:", downloadErr);
					toast.error("Failed to download Whisper model");
					setIsTranscribingCaptions(false);
					setCaptionTranscriptionProgress(null);
					setCaptionTranscriptionLabel(null);
					cleanupDownload();
					return;
				}

				cleanupDownload();
				setCaptionTranscriptionLabel(null);
				setCaptionTranscriptionProgress(0);
			}
		} catch (err) {
			console.error("[VideoEditor] Failed to check Whisper model status:", err);
			// Continue anyway — transcribeAudio will fail with a clear error if model is missing
		}

		// ── Transcribe ───────────────────────────────────────────────────
		const cleanup = window.electronAPI.onTranscriptionProgress((progress: { percent: number }) => {
			setCaptionTranscriptionProgress(progress.percent);
		});

		try {
			const response = await window.electronAPI.transcribeAudio(videoPath);

			if (!response.success || !response.result) {
				toast.error(response.error ?? "Caption generation failed");
				return;
			}

			const { words } = response.result;
			// Convert Whisper words into CaptionCue[] with word-level timing
			// Group words into sentence-like cues (~5 words each)
			const WORDS_PER_CUE = 5;
			const cues: CaptionCue[] = [];
			for (let i = 0; i < words.length; i += WORDS_PER_CUE) {
				const chunk = words.slice(i, i + WORDS_PER_CUE);
				if (chunk.length === 0) continue;
				const cueWords = chunk.map((w) => ({
					text: w.text,
					startMs: Math.round(w.start * 1000),
					endMs: Math.round(w.end * 1000),
				}));
				cues.push({
					id: `cap-${i}`,
					startMs: cueWords[0].startMs,
					endMs: cueWords[cueWords.length - 1].endMs,
					text: chunk.map((w) => w.text).join(" "),
					words: cueWords,
				});
			}

			setCaptionCues(cues);
			// Clear any existing translation — new transcription invalidates it
			setTranslatedCaptionCues(null);
			setCaptionTranslationLang(null);
			setCaptionSettings((prev) => ({ ...prev, enabled: true }));
			toast.success("Captions generated");
		} catch (err) {
			console.error("[VideoEditor] Caption generation failed:", err);
			toast.error("Caption generation failed");
		} finally {
			setIsTranscribingCaptions(false);
			setCaptionTranscriptionProgress(null);
			setCaptionTranscriptionLabel(null);
			cleanup();
		}
	}, [videoPath]);

	// ── Caption translation ──────────────────────────────────────────────────
	const handleTranslateCaptions = useCallback(
		async (targetLang: string) => {
			if (captionCues.length === 0) {
				toast.error("Generate captions first before translating");
				return;
			}

			setIsTranslatingCaptions(true);
			setCaptionTranslationProgress(0);
			// Clear previous translation so stale cues don't linger during the request
			setTranslatedCaptionCues(null);
			setCaptionTranslationLang(null);

			try {
				// Batch all cue texts into a single translation request
				// Join with newlines so we can split back after translation
				const allTexts = captionCues.map((cue) => cue.text);
				const batchText = allTexts.join("\n");

				setCaptionTranslationProgress(30);

				const response = await window.electronAPI.translateText(batchText, targetLang);

				setCaptionTranslationProgress(80);

				if (!response.success || !response.translatedText) {
					toast.error(response.error ?? "Translation failed");
					return;
				}

				// Split translated text back into individual cue texts
				const translatedTexts = response.translatedText.split("\n");

				// Create translated cues with original timestamps but translated text
				const translated: CaptionCue[] = captionCues.map((cue, i) => ({
					...cue,
					id: `${cue.id}-tr`,
					text: translatedTexts[i]?.trim() ?? cue.text,
					// Keep original word-level timing but replace text at cue level
					// Words keep their timing from the original for animation sync
					words: cue.words ? cue.words.map((w) => ({ ...w })) : undefined,
				}));

				setTranslatedCaptionCues(translated);
				setCaptionTranslationLang(targetLang);
				setCaptionTranslationProgress(100);
				toast.success("Captions translated");
			} catch (err) {
				console.error("[VideoEditor] Caption translation failed:", err);
				toast.error("Caption translation failed");
			} finally {
				setIsTranslatingCaptions(false);
				setCaptionTranslationProgress(null);
			}
		},
		[captionCues],
	);

	// ── AI Suggestions handlers ──────────────────────────────────────────────

	const FILLER_WORDS = [
		"um",
		"uh",
		"like",
		"you know",
		"basically",
		"actually",
		"literally",
		"right",
		"so",
	];
	const SILENCE_THRESHOLD_MS = 800;

	const handleAnalyzeVideo = useCallback(async () => {
		if (!videoPath) return;

		setAiAnalysisProgress(0);
		setAiSuggestions([]);

		const cleanup = window.electronAPI.onTranscriptionProgress((progress: { percent: number }) => {
			setAiAnalysisProgress(progress.percent);
		});

		try {
			const response = await window.electronAPI.transcribeAudio(videoPath);

			if (!response.success || !response.result) {
				toast.error(response.error ?? "Transcription failed");
				setAiAnalysisProgress(null);
				cleanup();
				return;
			}

			const { words } = response.result;
			const suggestions: AISuggestion[] = [];
			let suggestionId = 0;

			// Detect silences (gaps > 0.8s between consecutive words)
			for (let i = 1; i < words.length; i++) {
				const prev = words[i - 1];
				const curr = words[i];
				if (!prev || !curr) continue;
				const gapMs = (curr.start - prev.end) * 1000;
				if (gapMs > SILENCE_THRESHOLD_MS) {
					suggestions.push({
						id: `ai-${suggestionId++}`,
						type: "silence",
						label: `Remove silence at ${formatAiMs(prev.end * 1000)}\u2013${formatAiMs(curr.start * 1000)}`,
						startMs: Math.round(prev.end * 1000),
						endMs: Math.round(curr.start * 1000),
					});
				}
			}

			// Detect filler words
			for (const w of words) {
				const lower = w.text.toLowerCase().replace(/[.,!?]/g, "");
				if (FILLER_WORDS.includes(lower)) {
					suggestions.push({
						id: `ai-${suggestionId++}`,
						type: "filler",
						label: `Filler word '${lower}' at ${formatAiMs(w.start * 1000)}`,
						startMs: Math.round(w.start * 1000),
						endMs: Math.round(w.end * 1000),
						word: lower,
					});
				}
			}

			// Detect "you know" as a 2-word filler
			for (let i = 0; i < words.length - 1; i++) {
				const w1 = words[i];
				const w2 = words[i + 1];
				if (!w1 || !w2) continue;
				const pair = `${w1.text.toLowerCase().replace(/[.,!?]/g, "")} ${w2.text.toLowerCase().replace(/[.,!?]/g, "")}`;
				if (pair === "you know") {
					suggestions.push({
						id: `ai-${suggestionId++}`,
						type: "filler",
						label: `Filler 'you know' at ${formatAiMs(w1.start * 1000)}`,
						startMs: Math.round(w1.start * 1000),
						endMs: Math.round(w2.end * 1000),
						word: "you know",
					});
				}
			}

			// Detect best moments (high word density = high energy)
			// Use a 5-second sliding window
			const WINDOW_SEC = 5;
			let bestDensity = 0;
			let bestWindowStart = 0;
			let bestWindowEnd = 0;

			if (words.length > 0) {
				const firstWord = words[0];
				const lastWord = words[words.length - 1];
				if (firstWord && lastWord) {
					for (
						let winStart = firstWord.start;
						winStart + WINDOW_SEC <= lastWord.end;
						winStart += 1
					) {
						const winEnd = winStart + WINDOW_SEC;
						const wordsInWindow = words.filter((w) => w.start >= winStart && w.end <= winEnd);
						const density = wordsInWindow.length / WINDOW_SEC;
						if (density > bestDensity) {
							bestDensity = density;
							bestWindowStart = winStart;
							bestWindowEnd = winEnd;
						}
					}
					if (bestDensity > 0) {
						suggestions.push({
							id: `ai-${suggestionId++}`,
							type: "best-moment",
							label: `High energy at ${formatAiMs(bestWindowStart * 1000)}`,
							startMs: Math.round(bestWindowStart * 1000),
							endMs: Math.round(bestWindowEnd * 1000),
						});
					}
				}
			}

			// Detect chapter boundaries
			if (words.length > 0) {
				const firstWord = words[0];
				const lastWord = words[words.length - 1];
				if (firstWord && lastWord) {
					const totalDurationSec = lastWord.end - firstWord.start;
					// Only generate chapters if the video is long enough (>60s)
					if (totalDurationSec > 60) {
						const chapterBreaks: number[] = [0]; // indices into words array where chapters start

						// Find long pauses (>2 seconds) as natural chapter boundaries
						for (let i = 1; i < words.length; i++) {
							const prev = words[i - 1];
							const curr = words[i];
							if (!prev || !curr) continue;
							const gapSec = curr.start - prev.end;
							if (gapSec > 2) {
								chapterBreaks.push(i);
							}
						}

						// If we didn't find enough natural breaks, segment by word density changes
						// Ensure segments are roughly 30-60 seconds
						const MIN_CHAPTER_SEC = 30;
						const MAX_CHAPTER_SEC = 60;
						const refinedBreaks: number[] = [0];

						for (let b = 1; b < chapterBreaks.length; b++) {
							const breakIdx = chapterBreaks[b];
							if (breakIdx === undefined) continue;
							const breakWord = words[breakIdx];
							const lastBreakIdx = refinedBreaks[refinedBreaks.length - 1];
							if (lastBreakIdx === undefined || !breakWord) continue;
							const lastBreakWord = words[lastBreakIdx];
							if (!lastBreakWord) continue;
							const elapsed = breakWord.start - lastBreakWord.start;
							if (elapsed >= MIN_CHAPTER_SEC) {
								refinedBreaks.push(breakIdx);
							}
						}

						// If segments are too long (>MAX_CHAPTER_SEC), split them further
						const finalBreaks: number[] = [];
						for (let b = 0; b < refinedBreaks.length; b++) {
							const startIdx = refinedBreaks[b];
							if (startIdx === undefined) continue;
							finalBreaks.push(startIdx);
							const nextBreakIdx =
								b + 1 < refinedBreaks.length ? refinedBreaks[b + 1] : words.length;
							if (nextBreakIdx === undefined) continue;
							const startWord = words[startIdx];
							const endWord = words[nextBreakIdx - 1];
							if (!startWord || !endWord) continue;
							const segDuration = endWord.end - startWord.start;
							if (segDuration > MAX_CHAPTER_SEC) {
								// Find a midpoint word to split
								const midTime = startWord.start + segDuration / 2;
								for (let i = startIdx + 1; i < nextBreakIdx; i++) {
									const w = words[i];
									if (w && w.start >= midTime) {
										finalBreaks.push(i);
										break;
									}
								}
							}
						}

						// Sort and deduplicate
						const uniqueBreaks = [...new Set(finalBreaks)].sort((a, b) => a - b);

						// Generate chapter suggestions
						for (let c = 0; c < uniqueBreaks.length; c++) {
							const chapterStartIdx = uniqueBreaks[c];
							if (chapterStartIdx === undefined) continue;
							const chapterEndIdx =
								c + 1 < uniqueBreaks.length ? uniqueBreaks[c + 1] : words.length;
							if (chapterEndIdx === undefined) continue;

							const chapterWords = words.slice(chapterStartIdx, chapterEndIdx);
							if (chapterWords.length === 0) continue;

							const chapterStartWord = chapterWords[0];
							const chapterEndWord = chapterWords[chapterWords.length - 1];
							if (!chapterStartWord || !chapterEndWord) continue;

							// Generate title from first few meaningful words (up to 6)
							const titleWords = chapterWords
								.slice(0, 8)
								.map((w) => w.text.replace(/[.,!?;:]/g, ""))
								.filter((t) => t.length > 0)
								.slice(0, 6);
							const title = titleWords.join(" ") || `Chapter ${c + 1}`;
							// Capitalize first letter
							const capitalizedTitle = title.charAt(0).toUpperCase() + title.slice(1);

							suggestions.push({
								id: `ai-${suggestionId++}`,
								type: "chapter",
								label: `Chapter ${c + 1}: ${capitalizedTitle}`,
								startMs: Math.round(chapterStartWord.start * 1000),
								endMs: Math.round(chapterEndWord.end * 1000),
							});
						}
					}
				}
			}

			// Generate title and summary from transcription
			if (words.length > 0) {
				const STOPWORDS = new Set([
					"the",
					"a",
					"an",
					"is",
					"are",
					"was",
					"were",
					"be",
					"been",
					"being",
					"have",
					"has",
					"had",
					"do",
					"does",
					"did",
					"will",
					"would",
					"could",
					"should",
					"may",
					"might",
					"shall",
					"can",
					"to",
					"of",
					"in",
					"for",
					"on",
					"with",
					"at",
					"by",
					"from",
					"as",
					"into",
					"through",
					"during",
					"before",
					"after",
					"above",
					"below",
					"between",
					"out",
					"off",
					"over",
					"under",
					"again",
					"further",
					"then",
					"once",
					"here",
					"there",
					"when",
					"where",
					"why",
					"how",
					"all",
					"each",
					"every",
					"both",
					"few",
					"more",
					"most",
					"other",
					"some",
					"such",
					"no",
					"not",
					"only",
					"own",
					"same",
					"so",
					"than",
					"too",
					"very",
					"just",
					"because",
					"but",
					"and",
					"or",
					"if",
					"while",
					"about",
					"up",
					"it",
					"its",
					"i",
					"me",
					"my",
					"we",
					"our",
					"you",
					"your",
					"he",
					"him",
					"his",
					"she",
					"her",
					"they",
					"them",
					"their",
					"this",
					"that",
					"these",
					"those",
					"what",
					"which",
					"who",
					"whom",
				]);

				const fullText = words.map((w) => w.text).join(" ");
				const firstWord = words[0];
				const lastWord = words[words.length - 1];
				const totalDurationMs = firstWord && lastWord ? Math.round(lastWord.end * 1000) : 0;

				// --- Title generation ---
				// Build title from the first sentence or first few words (max 60 chars)
				const sentences = fullText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
				let titleText = sentences[0]?.trim() ?? fullText.trim();
				if (titleText.length > 60) {
					titleText = `${titleText.slice(0, 57).trim()}...`;
				}
				// Capitalize first letter
				titleText = titleText.charAt(0).toUpperCase() + titleText.slice(1);

				suggestions.push({
					id: `ai-${suggestionId++}`,
					type: "title",
					label: titleText,
					startMs: 0,
					endMs: totalDurationMs,
				});

				// --- Summary generation ---
				// Take first 3 sentences or first ~200 words
				const first3Sentences = sentences.slice(0, 3).join(". ").trim();
				const first200Words = words
					.slice(0, 200)
					.map((w) => w.text)
					.join(" ");
				let summarySource = first3Sentences.length > 0 ? first3Sentences : first200Words;
				if (!summarySource.endsWith(".")) {
					summarySource += ".";
				}

				// Extract key phrases by finding top frequent meaningful words
				const wordFreq = new Map<string, number>();
				for (const w of words) {
					const lower = w.text.toLowerCase().replace(/[.,!?;:'"]/g, "");
					if (lower.length > 2 && !STOPWORDS.has(lower)) {
						wordFreq.set(lower, (wordFreq.get(lower) ?? 0) + 1);
					}
				}
				const topWords = [...wordFreq.entries()]
					.sort((a, b) => b[1] - a[1])
					.slice(0, 8)
					.map(([word]) => word);

				const keyPhraseSuffix = topWords.length > 0 ? ` Key topics: ${topWords.join(", ")}.` : "";
				const summaryText =
					summarySource.length > 300
						? `${summarySource.slice(0, 297).trim()}...${keyPhraseSuffix}`
						: `${summarySource}${keyPhraseSuffix}`;

				suggestions.push({
					id: `ai-${suggestionId++}`,
					type: "summary",
					label: summaryText,
					startMs: 0,
					endMs: totalDurationMs,
				});
			}

			// Sort by startMs
			suggestions.sort((a, b) => a.startMs - b.startMs);
			setAiSuggestions(suggestions);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error(`Analysis failed: ${message}`);
		} finally {
			setAiAnalysisProgress(null);
			cleanup();
		}
	}, [videoPath]);

	// ── Highlight detection ─────────────────────────────────────────────────
	const handleDetectHighlights = useCallback(() => {
		if (captionCues.length === 0) {
			toast.error("Generate captions first to detect highlights");
			return;
		}

		setIsDetectingHighlights(true);
		setHighlights([]);

		// Extract word-level data from caption cues
		const words: Array<{ text: string; start: number; end: number }> = [];
		for (const cue of captionCues) {
			if (cue.words) {
				for (const w of cue.words) {
					words.push({ text: w.text, start: w.startMs / 1000, end: w.endMs / 1000 });
				}
			}
		}

		const totalDurationMs = Math.max(0, Math.round(duration * 1000));

		// Run detection (synchronous but we wrap for UX feedback)
		try {
			const results = detectHighlights(totalDurationMs, words);
			setHighlights(results);
			if (results.length > 0) {
				toast.success(`Found ${results.length} highlight${results.length !== 1 ? "s" : ""}`);
			} else {
				toast("No highlights detected — video may be too short or lack speech variety");
			}
		} catch (err) {
			console.error("[VideoEditor] Highlight detection failed:", err);
			toast.error("Highlight detection failed");
		} finally {
			setIsDetectingHighlights(false);
		}
	}, [captionCues, duration]);

	const handleExportHighlightClip = useCallback(
		(highlight: HighlightCandidate) => {
			// Create a trim region that keeps only the highlight segment
			// We invert: trim everything before and after
			const totalMs = Math.max(0, Math.round(duration * 1000));
			const newRegions: TrimRegion[] = [];

			if (highlight.startMs > 0) {
				newRegions.push({
					id: `trim-${nextTrimIdRef.current++}`,
					startMs: 0,
					endMs: highlight.startMs,
				});
			}
			if (highlight.endMs < totalMs) {
				newRegions.push({
					id: `trim-${nextTrimIdRef.current++}`,
					startMs: highlight.endMs,
					endMs: totalMs,
				});
			}

			setTrimRegions((prev) => [...prev, ...newRegions]);
			toast.success(`Created trim regions for highlight clip (${Math.round((highlight.endMs - highlight.startMs) / 1000)}s)`);

			// Seek to the highlight start
			const video = videoPlaybackRef.current?.video;
			if (video) {
				video.currentTime = highlight.startMs / 1000;
			}
		},
		[duration],
	);

	const handleExportAllHighlights = useCallback(
		(highlightList: HighlightCandidate[]) => {
			if (highlightList.length === 0) return;
			// For "export all" we notify the user to export individually
			// since multiple non-contiguous clips would need separate exports
			toast(`${highlightList.length} highlights found — export each clip individually for best results`);
		},
		[],
	);

	const handleAddMotionTemplate = useCallback(
		(templateId: string, _values: Record<string, string>, durationMs: number) => {
			toast.success(`Added motion template "${templateId}" (${(durationMs / 1000).toFixed(1)}s)`);
			// Template overlay will be rendered during export via the motion template renderer
		},
		[],
	);

	const handleDetectScenes = useCallback(async () => {
		if (!videoPath) return;
		setIsDetectingScenes(true);
		try {
			const result = await window.electronAPI.detectScenes(videoPath);
			if (!result.success) {
				toast.error(result.error ?? "Scene detection failed");
				return;
			}
			setSceneMarkers(result.scenes);
			if (result.scenes.length === 0) {
				toast.info("No scene changes detected");
			} else {
				toast.success(`Detected ${result.scenes.length} scene change${result.scenes.length === 1 ? "" : "s"}`);
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error(`Scene detection failed: ${message}`);
		} finally {
			setIsDetectingScenes(false);
		}
	}, [videoPath]);

	const handleAcceptSuggestion = useCallback(
		(suggestion: AISuggestion) => {
			if (suggestion.type === "silence" || suggestion.type === "filler") {
				// Create a trim region to cut this segment
				const id = `trim-${nextTrimIdRef.current++}`;
				const newRegion: TrimRegion = {
					id,
					startMs: suggestion.startMs,
					endMs: suggestion.endMs,
				};
				setTrimRegions((prev) => [...prev, newRegion]);
				setSelectedTrimId(id);
			} else if (suggestion.type === "best-moment") {
				// Create a zoom region to highlight the best moment
				const id = `zoom-${nextZoomIdRef.current++}`;
				const newRegion: ZoomRegion = {
					id,
					startMs: suggestion.startMs,
					endMs: suggestion.endMs,
					depth: 2,
					focus: { cx: 0.5, cy: 0.5 },
				};
				setZoomRegions((prev) => [...prev, newRegion]);
				setSelectedZoomId(id);
				// Also seek to the start
				const video = videoPlaybackRef.current?.video;
				if (video) {
					video.currentTime = suggestion.startMs / 1000;
				}
			} else if (suggestion.type === "title" || suggestion.type === "summary") {
				// Copy the text to clipboard
				navigator.clipboard.writeText(suggestion.label).then(() => {
					toast.success(
						suggestion.type === "title"
							? "Title copied to clipboard"
							: "Summary copied to clipboard",
					);
				})
				.catch(() => {
					toast.error("Failed to copy to clipboard");
				});
		} else if (suggestion.type === "chapter") {
			// Create a text annotation on the timeline showing the chapter title
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			// Extract chapter title from label (format: "Chapter N: Title")
			const titleMatch = suggestion.label.match(/^Chapter \d+:\s*(.+)$/);
			const chapterTitle = titleMatch?.[1] ?? suggestion.label;
			const newRegion: AnnotationRegion = {
				id,
				startMs: suggestion.startMs,
				endMs: Math.min(suggestion.startMs + 5000, suggestion.endMs),
				type: "text",
				content: chapterTitle,
				position: { x: 50, y: 10 },
				size: { width: 60, height: 12 },
				style: {
					...DEFAULT_ANNOTATION_STYLE,
					fontSize: 48,
					fontWeight: "bold",
					color: "#ffffff",
					backgroundColor: "rgba(0, 0, 0, 0.6)",
				},
				zIndex,
			};
			setAnnotationRegions((prev) => [...prev, newRegion]);
			setSelectedAnnotationId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			// Seek to the chapter start
			const video = videoPlaybackRef.current?.video;
			if (video) {
				video.currentTime = suggestion.startMs / 1000;
			}
		}
		// Remove the suggestion after accepting
		setAiSuggestions((prev) => prev.filter((s) => s.id !== suggestion.id));
	}, []);

	const handleDismissSuggestion = useCallback((id: string) => {
		setAiSuggestions((prev) => prev.filter((s) => s.id !== id));
	}, []);

	const handleJumpToTime = useCallback((timeMs: number) => {
		const video = videoPlaybackRef.current?.video;
		if (video) {
			video.currentTime = timeMs / 1000;
		}
	}, []);

	const handleAddComment = useCallback((comment: TimelineComment) => {
		setTimelineComments((prev) => [...prev, comment]);
	}, []);

	const handleDeleteComment = useCallback((id: string) => {
		setTimelineComments((prev) => prev.filter((c) => c.id !== id));
	}, []);

	const handleSeekToComment = useCallback((timeMs: number) => {
		const video = videoPlaybackRef.current?.video;
		if (video) {
			video.currentTime = timeMs / 1000;
		}
	}, []);

	const handleHistoryRestore = useCallback(
		(index: number) => {
			const snapshot = historyPastRef.current[index];
			if (!snapshot) return;

			// Save current state to future
			const current = historyCurrentRef.current ?? cloneSnapshot(buildHistorySnapshot());
			historyFutureRef.current.push(cloneSnapshot(current));

			// Trim the past stack to everything before the target index
			historyPastRef.current = historyPastRef.current.slice(0, index);

			historyCurrentRef.current = cloneSnapshot(snapshot);
			applyHistorySnapshot(snapshot);
		},
		[applyHistorySnapshot, buildHistorySnapshot, cloneSnapshot],
	);

	const handleImportVideo = useCallback(async () => {
		try {
			const result = await window.electronAPI.openVideoFilePicker();
			if (result.success && result.path) {
				await window.electronAPI.setCurrentVideoPath(result.path);
				setVideoPath(toFileUrl(result.path));
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			toast.error(`Import failed: ${message}`);
		}
	}, []);

	const handleSelectSpeed = useCallback((id: string | null) => {
		setSelectedSpeedId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedAudioId(null);
		}
	}, []);

	const handleSpeedAdded = useCallback((span: Span) => {
		const id = `speed-${nextSpeedIdRef.current++}`;
		const newRegion: SpeedRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			speed: DEFAULT_PLAYBACK_SPEED,
		};
		setSpeedRegions((prev) => [...prev, newRegion]);
		setSelectedSpeedId(id);
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedAnnotationId(null);
	}, []);

	const handleSpeedSpanChange = useCallback((id: string, span: Span) => {
		setSpeedRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
							...region,
							startMs: Math.round(span.start),
							endMs: Math.round(span.end),
						}
					: region,
			),
		);
	}, []);

	const handleSpeedDelete = useCallback(
		(id: string) => {
			setSpeedRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedSpeedId === id) {
				setSelectedSpeedId(null);
			}
		},
		[selectedSpeedId],
	);

	const handleSelectAudio = useCallback((id: string | null) => {
		setSelectedAudioId(id);
		if (id) {
			setSelectedZoomId(null);
			setSelectedTrimId(null);
			setSelectedAnnotationId(null);
			setSelectedSpeedId(null);
		}
	}, []);

	const handleAudioAdded = useCallback((span: Span, audioPath: string) => {
		const id = `audio-${nextAudioIdRef.current++}`;
		const newRegion: AudioRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			audioPath,
			volume: 1,
		};
		setAudioRegions((prev) => [...prev, newRegion]);
		setSelectedAudioId(id);
		setSelectedZoomId(null);
		setSelectedTrimId(null);
		setSelectedAnnotationId(null);
		setSelectedSpeedId(null);
	}, []);

	const handleAudioSpanChange = useCallback((id: string, span: Span) => {
		setAudioRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
							...region,
							startMs: Math.round(span.start),
							endMs: Math.round(span.end),
						}
					: region,
			),
		);
	}, []);

	const handleAudioDelete = useCallback(
		(id: string) => {
			setAudioRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedAudioId === id) {
				setSelectedAudioId(null);
			}
		},
		[selectedAudioId],
	);

	const handleAudioVolumeChange = useCallback((id: string, volume: number) => {
		setAudioRegions((prev) =>
			prev.map((region) =>
				region.id === id ? { ...region, volume: Math.max(0, Math.min(1, volume)) } : region,
			),
		);
	}, []);

	const handleAudioFadeChange = useCallback((id: string, fadeInMs: number, fadeOutMs: number) => {
		setAudioRegions((prev) =>
			prev.map((region) => {
				if (region.id !== id) return region;
				const duration = region.endMs - region.startMs;
				return {
					...region,
					fadeInMs: Math.max(0, Math.min(fadeInMs, duration)),
					fadeOutMs: Math.max(0, Math.min(fadeOutMs, duration)),
				};
			}),
		);
	}, []);

	const handleSpeedChange = useCallback(
		(speed: PlaybackSpeed) => {
			if (!selectedSpeedId) return;
			setSpeedRegions((prev) =>
				prev.map((region) => (region.id === selectedSpeedId ? { ...region, speed } : region)),
			);
		},
		[selectedSpeedId],
	);

	const handleAnnotationAdded = useCallback((span: Span) => {
		const id = `annotation-${nextAnnotationIdRef.current++}`;
		const zIndex = nextAnnotationZIndexRef.current++; // Assign z-index based on creation order
		const newRegion: AnnotationRegion = {
			id,
			startMs: Math.round(span.start),
			endMs: Math.round(span.end),
			type: "text",
			content: "Enter text...",
			position: { ...DEFAULT_ANNOTATION_POSITION },
			size: { ...DEFAULT_ANNOTATION_SIZE },
			style: { ...DEFAULT_ANNOTATION_STYLE },
			zIndex,
		};
		setAnnotationRegions((prev) => [...prev, newRegion]);
		setSelectedAnnotationId(id);
		setSelectedZoomId(null);
		setSelectedTrimId(null);
	}, []);

	const handleStickerAnnotationAdded = useCallback(
		(emoji: string) => {
			const startMs = Math.round(currentTime * 1000);
			const endMs = Math.min(startMs + 5000, Math.round(duration * 1000));
			const id = `annotation-${nextAnnotationIdRef.current++}`;
			const zIndex = nextAnnotationZIndexRef.current++;
			const newRegion: AnnotationRegion = {
				id,
				startMs,
				endMs,
				type: "text",
				content: emoji,
				position: { x: 50, y: 50 },
				size: { width: 15, height: 15 },
				style: { ...DEFAULT_ANNOTATION_STYLE, fontSize: 64 },
				zIndex,
			};
			setAnnotationRegions((prev) => [...prev, newRegion]);
			setSelectedAnnotationId(id);
			setSelectedZoomId(null);
			setSelectedTrimId(null);
		},
		[currentTime, duration],
	);

	const handleRestoreClipToTimeline = useCallback(
		(clip: ScratchPadClip) => {
			const gifUrl = clip.thumbnailUrl;
			if (!gifUrl) {
				toast.error("Clip has no image to add");
				return;
			}

			// Fetch the GIF and convert to data URL for the annotation system
			fetch(gifUrl)
				.then((res) => res.blob())
				.then((blob) => {
					const reader = new FileReader();
					reader.onloadend = () => {
						const dataUrl = reader.result as string;
						const startMs = Math.round(currentTime * 1000);
						const endMs = Math.min(
							startMs + (clip.durationMs || 5000),
							Math.round(duration * 1000),
						);
						const id = `annotation-${nextAnnotationIdRef.current++}`;
						const zIndex = nextAnnotationZIndexRef.current++;
						const newRegion: AnnotationRegion = {
							id,
							startMs,
							endMs,
							type: "image",
							content: dataUrl,
							imageContent: dataUrl,
							position: { x: 35, y: 35 },
							size: { width: 30, height: 30 },
							style: { ...DEFAULT_ANNOTATION_STYLE },
							zIndex,
						};
						setAnnotationRegions((prev) => [...prev, newRegion]);
						setSelectedAnnotationId(id);
						toast.success(`"${clip.label}" added as overlay at ${(startMs / 1000).toFixed(1)}s`);
					};
					reader.readAsDataURL(blob);
				})
				.catch(() => {
					toast.error("Failed to fetch clip image");
				});
		},
		[currentTime, duration],
	);

	const handleAddSoundEffect = useCallback(
		(soundId: SoundEffectId) => {
			const startMs = Math.round(currentTime * 1000);
			const durationMs = Math.round(SFX_DURATIONS[soundId] * 1000);
			const endMs = Math.min(startMs + durationMs, Math.round(duration * 1000));
			const id = `sfx-${nextSfxIdRef.current++}`;
			const newRegion: SoundEffectRegion = {
				id,
				startMs,
				endMs,
				soundId,
				volume: 0.7,
			};
			setSoundEffectRegions((prev) => [...prev, newRegion]);
			toast.success(`Added "${soundId.replace("sfx-", "")}" at ${(startMs / 1000).toFixed(1)}s`);
		},
		[currentTime, duration],
	);

	const handleAddTransition = useCallback(
		(type: TransitionType) => {
			const atMs = Math.round(currentTime * 1000);
			const id = `tr-${nextTransitionIdRef.current++}`;
			const newTransition: TransitionRegion = {
				id,
				atMs,
				durationMs: 500,
				type,
			};
			setTransitionRegions((prev) => [...prev, newTransition]);
			toast.success(`Added "${type}" transition at ${(atMs / 1000).toFixed(1)}s`);
		},
		[currentTime],
	);

	const handleAnnotationSpanChange = useCallback((id: string, span: Span) => {
		setAnnotationRegions((prev) =>
			prev.map((region) =>
				region.id === id
					? {
							...region,
							startMs: Math.round(span.start),
							endMs: Math.round(span.end),
						}
					: region,
			),
		);
	}, []);

	const handleAnnotationDelete = useCallback(
		(id: string) => {
			setAnnotationRegions((prev) => prev.filter((region) => region.id !== id));
			if (selectedAnnotationId === id) {
				setSelectedAnnotationId(null);
			}
		},
		[selectedAnnotationId],
	);

	const handleAnnotationContentChange = useCallback((id: string, content: string) => {
		setAnnotationRegions((prev) => {
			const updated = prev.map((region) => {
				if (region.id !== id) return region;

				// Store content in type-specific fields
				if (region.type === "text") {
					return { ...region, content, textContent: content };
				} else if (region.type === "image") {
					return { ...region, content, imageContent: content };
				} else {
					return { ...region, content };
				}
			});
			return updated;
		});
	}, []);

	const handleAnnotationTypeChange = useCallback((id: string, type: AnnotationRegion["type"]) => {
		setAnnotationRegions((prev) => {
			const updated = prev.map((region) => {
				if (region.id !== id) return region;

				const updatedRegion = { ...region, type };

				// Restore content from type-specific storage
				if (type === "text") {
					updatedRegion.content = region.textContent || "Enter text...";
				} else if (type === "image") {
					updatedRegion.content = region.imageContent || "";
				} else if (type === "figure") {
					updatedRegion.content = "";
					if (!region.figureData) {
						updatedRegion.figureData = { ...DEFAULT_FIGURE_DATA };
					}
				}

				return updatedRegion;
			});
			return updated;
		});
	}, []);

	const handleAnnotationStyleChange = useCallback(
		(id: string, style: Partial<AnnotationRegion["style"]>) => {
			setAnnotationRegions((prev) =>
				prev.map((region) =>
					region.id === id ? { ...region, style: { ...region.style, ...style } } : region,
				),
			);
		},
		[],
	);

	const handleAnnotationFigureDataChange = useCallback((id: string, figureData: FigureData) => {
		setAnnotationRegions((prev) =>
			prev.map((region) => (region.id === id ? { ...region, figureData } : region)),
		);
	}, []);

	const handleAnnotationPositionChange = useCallback(
		(id: string, position: { x: number; y: number }) => {
			setAnnotationRegions((prev) =>
				prev.map((region) => (region.id === id ? { ...region, position } : region)),
			);
		},
		[],
	);

	const handleAnnotationSizeChange = useCallback(
		(id: string, size: { width: number; height: number }) => {
			setAnnotationRegions((prev) =>
				prev.map((region) => (region.id === id ? { ...region, size } : region)),
			);
		},
		[],
	);

	// Global Tab prevention
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			const isEditableTarget =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target?.isContentEditable;

			const usesPrimaryModifier = isMac ? e.metaKey : e.ctrlKey;
			const key = e.key.toLowerCase();

			// Command palette toggle
			if (usesPrimaryModifier && !e.shiftKey && !e.altKey && key === "k") {
				e.preventDefault();
				setShowCommandPalette((prev) => !prev);
				return;
			}

			// Project browser toggle
			if (usesPrimaryModifier && !e.shiftKey && !e.altKey && key === "p") {
				e.preventDefault();
				setShowProjectBrowser((prev) => !prev);
				return;
			}

			if (usesPrimaryModifier && !e.altKey && key === "z") {
				if (!isEditableTarget) {
					e.preventDefault();
					if (e.shiftKey) {
						handleRedo();
					} else {
						handleUndo();
					}
				}
				return;
			}

			if (!isMac && e.ctrlKey && !e.metaKey && !e.altKey && key === "y") {
				if (!isEditableTarget) {
					e.preventDefault();
					handleRedo();
				}
				return;
			}

			if (e.key === "Tab") {
				// Allow tab only in inputs/textareas
				if (isEditableTarget) {
					return;
				}
				e.preventDefault();
			}

			if (matchesShortcut(e, shortcuts.playPause, isMac)) {
				// Allow space only in inputs/textareas
				if (isEditableTarget) {
					return;
				}
				e.preventDefault();

				const playback = videoPlaybackRef.current;
				if (playback?.video) {
					if (playback.video.paused) {
						playback.play().catch(console.error);
					} else {
						playback.pause();
					}
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });
		return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
	}, [shortcuts, isMac, handleUndo, handleRedo]);

	useEffect(() => {
		if (selectedZoomId && !zoomRegions.some((region) => region.id === selectedZoomId)) {
			setSelectedZoomId(null);
		}
	}, [selectedZoomId, zoomRegions]);

	useEffect(() => {
		if (selectedTrimId && !trimRegions.some((region) => region.id === selectedTrimId)) {
			setSelectedTrimId(null);
		}
	}, [selectedTrimId, trimRegions]);

	useEffect(() => {
		if (
			selectedAnnotationId &&
			!annotationRegions.some((region) => region.id === selectedAnnotationId)
		) {
			setSelectedAnnotationId(null);
		}
	}, [selectedAnnotationId, annotationRegions]);

	useEffect(() => {
		if (selectedSpeedId && !speedRegions.some((region) => region.id === selectedSpeedId)) {
			setSelectedSpeedId(null);
		}
	}, [selectedSpeedId, speedRegions]);

	useEffect(() => {
		if (selectedAudioId && !audioRegions.some((region) => region.id === selectedAudioId)) {
			setSelectedAudioId(null);
		}
	}, [selectedAudioId, audioRegions]);

	// Audio playback sync: manage Audio elements that play in sync with video
	const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

	useEffect(() => {
		const existing = audioElementsRef.current;
		const currentIds = new Set(audioRegions.map((r) => r.id));

		// Remove old audio elements
		for (const [id, audio] of existing) {
			if (!currentIds.has(id)) {
				audio.pause();
				audio.src = "";
				existing.delete(id);
			}
		}

		// Create/update audio elements
		for (const region of audioRegions) {
			let audio = existing.get(region.id);
			if (!audio) {
				audio = new Audio();
				audio.preload = "auto";
				existing.set(region.id, audio);
			}
			const expectedSrc = toFileUrl(region.audioPath);
			if (audio.src !== expectedSrc) {
				audio.src = expectedSrc;
			}
			audio.volume = Math.max(0, Math.min(1, region.volume));
		}

		return () => {
			for (const audio of existing.values()) {
				audio.pause();
				audio.src = "";
			}
			existing.clear();
		};
	}, [audioRegions]);

	// Sync audio playback with video currentTime and isPlaying state
	useEffect(() => {
		for (const region of audioRegions) {
			const audio = audioElementsRef.current.get(region.id);
			if (!audio) continue;

			const currentTimeMs = currentTime * 1000;
			const isInRegion = currentTimeMs >= region.startMs && currentTimeMs < region.endMs;

			if (isPlaying && isInRegion) {
				const audioOffset = (currentTimeMs - region.startMs) / 1000;
				// Only seek if significantly out of sync (> 200ms)
				if (Math.abs(audio.currentTime - audioOffset) > 0.2) {
					audio.currentTime = audioOffset;
				}
				if (audio.paused) {
					audio.play().catch(() => undefined);
				}
			} else {
				if (!audio.paused) {
					audio.pause();
				}
			}
		}
	}, [isPlaying, currentTime, audioRegions]);

	// Sound effect preview playback — play each SFX when the playhead enters its region
	const sfxPlayedRef = useRef<Set<string>>(new Set());
	useEffect(() => {
		if (!isPlaying) {
			sfxPlayedRef.current.clear();
			return;
		}
		const currentTimeMs = currentTime * 1000;
		for (const sfx of soundEffectRegions) {
			const isInRegion = currentTimeMs >= sfx.startMs && currentTimeMs < sfx.endMs;
			if (isInRegion && !sfxPlayedRef.current.has(sfx.id)) {
				sfxPlayedRef.current.add(sfx.id);
				// Fire-and-forget preview playback
				import("@/lib/audio/soundEffectSynth").then(({ previewSoundEffect }) => {
					previewSoundEffect(sfx.soundId, sfx.volume);
				});
			} else if (!isInRegion) {
				sfxPlayedRef.current.delete(sfx.id);
			}
		}
	}, [isPlaying, currentTime, soundEffectRegions]);

	const showExportSuccessToast = useCallback((filePath: string) => {
		toast.success(`Exported successfully to ${filePath}`, {
			action: {
				label: "Show in Folder",
				onClick: async () => {
					try {
						const result = await window.electronAPI.revealInFolder(filePath);
						if (!result.success) {
							const errorMessage =
								result.error || result.message || "Failed to reveal item in folder.";
							toast.error(errorMessage);
						}
					} catch (err) {
						toast.error(`Error revealing in folder: ${String(err)}`);
					}
				},
			},
		});
	}, []);

	const handleExport = useCallback(
		async (settings: ExportSettings) => {
			if (!videoPath) {
				toast.error("No video loaded");
				return;
			}

			const video = videoPlaybackRef.current?.video;
			if (!video) {
				toast.error("Video not ready");
				return;
			}

			setIsExporting(true);
			setExportProgress(null);
			setExportError(null);
			pendingExportSaveRef.current = null;
			setHasPendingExportSave(false);

			let keepExportDialogOpen = false;

			try {
				const wasPlaying = isPlaying;
				const restoreTime = video.currentTime;
				if (wasPlaying) {
					videoPlaybackRef.current?.pause();
				}

				const sourceWidth = video.videoWidth || 1920;
				const sourceHeight = video.videoHeight || 1080;
				const sourceAspectRatio = sourceHeight > 0 ? sourceWidth / sourceHeight : 16 / 9;
				const aspectRatioValue = getAspectRatioValue(aspectRatio, sourceAspectRatio);

				// Get preview CONTAINER dimensions for scaling
				const playbackRef = videoPlaybackRef.current;
				const containerElement = playbackRef?.containerRef?.current;
				const previewWidth = containerElement?.clientWidth || 1920;
				const previewHeight = containerElement?.clientHeight || 1080;

				if (settings.format === "gif" && settings.gifConfig) {
					// GIF Export
					const gifExporter = new GifExporter({
						videoUrl: videoPath,
						width: settings.gifConfig.width,
						height: settings.gifConfig.height,
						frameRate: settings.gifConfig.frameRate,
						loop: settings.gifConfig.loop,
						sizePreset: settings.gifConfig.sizePreset,
						wallpaper,
						trimRegions,
						speedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						backgroundBlur,
						zoomMotionBlur,
						connectZooms,
						borderRadius,
						padding,
						videoPadding: padding,
						cropRegion,
						annotationRegions,
						zoomRegions: effectiveZoomRegions,
						cursorTelemetry: effectiveCursorTelemetry,
						showCursor,
						cursorSize,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						cursorSway,
						previewWidth,
						previewHeight,
						webcamVideoPath: webcamPath ?? undefined,
						webcamState: webcamPath
							? {
									path: webcamPath,
									visible: webcamVisible,
									shape: webcamShape,
									size: webcamSize,
									opacity: webcamOpacity,
									borderColor: webcamBorderColor,
									borderWidth: webcamBorderWidth,
									shadow: webcamShadow,
									position: webcamPosition,
									bgMode: webcamBgMode,
									bgBlur: webcamBgBlur,
									bgColor: webcamBgColor,
								}
							: undefined,
						captionCues:
							(translatedCaptionCues ?? captionCues).length > 0
								? (translatedCaptionCues ?? captionCues)
								: undefined,
						captionSettings: captionSettings.enabled ? captionSettings : undefined,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = gifExporter as unknown as VideoExporter;
					const result = await gifExporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();
						const timestamp = Date.now();
						const fileName = `export-${timestamp}.gif`;

						const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

						if (saveResult.canceled) {
							pendingExportSaveRef.current = { arrayBuffer, fileName };
							setHasPendingExportSave(true);
							setExportError(
								"Save dialog canceled. Click Save Again to save without re-rendering.",
							);
							toast.info("Save canceled. You can save again without re-exporting.");
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							showExportSuccessToast(saveResult.path);
							setExportedFilePath(saveResult.path);
						} else {
							setExportError(saveResult.message || "Failed to save GIF");
							toast.error(saveResult.message || "Failed to save GIF");
						}
					} else {
						setExportError(result.error || "GIF export failed");
						toast.error(result.error || "GIF export failed");
					}
				} else {
					// MP4 Export
					const quality = settings.quality || exportQuality;
					let exportWidth: number;
					let exportHeight: number;
					let bitrate: number;

					if (quality === "source") {
						// Use source resolution
						exportWidth = sourceWidth;
						exportHeight = sourceHeight;

						if (aspectRatio === "native") {
							exportWidth = Math.floor(sourceWidth / 2) * 2;
							exportHeight = Math.floor(sourceHeight / 2) * 2;
						} else if (aspectRatioValue === 1) {
							// Square (1:1): use smaller dimension to avoid codec limits
							const baseDimension = Math.floor(Math.min(sourceWidth, sourceHeight) / 2) * 2;
							exportWidth = baseDimension;
							exportHeight = baseDimension;
						} else if (aspectRatioValue > 1) {
							// Landscape: find largest even dimensions that exactly match aspect ratio
							const baseWidth = Math.floor(sourceWidth / 2) * 2;
							let found = false;
							for (let w = baseWidth; w >= 100 && !found; w -= 2) {
								const h = Math.round(w / aspectRatioValue);
								if (h % 2 === 0 && Math.abs(w / h - aspectRatioValue) < 0.0001) {
									exportWidth = w;
									exportHeight = h;
									found = true;
								}
							}
							if (!found) {
								exportWidth = baseWidth;
								exportHeight = Math.floor(baseWidth / aspectRatioValue / 2) * 2;
							}
						} else {
							// Portrait: find largest even dimensions that exactly match aspect ratio
							const baseHeight = Math.floor(sourceHeight / 2) * 2;
							let found = false;
							for (let h = baseHeight; h >= 100 && !found; h -= 2) {
								const w = Math.round(h * aspectRatioValue);
								if (w % 2 === 0 && Math.abs(w / h - aspectRatioValue) < 0.0001) {
									exportWidth = w;
									exportHeight = h;
									found = true;
								}
							}
							if (!found) {
								exportHeight = baseHeight;
								exportWidth = Math.floor((baseHeight * aspectRatioValue) / 2) * 2;
							}
						}

						// Calculate visually lossless bitrate matching screen recording optimization
						const totalPixels = exportWidth * exportHeight;
						if (totalPixels <= 1920 * 1080) {
							bitrate = 80_000_000;
						} else if (totalPixels <= 2560 * 1440) {
							bitrate = 120_000_000;
						} else {
							bitrate = 150_000_000;
						}
					} else if (quality === "high") {
						// High quality: source resolution with high bitrate
						exportHeight = Math.floor(sourceHeight / 2) * 2;
						exportWidth = Math.floor((exportHeight * aspectRatioValue) / 2) * 2;

						const totalPixels = exportWidth * exportHeight;
						if (totalPixels <= 1280 * 720) {
							bitrate = 50_000_000;
						} else if (totalPixels <= 1920 * 1080) {
							bitrate = 70_000_000;
						} else {
							bitrate = 100_000_000;
						}
					} else if (quality === "good") {
						// Good quality: 1080p target with high bitrate for sharp output
						const targetHeight = 1080;
						exportHeight = Math.floor(targetHeight / 2) * 2;
						exportWidth = Math.floor((exportHeight * aspectRatioValue) / 2) * 2;

						const totalPixels = exportWidth * exportHeight;
						if (totalPixels <= 1280 * 720) {
							bitrate = 35_000_000;
						} else if (totalPixels <= 1920 * 1080) {
							bitrate = 50_000_000;
						} else {
							bitrate = 65_000_000;
						}
					} else {
						// Medium quality: 720p target
						const targetHeight = 720;
						exportHeight = Math.floor(targetHeight / 2) * 2;
						exportWidth = Math.floor((exportHeight * aspectRatioValue) / 2) * 2;

						const totalPixels = exportWidth * exportHeight;
						if (totalPixels <= 1280 * 720) {
							bitrate = 18_000_000;
						} else {
							bitrate = 25_000_000;
						}
					}

					// Boost bitrate when padding is high (zoomed out) to maintain
					// sharp video content that occupies fewer pixels
					if (padding > 20) {
						const paddingBoost = 1 + (padding / 100) * 0.5;
						bitrate = Math.round(bitrate * paddingBoost);
					}

					const exporter = new VideoExporter({
						videoUrl: videoPath,
						width: exportWidth,
						height: exportHeight,
						frameRate: 60,
						bitrate,
						codec: "avc1.640034",
						wallpaper,
						trimRegions,
						speedRegions,
						showShadow: shadowIntensity > 0,
						shadowIntensity,
						backgroundBlur,
						zoomMotionBlur,
						connectZooms,
						borderRadius,
						padding,
						cropRegion,
						annotationRegions,
						zoomRegions: effectiveZoomRegions,
						cursorTelemetry: effectiveCursorTelemetry,
						showCursor,
						cursorSize,
						cursorSmoothing,
						cursorMotionBlur,
						cursorClickBounce,
						cursorSway,
						audioRegions,
						soundEffectRegions,
						transitionRegions,
						enhancedAudioUrl:
							useDubbedAudio && dubbedAudioPath
								? `klipt-media://${dubbedAudioPath}`
								: (enhancedAudioUrl ?? undefined),
						previewWidth,
						previewHeight,
						webcamVideoPath: webcamPath ?? undefined,
						webcamState: webcamPath
							? {
									path: webcamPath,
									visible: webcamVisible,
									shape: webcamShape,
									size: webcamSize,
									opacity: webcamOpacity,
									borderColor: webcamBorderColor,
									borderWidth: webcamBorderWidth,
									shadow: webcamShadow,
									position: webcamPosition,
									bgMode: webcamBgMode,
									bgBlur: webcamBgBlur,
									bgColor: webcamBgColor,
								}
							: undefined,
						captionCues:
							(translatedCaptionCues ?? captionCues).length > 0
								? (translatedCaptionCues ?? captionCues)
								: undefined,
						captionSettings: captionSettings.enabled ? captionSettings : undefined,
						onProgress: (progress: ExportProgress) => {
							setExportProgress(progress);
						},
					});

					exporterRef.current = exporter;
					const result = await exporter.export();

					if (result.success && result.blob) {
						const arrayBuffer = await result.blob.arrayBuffer();
						const timestamp = Date.now();
						const fileName = `export-${timestamp}.mp4`;

						const saveResult = await window.electronAPI.saveExportedVideo(arrayBuffer, fileName);

						if (saveResult.canceled) {
							pendingExportSaveRef.current = { arrayBuffer, fileName };
							setHasPendingExportSave(true);
							setExportError(
								"Save dialog canceled. Click Save Again to save without re-rendering.",
							);
							toast.info("Save canceled. You can save again without re-exporting.");
							keepExportDialogOpen = true;
						} else if (saveResult.success && saveResult.path) {
							showExportSuccessToast(saveResult.path);
							setExportedFilePath(saveResult.path);
						} else {
							setExportError(saveResult.message || "Failed to save video");
							toast.error(saveResult.message || "Failed to save video");
						}
					} else {
						setExportError(result.error || "Export failed");
						toast.error(result.error || "Export failed");
					}
				}

				if (wasPlaying) {
					videoPlaybackRef.current?.play();
				} else {
					video.currentTime = restoreTime;
					await videoPlaybackRef.current?.refreshFrame();
				}
			} catch (error) {
				console.error("Export error:", error);
				const errorMessage = error instanceof Error ? error.message : "Unknown error";
				setExportError(errorMessage);
				toast.error(`Export failed: ${errorMessage}`);
			} finally {
				if (!isPlaying) {
					await videoPlaybackRef.current?.refreshFrame().catch(() => undefined);
				}
				setIsExporting(false);
				exporterRef.current = null;
				setShowExportDialog(keepExportDialogOpen);
				setExportProgress(null);
			}
		},
		[
			videoPath,
			wallpaper,
			trimRegions,
			speedRegions,
			shadowIntensity,
			backgroundBlur,
			zoomMotionBlur,
			connectZooms,
			showCursor,
			effectiveCursorTelemetry,
			cursorSize,
			cursorSmoothing,
			cursorMotionBlur,
			cursorClickBounce,
			cursorSway,
			audioRegions,
			enhancedAudioUrl,
			borderRadius,
			padding,
			cropRegion,
			annotationRegions,
			isPlaying,
			aspectRatio,
			exportQuality,
			effectiveZoomRegions,
			showExportSuccessToast,
			webcamPath,
			webcamVisible,
			webcamShape,
			webcamSize,
			webcamOpacity,
			webcamBorderColor,
			webcamBorderWidth,
			webcamShadow,
			webcamPosition,
		],
	);

	const isFastExportAvailable = useMemo(
		() =>
			canFastExport({
				trimRegions,
				zoomRegions: effectiveZoomRegions,
				annotationRegions,
				audioRegions,
				soundEffectRegions,
				transitionRegions,
				speedRegions,
				cropRegion,
				enhancedAudioUrl,
				webcamPath,
				captionCues: translatedCaptionCues ?? captionCues,
				aspectRatio,
				borderRadius,
				padding,
				shadowIntensity,
				backgroundBlur,
			}),
		[
			trimRegions,
			effectiveZoomRegions,
			annotationRegions,
			audioRegions,
			soundEffectRegions,
			transitionRegions,
			speedRegions,
			cropRegion,
			enhancedAudioUrl,
			webcamPath,
			translatedCaptionCues,
			captionCues,
			aspectRatio,
			borderRadius,
			padding,
			shadowIntensity,
			backgroundBlur,
		],
	);

	const handleFastExport = useCallback(async () => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		const sourcePath = videoSourcePath ?? fromFileUrl(videoPath);
		if (!sourcePath) {
			toast.error("Cannot determine video file path");
			return;
		}

		setIsExporting(true);
		setShowExportDialog(true);
		setExportProgress({
			currentFrame: 0,
			totalFrames: 100,
			percentage: 0,
			estimatedTimeRemaining: 0,
		});
		setExportError(null);

		const cleanupProgress = window.electronAPI.onFastExportProgress(({ percent }) => {
			setExportProgress({
				currentFrame: percent,
				totalFrames: 100,
				percentage: percent,
				estimatedTimeRemaining: 0,
			});
		});

		try {
			const regions = trimRegions.map((r) => ({ startMs: r.startMs, endMs: r.endMs }));

			// Pass empty outputPath so the IPC handler shows a save dialog
			const result = await window.electronAPI.fastExport(sourcePath, "", regions);

			if (result.canceled) {
				setShowExportDialog(false);
				return;
			}

			if (result.success && result.outputPath) {
				setExportProgress({
					currentFrame: 100,
					totalFrames: 100,
					percentage: 100,
					estimatedTimeRemaining: 0,
				});
				showExportSuccessToast(result.outputPath);
				setExportedFilePath(result.outputPath);
			} else {
				setExportError(result.error || "Fast export failed");
				toast.error(result.error || "Fast export failed");
			}
		} catch (error) {
			console.error("Fast export error:", error);
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			setExportError(errorMessage);
			toast.error(`Fast export failed: ${errorMessage}`);
		} finally {
			cleanupProgress();
			setIsExporting(false);
			setExportProgress(null);
		}
	}, [videoPath, videoSourcePath, trimRegions, showExportSuccessToast]);

	const handleOpenExportDialog = useCallback(() => {
		if (!videoPath) {
			toast.error("No video loaded");
			return;
		}

		if (hasPendingExportSave) {
			setShowExportDialog(true);
			setExportError("Save dialog canceled. Click Save Again to save without re-rendering.");
			return;
		}

		const video = videoPlaybackRef.current?.video;
		if (!video) {
			toast.error("Video not ready");
			return;
		}

		// Build export settings from current state
		const sourceWidth = video.videoWidth || 1920;
		const sourceHeight = video.videoHeight || 1080;
		const gifDimensions = calculateOutputDimensions(
			sourceWidth,
			sourceHeight,
			gifSizePreset,
			GIF_SIZE_PRESETS,
		);

		const settings: ExportSettings = {
			format: exportFormat,
			quality: exportFormat === "mp4" ? exportQuality : undefined,
			gifConfig:
				exportFormat === "gif"
					? {
							frameRate: gifFrameRate,
							loop: gifLoop,
							sizePreset: gifSizePreset,
							width: gifDimensions.width,
							height: gifDimensions.height,
						}
					: undefined,
		};

		setShowExportDialog(true);
		setExportError(null);

		// Start export immediately
		handleExport(settings);
	}, [
		videoPath,
		hasPendingExportSave,
		exportFormat,
		exportQuality,
		gifFrameRate,
		gifLoop,
		gifSizePreset,
		handleExport,
	]);

	// Trigger export after format change from dropdown
	useEffect(() => {
		if (pendingExportFormatRef.current) {
			pendingExportFormatRef.current = false;
			handleOpenExportDialog();
		}
	}, [exportFormat, handleOpenExportDialog]);

	const handleCancelExport = useCallback(() => {
		if (exporterRef.current) {
			exporterRef.current.cancel();
			toast.info("Export canceled");
			setShowExportDialog(false);
			setIsExporting(false);
			setExportProgress(null);
			setExportError(null);
			setExportedFilePath(undefined);
		}
	}, []);

	const handleEnhanceAudio = useCallback(
		(blob: Blob) => {
			// Revoke previous URL if any
			if (enhancedAudioUrl) {
				URL.revokeObjectURL(enhancedAudioUrl);
			}
			const url = URL.createObjectURL(blob);
			setEnhancedAudioUrl(url);
			setAudioEnhanced(true);
		},
		[enhancedAudioUrl],
	);

	const handleUndoEnhanceAudio = useCallback(() => {
		if (enhancedAudioUrl) {
			URL.revokeObjectURL(enhancedAudioUrl);
		}
		setEnhancedAudioUrl(null);
		setAudioEnhanced(false);
	}, [enhancedAudioUrl]);

	const handleGenerateDub = useCallback(
		async (targetLanguage: string) => {
			if (!videoPath) return;

			setIsDubbing(true);
			setDubbingProgress({ phase: "extracting", percent: 0, message: "Starting dubbing..." });

			const cleanupProgress = window.electronAPI.onDubbingProgress(
				(progress: { phase: string; percent: number; message: string }) => {
					setDubbingProgress(progress);
				},
			);

			try {
				const result = await window.electronAPI.dubVideo(videoPath, targetLanguage);

				if (result.success && result.audioPath) {
					setDubbedAudioPath(result.audioPath);
					setUseDubbedAudio(true);
					toast.success("Dubbing complete!");
				} else {
					toast.error(result.error ?? "Dubbing failed");
				}
			} catch (err) {
				console.error("[VideoEditor] Dubbing failed:", err);
				toast.error("Dubbing failed unexpectedly");
			} finally {
				cleanupProgress();
				setIsDubbing(false);
				setDubbingProgress(null);
			}
		},
		[videoPath],
	);

	const handleExportDialogClose = useCallback(() => {
		setShowExportDialog(false);
		setExportedFilePath(undefined);
	}, []);

	const handleRetrySaveExport = useCallback(async () => {
		const pendingSave = pendingExportSaveRef.current;
		if (!pendingSave) {
			return;
		}

		const saveResult = await window.electronAPI.saveExportedVideo(
			pendingSave.arrayBuffer,
			pendingSave.fileName,
		);

		if (saveResult.canceled) {
			setExportError("Save dialog canceled. Click Save Again to save without re-rendering.");
			toast.info("Save canceled. You can try again.");
			return;
		}

		if (saveResult.success && saveResult.path) {
			pendingExportSaveRef.current = null;
			setHasPendingExportSave(false);
			setExportError(null);
			setExportedFilePath(saveResult.path);
			showExportSuccessToast(saveResult.path);
			setShowExportDialog(false);
			return;
		}

		const errorMessage = saveResult.message || "Failed to save video";
		setExportError(errorMessage);
		toast.error(errorMessage);
	}, [showExportSuccessToast]);

	const openRecordingsFolder = useCallback(async () => {
		try {
			const result = await window.electronAPI.openRecordingsFolder();
			if (!result.success) {
				toast.error(result.message || result.error || "Failed to open recordings folder.");
			}
		} catch (error) {
			toast.error(`Failed to open recordings folder: ${String(error)}`);
		}
	}, []);

	// Face Detection handler
	const handleDetectFaces = useCallback(async () => {
		if (!videoPath || isDetectingFaces) return;
		setIsDetectingFaces(true);
		setFaceDetectionProgress(0);

		try {
			// Extract frames using FFmpeg via IPC
			const result = await window.electronAPI.extractFramesForFaceDetection(videoPath, {
				intervalMs: 2000,
				maxFrames: 30,
			});

			if (!result.success || !result.frames || result.frames.length === 0) {
				toast.error(result.error || "No frames could be extracted for face detection");
				return;
			}

			// Use the FaceDetector API in the renderer
			const { detectFacesInFrames, mergeFaceDetections } = await import("@/lib/ai/faceDetector");

			const faces = await detectFacesInFrames(result.frames, (percent) => {
				setFaceDetectionProgress(percent);
			});

			// Cleanup temp frames
			if (result.frames.length > 0) {
				const frameDir = result.frames[0].path.substring(0, result.frames[0].path.lastIndexOf("/"));
				await window.electronAPI.cleanupFaceDetectionFrames(frameDir).catch(() => {});
			}

			if (faces.length === 0) {
				toast.info("No faces detected in the video");
				return;
			}

			// Merge nearby detections into regions
			const merged = mergeFaceDetections(faces);

			const newRegions: FaceBlurRegion[] = merged.map((m, idx) => ({
				id: `face-${Date.now()}-${idx}`,
				startMs: m.startMs,
				endMs: m.endMs + 2000, // extend a bit past last detection
				x: m.x,
				y: m.y,
				width: m.width,
				height: m.height,
				blurStyle: "gaussian" as const,
				enabled: true,
			}));

			setFaceBlurRegions(newRegions);
			toast.success(`Detected ${newRegions.length} face region(s)`);
		} catch (err) {
			console.error("[handleDetectFaces]", err);
			toast.error(`Face detection failed: ${String(err)}`);
		} finally {
			setIsDetectingFaces(false);
			setFaceDetectionProgress(null);
		}
	}, [videoPath, isDetectingFaces]);

	const handleFaceBlurToggle = useCallback((id: string, enabled: boolean) => {
		setFaceBlurRegions((prev) => prev.map((r) => (r.id === id ? { ...r, enabled } : r)));
	}, []);

	const handleFaceBlurStyleChange = useCallback((id: string, style: FaceBlurStyle) => {
		setFaceBlurRegions((prev) => prev.map((r) => (r.id === id ? { ...r, blurStyle: style } : r)));
	}, []);

	const handleFaceBlurDelete = useCallback((id: string) => {
		setFaceBlurRegions((prev) => prev.filter((r) => r.id !== id));
	}, []);

	// Auto Color Correction handler
	const handleColorCorrect = useCallback(
		async (profile: ColorCorrectionProfile) => {
			if (!videoPath || isColorCorrecting) return;
			setIsColorCorrecting(true);

			try {
				// Save original path if not already saved
				if (!originalVideoPath) {
					setOriginalVideoPath(videoPath);
				}

				const sourceFile = originalVideoPath || videoPath;
				const result = await window.electronAPI.autoColorCorrect(sourceFile, profile);

				if (!result.success || !result.correctedPath) {
					toast.error(result.error || "Color correction failed");
					return;
				}

				setColorCorrectionProfile(profile);
				setVideoPath(result.correctedPath);
				toast.success(`Applied "${profile}" color correction`);
			} catch (err) {
				console.error("[handleColorCorrect]", err);
				toast.error(`Color correction failed: ${String(err)}`);
			} finally {
				setIsColorCorrecting(false);
			}
		},
		[videoPath, isColorCorrecting, originalVideoPath],
	);

	const handleRevertColorCorrection = useCallback(() => {
		if (originalVideoPath) {
			setVideoPath(originalVideoPath);
			setColorCorrectionProfile(null);
			toast.success("Reverted color correction");
		}
	}, [originalVideoPath]);

	const selectedZoomDepth = useMemo(
		() =>
			selectedZoomId ? (zoomRegions.find((z) => z.id === selectedZoomId)?.depth ?? null) : null,
		[selectedZoomId, zoomRegions],
	);

	const selectedSpeedValue = useMemo(
		() =>
			selectedSpeedId ? (speedRegions.find((r) => r.id === selectedSpeedId)?.speed ?? null) : null,
		[selectedSpeedId, speedRegions],
	);

	const gifOutputDims = useMemo(
		() =>
			calculateOutputDimensions(
				videoPlaybackRef.current?.video?.videoWidth || 1920,
				videoPlaybackRef.current?.video?.videoHeight || 1080,
				gifSizePreset,
				GIF_SIZE_PRESETS,
			),
		[gifSizePreset],
	);

	if (loading) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="text-foreground">Loading video...</div>
			</div>
		);
	}
	if (error) {
		return (
			<div className="flex items-center justify-center h-screen bg-background">
				<div className="flex flex-col items-center gap-3">
					<div className="text-destructive">{error}</div>
					<button
						type="button"
						onClick={handleLoadProject}
						className="px-3 py-1.5 rounded-md bg-white text-black text-sm hover:bg-white/90"
					>
						Load Project File
					</button>
				</div>
			</div>
		);
	}

	return (
		<TooltipProvider delayDuration={300}>
			<div
				className="flex h-screen bg-[#050508] relative overflow-hidden text-[#F2F0ED] selection:bg-[#E0000F]/30 font-sans"
				style={{ perspective: "2000px" }}
			>
				<CreativeWorkspace
					activePanel={activeWorkspacePanel}
					onPanelChange={setActiveWorkspacePanel}
					cuttingRoomFloor={cuttingRoomFloor}
					onRestoreFromFloor={handleRestoreFromFloor}
					historyPastRef={historyPastRef}
					onHistoryRestore={handleHistoryRestore}
					notes={workspaceNotes}
					onNotesChange={setWorkspaceNotes}
					currentTime={currentTime}
					aiSuggestions={aiSuggestions}
					aiAnalysisProgress={aiAnalysisProgress}
					onAnalyzeVideo={handleAnalyzeVideo}
					onAcceptSuggestion={handleAcceptSuggestion}
					onDismissSuggestion={handleDismissSuggestion}
					onJumpToTime={handleJumpToTime}
					scratchPadClips={scratchPadClips}
					onScratchPadClipsChange={setScratchPadClips}
					onImportVideo={handleImportVideo}
					onAddStickerAnnotation={handleStickerAnnotationAdded}
					onAddSoundEffect={handleAddSoundEffect}
					onAddTransition={handleAddTransition}
					onRestoreClipToTimeline={handleRestoreClipToTimeline}
					hasVideo={!!videoPath}
					timelineComments={timelineComments}
					onAddComment={handleAddComment}
					onDeleteComment={handleDeleteComment}
					onSeekToComment={handleSeekToComment}
					onDetectScenes={handleDetectScenes}
					isDetectingScenes={isDetectingScenes}
					sceneMarkerCount={sceneMarkers.length}
					highlights={highlights}
					isDetectingHighlights={isDetectingHighlights}
					hasTranscription={captionCues.length > 0}
					onDetectHighlights={handleDetectHighlights}
					onExportHighlightClip={handleExportHighlightClip}
					onExportAllHighlights={handleExportAllHighlights}
					onAddMotionTemplate={handleAddMotionTemplate}
				/>
				<div className="flex-1 flex flex-col relative overflow-hidden">
					{/* Ambient orbs (z-0) */}
					<div className="absolute top-[-10%] right-[-10%] w-[45vw] h-[45vw] rounded-full bg-[#E0000F] opacity-[0.05] blur-[150px] pointer-events-none mix-blend-screen z-0" />
					<div className="absolute bottom-[-15%] left-[-10%] w-[35vw] h-[35vw] rounded-full bg-[#E0000F] opacity-[0.03] blur-[120px] pointer-events-none mix-blend-screen z-0" />
					<div className="absolute top-[30%] right-[10%] w-[25vw] h-[25vw] rounded-full bg-[#BF5AF2] opacity-[0.03] blur-[100px] pointer-events-none mix-blend-screen z-0" />

					{/* Ultra-Compact Floating Toolbar Pill (z-50) */}
					<div
						className={`relative mx-4 mt-4 h-14 flex-shrink-0 bg-white/[0.03] backdrop-blur-[60px] border border-white/[0.08] rounded-2xl flex items-center justify-between px-6 z-50 pl-[80px] transition-[opacity,transform,filter] duration-700 ease-out will-change-[opacity,transform,filter] ${isFocusVoid ? "opacity-0 blur-sm pointer-events-none -translate-y-4" : "opacity-100 blur-0 translate-y-0"}`}
						style={
							{
								WebkitAppRegion: "drag",
								background: "rgba(255,255,255,0.03)",
								border: "1px solid rgba(255,255,255,0.05)",
								boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
							} as React.CSSProperties
						}
					>
						{/* Left: Logo + Undo/Redo + Project Name */}
						<div
							className="flex items-center gap-2"
							style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
						>
							<div className="flex items-center gap-1.5 select-none">
								<div className="relative w-4 h-4">
									<div
										className="absolute inset-0 rounded-[3px] border border-white/[0.06]"
										style={{ transform: "rotate(5deg)" }}
									/>
									<div
										className="absolute inset-[2px] rounded-[2.5px] border border-white/[0.12]"
										style={{ transform: "rotate(-5deg)" }}
									/>
									<div
										className="absolute inset-[4px] rounded-[2px] bg-[#E0000F]"
										style={{ transform: "rotate(20deg)" }}
									/>
								</div>
								<span className="text-[15px] font-semibold tracking-tight text-white/90">
									Klipt
								</span>
							</div>

							<Separator orientation="vertical" className="h-3 bg-white/[0.08]" />

							<div className="flex items-center gap-0.5">
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											onClick={handleUndo}
											disabled={historyPastRef.current.length === 0}
											className="h-8 w-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-colors cursor-pointer"
										>
											<Undo2 className="w-3 h-3" />
										</button>
									</TooltipTrigger>
									<TooltipContent
										side="bottom"
										className="bg-[#1a1a1e] border-white/10 text-white/70 text-xs"
									>
										Undo ({isMac ? "\u2318" : "Ctrl"}+Z)
									</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											onClick={handleRedo}
											disabled={historyFutureRef.current.length === 0}
											className="h-8 w-8 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-colors cursor-pointer"
										>
											<Redo2 className="w-3 h-3" />
										</button>
									</TooltipTrigger>
									<TooltipContent
										side="bottom"
										className="bg-[#1a1a1e] border-white/10 text-white/70 text-xs"
									>
										Redo ({isMac ? "\u2318" : "Ctrl"}+Shift+Z)
									</TooltipContent>
								</Tooltip>
							</div>

							<Separator orientation="vertical" className="h-3 bg-white/[0.08] ml-2 mr-1" />
							<div
								className=" flex items-center gap-1.5"
								style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
							>
								{isEditingProjectName ? (
									<input
										autoFocus
										type="text"
										value={projectName}
										onChange={(e) => setProjectName(e.target.value)}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												setIsEditingProjectName(false);
											}
											if (e.key === "Escape") {
												setIsEditingProjectName(false);
											}
										}}
										onBlur={() => setIsEditingProjectName(false)}
										className="text-[9px] text-white/80 bg-white/10 border border-white/20 rounded px-1 py-0.5 outline-none focus:border-[#E0000F]/50 w-[120px]"
									/>
								) : (
									<button
										type="button"
										onClick={() => setIsEditingProjectName(true)}
										className="text-[9px] text-white/40 hover:text-white/70 transition-colors cursor-text"
										title="Click to rename project"
									>
										{projectName || "Untitled Project"}
									</button>
								)}
								{hasUnsavedChanges && (
									<div className="w-[6px] h-[6px] rounded-full bg-[#E0000F] flex-shrink-0" />
								)}
							</div>
						</div>

						{/* Center: Project Name */}

						{/* Center: Phantom Prompt Trigger */}
						<div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
							<button
								onClick={() => setShowCommandPalette(true)}
								className="flex items-center gap-3 px-5 py-2 rounded-full bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.06] hover:border-white/10 hover:shadow-[0_4px_20px_rgba(255,255,255,0.05)] transition-all duration-300 group cursor-pointer"
								style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
							>
								<Search className="w-4 h-4 text-white/30 group-hover:text-white/60 transition-colors" />
								<span className="text-[12px] font-medium text-white/30 group-hover:text-white/60 tracking-wide transition-colors">
									Ask AI or search commands...
								</span>
								<kbd className="ml-4 text-[10px] font-mono font-semibold text-white/40 bg-white/[0.04] px-2 py-1 rounded border border-white/5 shadow-inner">
									⌘K
								</kbd>
							</button>
						</div>

						{/* Right: Actions + Export */}
						<div
							className="flex items-center gap-2"
							style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
						>
							<LanguageSwitcher />

							<Tooltip>
								<TooltipTrigger asChild>
									<button
										type="button"
										onClick={() => void openRecordingsFolder()}
										className="h-6 w-6 flex items-center justify-center rounded-md text-white/20 hover:text-white/50 transition-colors"
									>
										<FolderOpen className="h-3 w-3" />
									</button>
								</TooltipTrigger>
								<TooltipContent
									side="bottom"
									className="bg-[#1a1a1e] border-white/10 text-white/70 text-xs"
								>
									{t("common.app.manageRecordings", "Open recordings folder")}
								</TooltipContent>
							</Tooltip>

							<button
								type="button"
								onClick={() => {
									if (exportedFilePath) {
										void navigator.clipboard.writeText(exportedFilePath);
										toast.success("Path copied!");
									} else {
										toast.info("Export a video first");
									}
								}}
								className="h-6 px-2 rounded-md flex items-center gap-1 text-white/20 hover:text-white/50 transition-colors text-[9px] font-medium"
							>
								<Share className="w-4 h-4" />
								Share
							</button>

							<div className="flex items-center">
								<button
									type="button"
									onClick={handleOpenExportDialog}
									disabled={isExporting}
									className="h-9 px-5 flex items-center gap-2 rounded-l-lg text-white text-[13px] font-bold hover:brightness-110 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
									style={{ background: "linear-gradient(135deg, #E0000F, #FF4500)" }}
								>
									<Download className="w-4 h-4" />
									Export {exportFormat === "gif" ? "GIF" : "MP4"}
								</button>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<button
											type="button"
											disabled={isExporting}
											className="h-9 px-2 flex items-center rounded-r-lg text-white border-l border-white/20 hover:brightness-110 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
											style={{ background: "linear-gradient(135deg, #C0000D, #E03D00)" }}
										>
											<ChevronDown className="w-4 h-4" />
										</button>
									</DropdownMenuTrigger>
									<DropdownMenuContent
										align="end"
										className="bg-[#1a1a1e] border-white/10 min-w-[140px]"
									>
										<DropdownMenuItem
											className="text-xs text-white/80 hover:text-white focus:bg-white/10 focus:text-white cursor-pointer"
											onSelect={() => {
												if (exportFormat === "mp4") {
													handleOpenExportDialog();
												} else {
													pendingExportFormatRef.current = true;
													setExportFormat("mp4");
												}
											}}
										>
											<Download className="w-3 h-3 mr-2" />
											Export as MP4
										</DropdownMenuItem>
										<DropdownMenuItem
											className="text-xs text-white/80 hover:text-white focus:bg-white/10 focus:text-white cursor-pointer"
											onSelect={() => {
												if (exportFormat === "gif") {
													handleOpenExportDialog();
												} else {
													pendingExportFormatRef.current = true;
													setExportFormat("gif");
												}
											}}
										>
											<Download className="w-3 h-3 mr-2" />
											Export as GIF
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
					</div>

					{/* Main content area (z-10) */}
					<PanelGroup
						direction="horizontal"
						className={`flex-1 min-h-0 relative z-10 px-6 pb-6 pt-[80px] gap-6 transition-[opacity,transform,filter] duration-700 ease-out will-change-[opacity,transform,filter] ${isFocusVoid ? "scale-[1.02]" : "scale-100"}`}
					>
						{/* Left panel: Video + Timeline */}
						<Panel defaultSize={75} minSize={50} className="flex flex-col">
							<PanelGroup direction="vertical" className="h-full gap-4">
								{/* Video Panel */}
								<Panel defaultSize={75} minSize={30}>
									<div className="w-full h-full flex flex-col items-center justify-center relative p-4">
										{/* Video preview */}
										<div
											className="w-full flex justify-center items-center relative z-10"
											style={STYLE_PREVIEW_CONTAINER}
										>
											{/* AUDIO-REACTIVE AMBILIGHT (LIVING CANVAS) */}
											<canvas
												ref={ambilightCanvasRef}
												className="absolute pointer-events-none transition-all duration-75"
												style={{
													width: "120%",
													height: "120%",
													top: "-10%",
													left: "-10%",
													filter: "blur(100px) saturate(1.5)",
													opacity: 0.5,
													transform: "scale(1.1)",
													zIndex: 0,
													display: ambilightEnabled ? "block" : "none",
												}}
											/>
											<div
												className="relative rounded-2xl"
												style={{
													width: "auto",
													height: "100%",
													aspectRatio: getAspectRatioValue(
														aspectRatio,
														(() => {
															const previewVideo = videoPlaybackRef.current?.video;
															if (previewVideo && previewVideo.videoHeight > 0) {
																return previewVideo.videoWidth / previewVideo.videoHeight;
															}
															return 16 / 9;
														})(),
													),
													maxWidth: "100%",
													margin: "0 auto",
													boxSizing: "border-box",
													border: "1px solid rgba(255,255,255,0.04)",
													boxShadow: "0 25px 80px rgba(0,0,0,0.7), 0 8px 20px rgba(0,0,0,0.4)",
												}}
											>
												<VideoPlayback
													key={videoPath || "no-video"}
													aspectRatio={aspectRatio}
													ref={videoPlaybackRef}
													videoPath={videoPath || ""}
													onDurationChange={setDuration}
													onTimeUpdate={setCurrentTime}
													currentTime={currentTime}
													onPlayStateChange={setIsPlaying}
													onError={setError}
													wallpaper={wallpaper}
													zoomRegions={effectiveZoomRegions}
													selectedZoomId={selectedZoomId}
													onSelectZoom={handleSelectZoom}
													onZoomFocusChange={handleZoomFocusChange}
													isPlaying={isPlaying}
													showShadow={shadowIntensity > 0}
													shadowIntensity={shadowIntensity}
													backgroundBlur={backgroundBlur}
													zoomMotionBlur={zoomMotionBlur}
													connectZooms={connectZooms}
													borderRadius={borderRadius}
													padding={padding}
													cropRegion={cropRegion}
													trimRegions={trimRegions}
													speedRegions={speedRegions}
													annotationRegions={annotationRegions}
													selectedAnnotationId={selectedAnnotationId}
													onSelectAnnotation={handleSelectAnnotation}
													onAnnotationPositionChange={handleAnnotationPositionChange}
													onAnnotationSizeChange={handleAnnotationSizeChange}
													cursorTelemetry={effectiveCursorTelemetry}
													showCursor={showCursor}
													cursorSize={cursorSize}
													cursorSmoothing={cursorSmoothing}
													cursorMotionBlur={cursorMotionBlur}
													cursorClickBounce={cursorClickBounce}
													cursorSway={cursorSway}
													webcamPath={webcamPath}
													webcamVisible={webcamVisible}
													webcamShape={webcamShape}
													webcamSize={webcamSize}
													webcamOpacity={webcamOpacity}
													webcamBorderColor={webcamBorderColor}
													webcamBorderWidth={webcamBorderWidth}
													webcamShadow={webcamShadow}
													webcamPosition={webcamPosition}
													onWebcamPositionChange={setWebcamPosition}
													captionCues={translatedCaptionCues ?? captionCues}
													captionSettings={captionSettings}
												/>
												<ClickHighlightOverlay
													clicks={clickEvents}
													currentTimeMs={currentTime * 1000}
													enabled={clickHighlightEnabled}
													color={clickHighlightColor}
													size={clickHighlightSize}
												/>
											</div>
										</div>
										{/* Playback controls */}
										<div
											className={`w-full flex justify-center items-center relative z-10 transition-[opacity,transform,filter] duration-700 ease-out will-change-[opacity,transform,filter] ${isFocusVoid ? "opacity-0 blur-sm pointer-events-none translate-y-4" : "opacity-100 blur-0 translate-y-0"}`}
											style={STYLE_PLAYBACK_CONTROLS_WRAPPER}
										>
											<div style={STYLE_PLAYBACK_CONTROLS_INNER}>
												<PlaybackControls
													isPlaying={isPlaying}
													currentTime={currentTime}
													duration={duration}
													onTogglePlayPause={togglePlayPause}
													onSeek={handleSeek}
												/>
											</div>
										</div>
									</div>
								</Panel>

								{/* Horizontal resize handle */}
								<PanelResizeHandle
									className={`h-4 flex items-center justify-center cursor-row-resize group my-1 transition-[opacity,transform,filter] duration-700 ease-out will-change-[opacity,transform,filter] ${isFocusVoid ? "opacity-0 pointer-events-none" : "opacity-100"}`}
								>
									<div className="w-12 h-1.5 rounded-full bg-white/[0.04] group-hover:bg-white/[0.2] transition-colors" />
								</PanelResizeHandle>

								{/* Timeline Panel */}
								<Panel
									defaultSize={25}
									minSize={15}
									className={`transition-[opacity,transform,filter] duration-700 ease-out will-change-[opacity,transform,filter] ${isFocusVoid ? "opacity-0 translate-y-8 blur-md pointer-events-none" : "opacity-100 translate-y-0 blur-0"}`}
								>
									<div
										className="h-full min-h-0 rounded-[24px] overflow-hidden flex flex-col relative transition-all"
										style={{
											background: "rgba(255,255,255,0.02)",
											border: "1px solid rgba(255,255,255,0.05)",
											boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
										}}
									>
										<TimelineEditor
											videoDuration={duration}
											currentTime={currentTime}
											onSeek={handleSeek}
											cursorTelemetry={effectiveCursorTelemetry}
											zoomRegions={effectiveZoomRegions}
											onZoomAdded={handleZoomAdded}
											onZoomSuggested={handleZoomSuggested}
											onZoomSpanChange={handleZoomSpanChange}
											onZoomDelete={handleZoomDelete}
											selectedZoomId={selectedZoomId}
											onSelectZoom={handleSelectZoom}
											trimRegions={trimRegions}
											onTrimAdded={handleTrimAdded}
											onTrimSpanChange={handleTrimSpanChange}
											onTrimDelete={handleTrimDelete}
											selectedTrimId={selectedTrimId}
											onSelectTrim={handleSelectTrim}
											cuttingRoomFloor={cuttingRoomFloor}
											onRestoreFromFloor={handleRestoreFromFloor}
											speedRegions={speedRegions}
											onSpeedAdded={handleSpeedAdded}
											onSpeedSpanChange={handleSpeedSpanChange}
											onSpeedDelete={handleSpeedDelete}
											selectedSpeedId={selectedSpeedId}
											onSelectSpeed={handleSelectSpeed}
											audioRegions={audioRegions}
											onAudioAdded={handleAudioAdded}
											onAudioSpanChange={handleAudioSpanChange}
											onAudioDelete={handleAudioDelete}
											onAudioVolumeChange={handleAudioVolumeChange}
											onAudioFadeChange={handleAudioFadeChange}
											selectedAudioId={selectedAudioId}
											onSelectAudio={handleSelectAudio}
											soundEffectRegions={soundEffectRegions}
											onSfxSpanChange={(id, span) => {
												setSoundEffectRegions((prev) =>
													prev.map((r) =>
														r.id === id
															? {
																	...r,
																	startMs: Math.round(span.start),
																	endMs: Math.round(span.end),
																}
															: r,
													),
												);
											}}
											onSfxDelete={(id) => {
												setSoundEffectRegions((prev) => prev.filter((r) => r.id !== id));
											}}
											transitionRegions={transitionRegions}
											onTransitionDelete={(id) => {
												setTransitionRegions((prev) => prev.filter((r) => r.id !== id));
											}}
											annotationRegions={annotationRegions}
											onAnnotationAdded={handleAnnotationAdded}
											onAnnotationSpanChange={handleAnnotationSpanChange}
											onAnnotationDelete={handleAnnotationDelete}
											selectedAnnotationId={selectedAnnotationId}
											onSelectAnnotation={handleSelectAnnotation}
											aspectRatio={aspectRatio}
											onAspectRatioChange={setAspectRatio}
											workspaceNotes={workspaceNotes}
											timelineComments={timelineComments}
											sceneMarkers={sceneMarkers}
											onAutoSilenceCut={handleAutoSilenceCut}
											onAutoZoomFace={handleAutoZoomFace}
										/>
									</div>
								</Panel>
							</PanelGroup>
						</Panel>

						<PanelResizeHandle
							className={`w-4 flex items-center justify-center cursor-col-resize group mx-1 transition-[opacity,transform,filter] duration-700 ease-out will-change-[opacity,transform,filter] ${isFocusVoid ? "opacity-0 pointer-events-none" : "opacity-100"}`}
						>
							<div className="w-1.5 h-12 rounded-full bg-white/[0.04] group-hover:bg-white/[0.2] transition-colors" />
						</PanelResizeHandle>

						{/* Right panel: Settings */}
						<Panel
							defaultSize={25}
							minSize={20}
							className={`transition-[opacity,transform,filter] duration-700 ease-out will-change-[opacity,transform,filter] ${isFocusVoid ? "opacity-0 translate-x-8 blur-md pointer-events-none" : "opacity-100 translate-x-0 blur-0"}`}
						>
							<div
								className="h-full rounded-[24px] overflow-hidden flex flex-col relative transition-all duration-500"
								style={{
									background: "rgba(18,18,20,0.85)",
									backdropFilter: "blur(40px)",
									WebkitBackdropFilter: "blur(40px)",
									border: "1px solid rgba(255,255,255,0.08)",
									boxShadow: "0 30px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.1)",
								}}
							>
								<SettingsPanel
									selected={wallpaper}
									onWallpaperChange={setWallpaper}
									selectedZoomDepth={selectedZoomDepth}
									onZoomDepthChange={handleZoomDepthChange}
									selectedZoomId={selectedZoomId}
									onZoomDelete={handleZoomDelete}
									selectedTrimId={selectedTrimId}
									onTrimDelete={handleTrimDelete}
									shadowIntensity={shadowIntensity}
									onShadowChange={setShadowIntensity}
									backgroundBlur={backgroundBlur}
									onBackgroundBlurChange={setBackgroundBlur}
									zoomMotionBlur={zoomMotionBlur}
									onZoomMotionBlurChange={setZoomMotionBlur}
									connectZooms={connectZooms}
									onConnectZoomsChange={setConnectZooms}
									showCursor={showCursor}
									onShowCursorChange={setShowCursor}
									loopCursor={loopCursor}
									onLoopCursorChange={setLoopCursor}
									cursorSize={cursorSize}
									onCursorSizeChange={setCursorSize}
									cursorSmoothing={cursorSmoothing}
									onCursorSmoothingChange={setCursorSmoothing}
									cursorMotionBlur={cursorMotionBlur}
									onCursorMotionBlurChange={setCursorMotionBlur}
									cursorClickBounce={cursorClickBounce}
									onCursorClickBounceChange={setCursorClickBounce}
									cursorSway={cursorSway}
									onCursorSwayChange={setCursorSway}
									cursorStyle={cursorStyle}
									onCursorStyleChange={setCursorStyle}
									borderRadius={borderRadius}
									onBorderRadiusChange={setBorderRadius}
									padding={padding}
									onPaddingChange={setPadding}
									cropRegion={cropRegion}
									onCropChange={setCropRegion}
									aspectRatio={aspectRatio}
									onAspectRatioChange={setAspectRatio}
									videoElement={videoPlaybackRef.current?.video || null}
									exportQuality={exportQuality}
									onExportQualityChange={setExportQuality}
									exportFormat={exportFormat}
									onExportFormatChange={setExportFormat}
									gifFrameRate={gifFrameRate}
									onGifFrameRateChange={setGifFrameRate}
									gifLoop={gifLoop}
									onGifLoopChange={setGifLoop}
									gifSizePreset={gifSizePreset}
									onGifSizePresetChange={setGifSizePreset}
									gifOutputDimensions={gifOutputDims}
									onExport={handleOpenExportDialog}
									canFastExport={isFastExportAvailable}
									onFastExport={handleFastExport}
									selectedAnnotationId={selectedAnnotationId}
									annotationRegions={annotationRegions}
									onAnnotationContentChange={handleAnnotationContentChange}
									onAnnotationTypeChange={handleAnnotationTypeChange}
									onAnnotationStyleChange={handleAnnotationStyleChange}
									onAnnotationFigureDataChange={handleAnnotationFigureDataChange}
									onAnnotationDelete={handleAnnotationDelete}
									onSaveProject={handleSaveProject}
									onLoadProject={() => setShowProjectBrowser(true)}
									selectedSpeedId={selectedSpeedId}
									selectedSpeedValue={selectedSpeedValue}
									onSpeedChange={handleSpeedChange}
									onSpeedDelete={handleSpeedDelete}
									webcamPath={webcamPath}
									webcamVisible={webcamVisible}
									onWebcamVisibleChange={setWebcamVisible}
									webcamShape={webcamShape}
									onWebcamShapeChange={setWebcamShape}
									webcamSize={webcamSize}
									onWebcamSizeChange={setWebcamSize}
									webcamOpacity={webcamOpacity}
									onWebcamOpacityChange={setWebcamOpacity}
									webcamBorderColor={webcamBorderColor}
									onWebcamBorderColorChange={setWebcamBorderColor}
									webcamBorderWidth={webcamBorderWidth}
									onWebcamBorderWidthChange={setWebcamBorderWidth}
									webcamShadow={webcamShadow}
									onWebcamShadowChange={setWebcamShadow}
									webcamBgMode={webcamBgMode}
									onWebcamBgModeChange={setWebcamBgMode}
									webcamBgBlur={webcamBgBlur}
									onWebcamBgBlurChange={setWebcamBgBlur}
									webcamBgColor={webcamBgColor}
									onWebcamBgColorChange={setWebcamBgColor}
									ambilightEnabled={ambilightEnabled}
									onAmbilightEnabledChange={setAmbilightEnabled}
									isExporting={isExporting}
									videoUrl={videoPath}
									audioEnhanced={audioEnhanced}
									enhancedAudioUrl={enhancedAudioUrl}
									onEnhanceAudio={handleEnhanceAudio}
									onUndoEnhanceAudio={handleUndoEnhanceAudio}
									captionSettings={captionSettings}
									onCaptionSettingsChange={setCaptionSettings}
									onGenerateCaptions={handleGenerateCaptions}
									isTranscribing={isTranscribingCaptions}
									transcriptionProgress={captionTranscriptionProgress}
									transcriptionLabel={captionTranscriptionLabel}
									onTranslateCaptions={handleTranslateCaptions}
									isTranslating={isTranslatingCaptions}
									translationProgress={captionTranslationProgress}
									translatedLanguage={captionTranslationLang}
									onGenerateDub={handleGenerateDub}
									isDubbing={isDubbing}
									dubbingProgress={dubbingProgress}
									dubbedAudioPath={dubbedAudioPath}
									useDubbedAudio={useDubbedAudio}
									onUseDubbedAudioChange={setUseDubbedAudio}
									faceBlurRegions={faceBlurRegions}
									onDetectFaces={handleDetectFaces}
									isDetectingFaces={isDetectingFaces}
									faceDetectionProgress={faceDetectionProgress}
									onFaceBlurToggle={handleFaceBlurToggle}
									onFaceBlurStyleChange={handleFaceBlurStyleChange}
									onFaceBlurDelete={handleFaceBlurDelete}
									colorCorrectionProfile={colorCorrectionProfile}
									onColorCorrect={handleColorCorrect}
									onRevertColorCorrection={handleRevertColorCorrection}
									isColorCorrecting={isColorCorrecting}
									clickHighlightEnabled={clickHighlightEnabled}
									onClickHighlightEnabledChange={setClickHighlightEnabled}
									clickHighlightColor={clickHighlightColor}
									onClickHighlightColorChange={setClickHighlightColor}
									clickHighlightSize={clickHighlightSize}
									onClickHighlightSizeChange={setClickHighlightSize}
									recordingAutoStopMs={recordingAutoStopMs}
									onRecordingAutoStopChange={setRecordingAutoStopMs}
									recordingShowTimerOverlay={recordingShowTimerOverlay}
									onRecordingShowTimerOverlayChange={setRecordingShowTimerOverlay}
								/>
							</div>
						</Panel>
					</PanelGroup>

					{/* Overlays */}
					<ExportDialog
						isOpen={showExportDialog}
						onClose={handleExportDialogClose}
						progress={exportProgress}
						isExporting={isExporting}
						error={exportError}
						onCancel={handleCancelExport}
						onRetrySave={handleRetrySaveExport}
						canRetrySave={hasPendingExportSave}
						exportFormat={exportFormat}
						exportedFilePath={exportedFilePath}
					/>

					<CommandPalette
						open={showCommandPalette}
						onClose={() => setShowCommandPalette(false)}
						onExportMp4={() => {
							setExportFormat("mp4");
							handleOpenExportDialog();
						}}
						onExportGif={() => {
							setExportFormat("gif");
							handleOpenExportDialog();
						}}
						onAddZoomRegion={() => {
							const startMs = currentTime * 1000;
							const regionDuration = Math.min(2000, (duration - currentTime) * 1000);
							handleZoomAdded({ start: startMs, end: startMs + regionDuration });
						}}
						onAddTrimRegion={() => {
							const startMs = currentTime * 1000;
							const regionDuration = Math.min(2000, (duration - currentTime) * 1000);
							handleTrimAdded({ start: startMs, end: startMs + regionDuration });
						}}
						onAddSpeedRegion={() => {
							const startMs = currentTime * 1000;
							const regionDuration = Math.min(2000, (duration - currentTime) * 1000);
							handleSpeedAdded({ start: startMs, end: startMs + regionDuration });
						}}
						onAddAnnotation={() => {
							const startMs = currentTime * 1000;
							const regionDuration = Math.min(2000, (duration - currentTime) * 1000);
							handleAnnotationAdded({ start: startMs, end: startMs + regionDuration });
						}}
						onPlayPause={() => {
							const playback = videoPlaybackRef.current;
							if (playback?.video) {
								if (playback.video.paused) {
									playback.play().catch(console.error);
								} else {
									playback.pause();
								}
							}
						}}
						onUndo={handleUndo}
						onRedo={handleRedo}
						onEnhanceAudio={() => {
							toast.info("Open the Settings panel to enhance audio.");
						}}
						onGenerateThumbnails={() => {
							toast.info("Open the Settings panel to generate thumbnails.");
						}}
						onSaveProject={() => void handleSaveProject()}
						onLoadProject={() => void handleLoadProject()}
						onOpenRecordingsFolder={() => void openRecordingsFolder()}
					/>

					<ProjectBrowserDialog
						isOpen={showProjectBrowser}
						onClose={() => setShowProjectBrowser(false)}
						onOpenProject={async (path: string) => {
							try {
								const result = await window.electronAPI.openSpecificProject(path);
								if (!result.success) {
									toast.error(result.message || "Failed to load project");
									return;
								}
								const restored = await applyLoadedProject(result.project, result.path ?? path);
								if (!restored) {
									toast.error("Invalid project file format");
									return;
								}
								toast.success(`Project loaded from ${result.path ?? path}`);
							} catch (err) {
								console.error("Failed to open project:", err);
								toast.error("Failed to open project");
							}
						}}
						currentProjectPath={currentProjectPath}
					/>

					<Toaster theme="dark" className="pointer-events-auto" />
				</div>
			</div>
		</TooltipProvider>
	);
}

import Block from "@uiw/react-color-block";
import { AnimatePresence, motion } from "framer-motion";
import {
	Bug,
	Crop,
	Download,
	Film,
	FolderOpen,
	Image,
	Mic,
	Palette,
	Save,
	Star,
	Subtitles,
	Upload,
	Volume2,
	X,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BgMode } from "@/lib/ai/backgroundRemoval";
import { getAssetPath, getRenderableAssetUrl } from "@/lib/assetPath";
import type { ExportFormat, ExportQuality, GifFrameRate, GifSizePreset } from "@/lib/exporter";
import { GIF_FRAME_RATES, GIF_SIZE_PRESETS } from "@/lib/exporter";
import { cn } from "@/lib/utils";
import { BUILT_IN_WALLPAPERS, WALLPAPER_PATHS, WALLPAPER_RELATIVE_PATHS } from "@/lib/wallpapers";
import { type AspectRatio } from "@/utils/aspectRatioUtils";
import { useI18n, useScopedT } from "../../contexts/I18nContext";
import { AnnotationSettingsPanel } from "./AnnotationSettingsPanel";
import { CropControl } from "./CropControl";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp";
import { SliderControl } from "./SliderControl";
import { StudioSoundPanel } from "./StudioSoundPanel";
import { ThumbnailPanel } from "./ThumbnailPanel";
import type {
	AnnotationRegion,
	AnnotationType,
	CropRegion,
	CursorStyle,
	FigureData,
	PlaybackSpeed,
	ZoomDepth,
} from "./types";
import {
	CURSOR_STYLE_OPTIONS,
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_CURSOR_SMOOTHING,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_ZOOM_MOTION_BLUR,
	SPEED_OPTIONS,
} from "./types";
import { fromCursorSwaySliderValue, toCursorSwaySliderValue } from "./videoPlayback/cursorSway";
import type { CaptionSettings } from "./captionStyle";
import { DEFAULT_CAPTION_SETTINGS } from "./captionStyle";
// AI Background Removal — shelved, will re-enable in AI features phase
// import { WebcamBackgroundPanel } from "./WebcamBackgroundPanel";
import { WebcamPanel, type WebcamPanelProps } from "./WebcamPanel";

const GRADIENTS = [
	"linear-gradient( 111.6deg,  rgba(114,167,232,1) 9.4%, rgba(253,129,82,1) 43.9%, rgba(253,129,82,1) 54.8%, rgba(249,202,86,1) 86.3% )",
	"linear-gradient(120deg, #d4fc79 0%, #96e6a1 100%)",
	"radial-gradient( circle farthest-corner at 3.2% 49.6%,  rgba(80,12,139,0.87) 0%, rgba(161,10,144,0.72) 83.6% )",
	"linear-gradient( 111.6deg,  rgba(0,56,68,1) 0%, rgba(163,217,185,1) 51.5%, rgba(231, 148, 6, 1) 88.6% )",
	"linear-gradient( 107.7deg,  rgba(235,230,44,0.55) 8.4%, rgba(252,152,15,1) 90.3% )",
	"linear-gradient( 91deg,  rgba(72,154,78,1) 5.2%, rgba(251,206,70,1) 95.9% )",
	"radial-gradient( circle farthest-corner at 10% 20%,  rgba(2,37,78,1) 0%, rgba(4,56,126,1) 19.7%, rgba(85,245,221,1) 100.2% )",
	"linear-gradient( 109.6deg,  rgba(15,2,2,1) 11.2%, rgba(36,163,190,1) 91.1% )",
	"linear-gradient(135deg, #FBC8B4, #2447B1)",
	"linear-gradient(109.6deg, #F635A6, #36D860)",
	"linear-gradient(90deg, #FF0101, #4DFF01)",
	"linear-gradient(315deg, #EC0101, #5044A9)",
	"linear-gradient(45deg, #ff9a9e 0%, #fad0c4 99%, #fad0c4 100%)",
	"linear-gradient(to top, #a18cd1 0%, #fbc2eb 100%)",
	"linear-gradient(to right, #ff8177 0%, #ff867a 0%, #ff8c7f 21%, #f99185 52%, #cf556c 78%, #b12a5b 100%)",
	"linear-gradient(120deg, #84fab0 0%, #8fd3f4 100%)",
	"linear-gradient(to right, #4facfe 0%, #00f2fe 100%)",
	"linear-gradient(to top, #fcc5e4 0%, #fda34b 15%, #ff7882 35%, #c8699e 52%, #7046aa 71%, #0c1db8 87%, #020f75 100%)",
	"linear-gradient(to right, #fa709a 0%, #fee140 100%)",
	"linear-gradient(to top, #30cfd0 0%, #330867 100%)",
	"linear-gradient(to top, #c471f5 0%, #fa71cd 100%)",
	"linear-gradient(to right, #f78ca0 0%, #f9748f 19%, #fd868c 60%, #fe9a8b 100%)",
	"linear-gradient(to top, #48c6ef 0%, #6f86d6 100%)",
	"linear-gradient(to right, #0acffe 0%, #495aff 100%)",
];

type BackgroundTab = "image" | "color" | "gradient";

function isHexWallpaper(value: string): boolean {
	return /^#(?:[0-9a-f]{3}){1,2}$/i.test(value);
}

function getBackgroundTabForWallpaper(value: string): BackgroundTab {
	if (GRADIENTS.includes(value)) {
		return "gradient";
	}

	if (isHexWallpaper(value)) {
		return "color";
	}

	return "image";
}

interface SettingsPanelProps {
	selected: string;
	onWallpaperChange: (path: string) => void;
	selectedZoomDepth?: ZoomDepth | null;
	onZoomDepthChange?: (depth: ZoomDepth) => void;
	selectedZoomId?: string | null;
	onZoomDelete?: (id: string) => void;
	selectedTrimId?: string | null;
	onTrimDelete?: (id: string) => void;
	shadowIntensity?: number;
	onShadowChange?: (intensity: number) => void;
	backgroundBlur?: number;
	onBackgroundBlurChange?: (amount: number) => void;
	zoomMotionBlur?: number;
	onZoomMotionBlurChange?: (amount: number) => void;
	connectZooms?: boolean;
	onConnectZoomsChange?: (enabled: boolean) => void;
	showCursor?: boolean;
	onShowCursorChange?: (enabled: boolean) => void;
	loopCursor?: boolean;
	onLoopCursorChange?: (enabled: boolean) => void;
	cursorSize?: number;
	onCursorSizeChange?: (size: number) => void;
	cursorSmoothing?: number;
	onCursorSmoothingChange?: (smoothing: number) => void;
	cursorMotionBlur?: number;
	onCursorMotionBlurChange?: (amount: number) => void;
	cursorClickBounce?: number;
	onCursorClickBounceChange?: (amount: number) => void;
	cursorSway?: number;
	onCursorSwayChange?: (amount: number) => void;
	cursorStyle?: CursorStyle;
	onCursorStyleChange?: (style: CursorStyle) => void;
	borderRadius?: number;
	onBorderRadiusChange?: (radius: number) => void;
	padding?: number;
	onPaddingChange?: (padding: number) => void;
	cropRegion?: CropRegion;
	onCropChange?: (region: CropRegion) => void;
	aspectRatio: AspectRatio;
	onAspectRatioChange?: (ratio: AspectRatio) => void;
	videoElement?: HTMLVideoElement | null;
	exportQuality?: ExportQuality;
	onExportQualityChange?: (quality: ExportQuality) => void;
	// Export format settings
	exportFormat?: ExportFormat;
	onExportFormatChange?: (format: ExportFormat) => void;
	gifFrameRate?: GifFrameRate;
	onGifFrameRateChange?: (rate: GifFrameRate) => void;
	gifLoop?: boolean;
	onGifLoopChange?: (loop: boolean) => void;
	gifSizePreset?: GifSizePreset;
	onGifSizePresetChange?: (preset: GifSizePreset) => void;
	gifOutputDimensions?: { width: number; height: number };
	onSaveProject?: () => void;
	onLoadProject?: () => void;
	onExport?: () => void;
	selectedAnnotationId?: string | null;
	annotationRegions?: AnnotationRegion[];
	onAnnotationContentChange?: (id: string, content: string) => void;
	onAnnotationTypeChange?: (id: string, type: AnnotationType) => void;
	onAnnotationStyleChange?: (id: string, style: Partial<AnnotationRegion["style"]>) => void;
	onAnnotationFigureDataChange?: (id: string, figureData: FigureData) => void;
	onAnnotationDelete?: (id: string) => void;
	selectedSpeedId?: string | null;
	selectedSpeedValue?: PlaybackSpeed | null;
	onSpeedChange?: (speed: PlaybackSpeed) => void;
	onSpeedDelete?: (id: string) => void;
	// Webcam overlay
	webcamPath?: string | null;
	webcamVisible?: boolean;
	onWebcamVisibleChange?: (visible: boolean) => void;
	webcamShape?: WebcamPanelProps["webcamShape"];
	onWebcamShapeChange?: (shape: NonNullable<WebcamPanelProps["webcamShape"]>) => void;
	webcamSize?: number;
	onWebcamSizeChange?: (size: number) => void;
	webcamOpacity?: number;
	onWebcamOpacityChange?: (opacity: number) => void;
	webcamBorderColor?: string;
	onWebcamBorderColorChange?: (color: string) => void;
	webcamBorderWidth?: number;
	onWebcamBorderWidthChange?: (width: number) => void;
	webcamShadow?: number;
	onWebcamShadowChange?: (shadow: number) => void;
	// Webcam background removal
	webcamBgMode?: BgMode;
	onWebcamBgModeChange?: (mode: BgMode) => void;
	webcamBgBlur?: number;
	onWebcamBgBlurChange?: (amount: number) => void;
	webcamBgColor?: string;
	onWebcamBgColorChange?: (color: string) => void;
	ambilightEnabled?: boolean;
	onAmbilightEnabledChange?: (enabled: boolean) => void;
	isExporting?: boolean;
	// Studio Sound
	videoUrl?: string | null;
	audioEnhanced?: boolean;
	enhancedAudioUrl?: string | null;
	onEnhanceAudio?: (blob: Blob) => void;
	onUndoEnhanceAudio?: () => void;
	// Captions
	captionSettings?: CaptionSettings;
	onCaptionSettingsChange?: (settings: CaptionSettings) => void;
	onGenerateCaptions?: () => void;
	isTranscribing?: boolean;
	transcriptionProgress?: number | null;
}

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
	{ depth: 1, label: "1.25\u00d7" },
	{ depth: 2, label: "1.5\u00d7" },
	{ depth: 3, label: "1.8\u00d7" },
	{ depth: 4, label: "2.2\u00d7" },
	{ depth: 5, label: "3.5\u00d7" },
	{ depth: 6, label: "5\u00d7" },
];

const COLOR_PALETTE = [
	"#FF0000",
	"#FFD700",
	"#00FF00",
	"#FFFFFF",
	"#0000FF",
	"#FF6B00",
	"#9B59B6",
	"#E91E63",
	"#00BCD4",
	"#FF5722",
	"#8BC34A",
	"#FFC107",
	"#2563EB",
	"#000000",
	"#607D8B",
	"#795548",
];

const BLOCK_COLOR_STYLE = {
	width: "100%" as const,
	borderRadius: "8px",
};

const DEFAULT_GIF_OUTPUT_DIMENSIONS = { width: 1280, height: 720 } as const;
const EMPTY_ANNOTATION_REGIONS: AnnotationRegion[] = [];

type SettingsTab = "style" | "motion" | "audio" | "export";

const TAB_ANIMATION = {
	initial: { opacity: 0, y: 4 },
	animate: { opacity: 1, y: 0 },
	exit: { opacity: 0, y: -4 },
	transition: { duration: 0.15, ease: "easeOut" as const },
};

/** Section header: 8px bold uppercase tracking-[0.12em] text-white/20 */
function SectionHeader({ children }: { children: React.ReactNode }) {
	return (
		<div className="mb-[10px]">
			<span className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/20">
				{children}
			</span>
		</div>
	);
}

export function SettingsPanel({
	selected,
	onWallpaperChange,
	selectedZoomDepth,
	onZoomDepthChange,
	selectedZoomId,
	onZoomDelete,
	selectedTrimId,
	onTrimDelete,
	shadowIntensity = 0.67,
	onShadowChange,
	backgroundBlur = 0,
	onBackgroundBlurChange,
	zoomMotionBlur = 0,
	onZoomMotionBlurChange,
	connectZooms = true,
	onConnectZoomsChange,
	showCursor = false,
	onShowCursorChange,
	loopCursor = false,
	onLoopCursorChange,
	cursorSize = 5,
	onCursorSizeChange,
	cursorSmoothing = 2,
	onCursorSmoothingChange,
	cursorMotionBlur = 0.35,
	onCursorMotionBlurChange,
	cursorClickBounce = 1,
	onCursorClickBounceChange,
	cursorSway = DEFAULT_CURSOR_SWAY,
	onCursorSwayChange,
	cursorStyle = "default",
	onCursorStyleChange,
	borderRadius = 12.5,
	onBorderRadiusChange,
	padding = 50,
	onPaddingChange,
	cropRegion,
	onCropChange,
	aspectRatio,
	onAspectRatioChange,
	videoElement,
	exportQuality = "good",
	onExportQualityChange,
	exportFormat = "mp4",
	onExportFormatChange,
	gifFrameRate = 15,
	onGifFrameRateChange,
	gifLoop = true,
	onGifLoopChange,
	gifSizePreset = "medium",
	onGifSizePresetChange,
	gifOutputDimensions = DEFAULT_GIF_OUTPUT_DIMENSIONS,
	onSaveProject,
	onLoadProject,
	onExport: _onExport,
	selectedAnnotationId,
	annotationRegions = EMPTY_ANNOTATION_REGIONS,
	onAnnotationContentChange,
	onAnnotationTypeChange,
	onAnnotationStyleChange,
	onAnnotationFigureDataChange,
	onAnnotationDelete,
	selectedSpeedId,
	selectedSpeedValue,
	onSpeedChange,
	onSpeedDelete,
	webcamPath,
	webcamVisible = true,
	onWebcamVisibleChange,
	webcamShape = "circle",
	onWebcamShapeChange,
	webcamSize = 200,
	onWebcamSizeChange,
	webcamOpacity = 100,
	onWebcamOpacityChange,
	webcamBorderColor = "#FFFFFF",
	onWebcamBorderColorChange,
	webcamBorderWidth = 2,
	onWebcamBorderWidthChange,
	webcamShadow = 0,
	onWebcamShadowChange,
	// AI Background Removal — shelved, will re-enable in AI features phase
	webcamBgMode: _webcamBgMode = "none",
	onWebcamBgModeChange: _onWebcamBgModeChange,
	webcamBgBlur: _webcamBgBlur = 10,
	onWebcamBgBlurChange: _onWebcamBgBlurChange,
	webcamBgColor: _webcamBgColor = "#00FF00",
	onWebcamBgColorChange: _onWebcamBgColorChange,
	ambilightEnabled = true,
	onAmbilightEnabledChange,
	isExporting: _isExporting = false,
	videoUrl,
	audioEnhanced = false,
	enhancedAudioUrl,
	onEnhanceAudio,
	onUndoEnhanceAudio,
	captionSettings = DEFAULT_CAPTION_SETTINGS,
	onCaptionSettingsChange,
	onGenerateCaptions,
	isTranscribing = false,
	transcriptionProgress,
}: SettingsPanelProps) {
	const tSettings = useScopedT("settings");
	const { t } = useI18n();
	const initialEditorPreferences = useMemo(() => loadEditorPreferences(), []);
	const [wallpaperPreviewPaths, setWallpaperPreviewPaths] = useState<string[]>([]);
	const [customImages, setCustomImages] = useState<string[]>(
		initialEditorPreferences.customWallpapers,
	);
	const removeBackgroundStateRef = useRef<{
		aspectRatio: AspectRatio;
		padding: number;
	} | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		let mounted = true;
		(async () => {
			try {
				const resolved = await Promise.all(
					WALLPAPER_RELATIVE_PATHS.map(async (path) =>
						getRenderableAssetUrl(await getAssetPath(path)),
					),
				);
				if (mounted) setWallpaperPreviewPaths(resolved);
			} catch {
				if (mounted) setWallpaperPreviewPaths(WALLPAPER_PATHS);
			}
		})();
		return () => {
			mounted = false;
		};
	}, []);

	const [selectedColor, setSelectedColor] = useState(
		isHexWallpaper(selected) ? selected : "#ADADAD",
	);
	const [gradient, setGradient] = useState<string>(
		GRADIENTS.includes(selected) ? selected : GRADIENTS[0],
	);
	const [backgroundTab, setBackgroundTab] = useState<BackgroundTab>(() =>
		getBackgroundTabForWallpaper(selected),
	);
	const [showCropModal, setShowCropModal] = useState(false);
	const cropSnapshotRef = useRef<CropRegion | null>(null);
	const [activeTab, setActiveTab] = useState<SettingsTab>("style");
	const [showExportFormatMenu, setShowExportFormatMenu] = useState(false);

	useEffect(() => {
		const nextTab = getBackgroundTabForWallpaper(selected);
		setBackgroundTab((prev) => (prev === nextTab ? prev : nextTab));

		if (isHexWallpaper(selected)) {
			setSelectedColor((prev) => (prev === selected ? prev : selected));
		}

		if (GRADIENTS.includes(selected)) {
			setGradient((prev) => (prev === selected ? prev : selected));
		}
	}, [selected]);

	// Separate effect for custom image tracking — uses functional updater
	// so we never need customImages in the dependency array.
	useEffect(() => {
		if (selected.startsWith("data:image")) {
			setCustomImages((prev) => (prev.includes(selected) ? prev : [selected, ...prev]));
		}
	}, [selected]);

	useEffect(() => {
		saveEditorPreferences({ customWallpapers: customImages });
	}, [customImages]);

	const zoomEnabled = Boolean(selectedZoomDepth);
	const trimEnabled = Boolean(selectedTrimId);

	const handleDeleteClick = () => {
		if (selectedZoomId && onZoomDelete) {
			onZoomDelete(selectedZoomId);
		}
	};

	const handleTrimDeleteClick = () => {
		if (selectedTrimId && onTrimDelete) {
			onTrimDelete(selectedTrimId);
		}
	};

	const handleSpeedDeleteClick = () => {
		if (selectedSpeedId && onSpeedDelete) {
			onSpeedDelete(selectedSpeedId);
		}
	};

	const handleCropToggle = () => {
		if (!showCropModal && cropRegion) {
			cropSnapshotRef.current = { ...cropRegion };
		}
		setShowCropModal(!showCropModal);
	};

	const handleCropCancel = () => {
		if (cropSnapshotRef.current) {
			onCropChange?.(cropSnapshotRef.current);
		}
		setShowCropModal(false);
	};

	const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
		const files = event.target.files;
		if (!files || files.length === 0) return;

		const file = files[0];

		// Validate file type - only allow JPG/JPEG
		const validTypes = ["image/jpeg", "image/jpg"];
		if (!validTypes.includes(file.type)) {
			toast.error(tSettings("background.uploadError"), {
				description: tSettings("background.uploadErrorDescription"),
			});
			event.target.value = "";
			return;
		}

		const reader = new FileReader();

		reader.onload = (e) => {
			const dataUrl = e.target?.result as string;
			if (dataUrl) {
				setCustomImages((prev) => [...prev, dataUrl]);
				onWallpaperChange(dataUrl);
				toast.success(tSettings("background.uploadSuccess"));
			}
		};

		reader.onerror = () => {
			toast.error(t("common.failedToUploadImage"), {
				description: t("common.errorReadingFile"),
			});
		};

		reader.readAsDataURL(file);
		// Reset input so the same file can be selected again
		event.target.value = "";
	};

	const handleRemoveCustomImage = (imageUrl: string, event: React.MouseEvent) => {
		event.stopPropagation();
		setCustomImages((prev) => prev.filter((img) => img !== imageUrl));
		// If the removed image was selected, clear selection
		if (selected === imageUrl) {
			onWallpaperChange(WALLPAPER_PATHS[0]);
		}
	};

	const handleSaveThumbnail = useCallback(async (dataUrl: string) => {
		try {
			// Convert data URL to ArrayBuffer
			const response = await fetch(dataUrl);
			const blob = await response.blob();
			const arrayBuffer = await blob.arrayBuffer();

			const result = await window.electronAPI.saveThumbnail(arrayBuffer, "thumbnail.png");
			if (result.success) {
				toast.success("Thumbnail saved successfully");
			} else if (!result.canceled) {
				toast.error("Failed to save thumbnail");
			}
		} catch (err) {
			console.error("[SettingsPanel] Failed to save thumbnail:", err);
			toast.error("Failed to save thumbnail");
		}
	}, []);

	// Find selected annotation
	const selectedAnnotation = useMemo(
		() =>
			selectedAnnotationId
				? (annotationRegions.find((a) => a.id === selectedAnnotationId) ?? null)
				: null,
		[selectedAnnotationId, annotationRegions],
	);

	const handleAnnotationContentChange = useCallback(
		(content: string) => {
			if (selectedAnnotationId && onAnnotationContentChange) {
				onAnnotationContentChange(selectedAnnotationId, content);
			}
		},
		[selectedAnnotationId, onAnnotationContentChange],
	);

	const handleAnnotationTypeChange = useCallback(
		(type: AnnotationType) => {
			if (selectedAnnotationId && onAnnotationTypeChange) {
				onAnnotationTypeChange(selectedAnnotationId, type);
			}
		},
		[selectedAnnotationId, onAnnotationTypeChange],
	);

	const handleAnnotationStyleChange = useCallback(
		(style: Partial<AnnotationRegion["style"]>) => {
			if (selectedAnnotationId && onAnnotationStyleChange) {
				onAnnotationStyleChange(selectedAnnotationId, style);
			}
		},
		[selectedAnnotationId, onAnnotationStyleChange],
	);

	const handleAnnotationFigureDataChange = useCallback(
		(figureData: FigureData) => {
			if (selectedAnnotationId && onAnnotationFigureDataChange) {
				onAnnotationFigureDataChange(selectedAnnotationId, figureData);
			}
		},
		[selectedAnnotationId, onAnnotationFigureDataChange],
	);

	const handleAnnotationDeleteClick = useCallback(() => {
		if (selectedAnnotationId && onAnnotationDelete) {
			onAnnotationDelete(selectedAnnotationId);
		}
	}, [selectedAnnotationId, onAnnotationDelete]);

	// If an annotation is selected, show annotation settings instead
	if (
		selectedAnnotation &&
		onAnnotationContentChange &&
		onAnnotationTypeChange &&
		onAnnotationStyleChange &&
		onAnnotationDelete
	) {
		return (
			<AnnotationSettingsPanel
				annotation={selectedAnnotation}
				onContentChange={handleAnnotationContentChange}
				onTypeChange={handleAnnotationTypeChange}
				onStyleChange={handleAnnotationStyleChange}
				onFigureDataChange={
					onAnnotationFigureDataChange ? handleAnnotationFigureDataChange : undefined
				}
				onDelete={handleAnnotationDeleteClick}
			/>
		);
	}

	const TAB_ICONS: Record<SettingsTab, React.ReactNode> = {
		style: <Palette className="w-3.5 h-3.5" />,
		motion: <Zap className="w-3.5 h-3.5" />,
		audio: <Volume2 className="w-3.5 h-3.5" />,
		export: <Download className="w-3.5 h-3.5" />,
	};

	return (
		<div
			className="flex-[2] min-w-0 flex flex-col h-full overflow-hidden relative bg-transparent"
		>
			{/* Top tab navigation — floating glow pills */}
			<div className="flex-shrink-0">
				<div className="flex items-center justify-between px-6 py-5 flex-shrink-0 bg-white/[0.02] border-b border-white/[0.04]">
					<span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60 font-sans">Settings</span>
					<KeyboardShortcutsHelp />
				</div>

				<div className="px-6 pt-5 pb-1">
					<div className="flex items-center p-1 bg-black/40 rounded-xl shadow-inner border border-white/[0.05] mb-2 relative">
					{(["style", "motion", "audio", "export"] as const).map((tab) => {
						const isActive = activeTab === tab;
						return (
							<button
								key={tab}
								onClick={() => setActiveTab(tab)}
								className={cn(
									"flex-1 flex items-center justify-center py-1.5 rounded-lg transition-all duration-300 cursor-pointer",
									isActive
										? "bg-white/10 text-white shadow-[0_2px_10px_rgba(0,0,0,0.5)] scale-100 border border-white/[0.05]"
										: "bg-transparent text-white/30 hover:text-white/60 scale-95"
								)}
							>
								
								<span className="relative z-10 flex items-center gap-2">
									{TAB_ICONS[tab]}
									<span className="text-[10px] uppercase tracking-[0.1em] font-bold hidden sm:block">
										{tab}
									</span>
								</span>
							</button>
						);
					})}
				</div>
			</div>
		</div>

			{/* Tab content area */}
			<ScrollArea className="flex-1">
				<div className="px-6 py-4">
					<AnimatePresence mode="wait">
						{/* ===== STYLE TAB ===== */}
						{activeTab === "style" && (
							<motion.div key="style" {...TAB_ANIMATION} className="space-y-5">
								{/* Background Wallpaper */}
								<div>
									<SectionHeader>{tSettings("background.title")}</SectionHeader>
									<Tabs
										value={backgroundTab}
										onValueChange={(value) => setBackgroundTab(value as BackgroundTab)}
										className="w-full"
									>
										<TabsList className="mb-2.5 bg-white/[0.04] border-0 p-0.5 w-full grid grid-cols-3 h-7 rounded-lg">
											<TabsTrigger
												value="image"
												className="data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/40 text-[11px] py-1 rounded-md font-medium transition-all duration-150"
											>
												{tSettings("background.image")}
											</TabsTrigger>
											<TabsTrigger
												value="color"
												className="data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/40 text-[11px] py-1 rounded-md font-medium transition-all duration-150"
											>
												{tSettings("background.color")}
											</TabsTrigger>
											<TabsTrigger
												value="gradient"
												className="data-[state=active]:bg-white/[0.08] data-[state=active]:text-white text-white/40 text-[11px] py-1 rounded-md font-medium transition-all duration-150"
											>
												{tSettings("background.gradient")}
											</TabsTrigger>
										</TabsList>

										<div className="max-h-[min(200px,25vh)] overflow-y-auto custom-scrollbar">
											<TabsContent value="image" className="mt-0 space-y-2">
												<input
													type="file"
													ref={fileInputRef}
													onChange={handleImageUpload}
													accept=".jpg,.jpeg,image/jpeg"
													className="hidden"
												/>
												<Button
													onClick={() => fileInputRef.current?.click()}
													variant="outline"
													className="w-full gap-1.5 bg-white/[0.03] text-white/70 border-white/[0.06] hover:bg-white/[0.06] hover:text-white transition-all duration-150 h-8 text-[11px] rounded-lg"
												>
													<Upload className="w-3 h-3" />
													{tSettings("background.uploadCustom")}
												</Button>

												<div className="grid grid-cols-7 gap-1.5">
													{customImages.map((imageUrl, idx) => {
														const isSelected = selected === imageUrl;
														return (
															<div
																key={`custom-${idx}`}
																className={cn(
																	"aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-150 relative group",
																	isSelected
																		? "border-white ring-1 ring-white/20"
																		: "border-white/[0.06] hover:border-white/20 opacity-70 hover:opacity-100",
																)}
																style={{
																	backgroundImage: `url(${imageUrl})`,
																	backgroundSize: "cover",
																	backgroundPosition: "center",
																}}
																onClick={() => onWallpaperChange(imageUrl)}
																role="button"
															>
																<button
																	onClick={(e) => handleRemoveCustomImage(imageUrl, e)}
																	className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10"
																>
																	<X className="w-2 h-2 text-white" />
																</button>
															</div>
														);
													})}

													{(wallpaperPreviewPaths.length > 0
														? wallpaperPreviewPaths
														: WALLPAPER_PATHS
													).map((previewPath, index) => {
														const wallpaper = BUILT_IN_WALLPAPERS[index];
														const wallpaperValue = WALLPAPER_PATHS[index] ?? previewPath;
														const isSelected = (() => {
															if (!selected) return false;
															if (selected === wallpaperValue || selected === previewPath) return true;
															try {
																const clean = (s: string) =>
																	s.replace(/^file:\/\//, "").replace(/^\//, "");
																if (clean(selected).endsWith(clean(wallpaperValue))) return true;
																if (clean(wallpaperValue).endsWith(clean(selected))) return true;
																if (clean(selected).endsWith(clean(previewPath))) return true;
																if (clean(previewPath).endsWith(clean(selected))) return true;
															} catch {
																return false;
															}
															return false;
														})();
														return (
															<div
																key={wallpaperValue}
																className={cn(
																	"aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-150",
																	isSelected
																		? "border-white ring-1 ring-white/20"
																		: "border-white/[0.06] hover:border-white/20 opacity-70 hover:opacity-100",
																)}
																aria-label={wallpaper?.label ?? `Wallpaper ${index + 1}`}
																title={wallpaper?.label ?? `Wallpaper ${index + 1}`}
																style={{
																	backgroundImage: `url(${previewPath})`,
																	backgroundSize: "cover",
																	backgroundPosition: "center",
																}}
																onClick={() => onWallpaperChange(wallpaperValue)}
																role="button"
															/>
														);
													})}
												</div>
											</TabsContent>

											<TabsContent value="color" className="mt-0">
												<div className="p-1">
													<Block
														color={selectedColor}
														colors={COLOR_PALETTE}
														onChange={(color) => {
															setSelectedColor(color.hex);
															onWallpaperChange(color.hex);
														}}
														style={BLOCK_COLOR_STYLE}
													/>
												</div>
											</TabsContent>

											<TabsContent value="gradient" className="mt-0">
												<div className="grid grid-cols-7 gap-1.5">
													{GRADIENTS.map((g, idx) => (
														<div
															key={g}
															className={cn(
																"aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-150",
																gradient === g
																	? "border-white ring-1 ring-white/20"
																	: "border-white/[0.06] hover:border-white/20 opacity-70 hover:opacity-100",
															)}
															style={{ background: g }}
															aria-label={`Gradient ${idx + 1}`}
															onClick={() => {
																setGradient(g);
																onWallpaperChange(g);
															}}
															role="button"
														/>
													))}
												</div>
											</TabsContent>
										</div>
									</Tabs>
								</div>

								{/* Border Radius, Padding, Shadow */}
								<div>
									<SectionHeader>{tSettings("effects.title")}</SectionHeader>
									<div className="flex flex-col bg-white/[0.02] rounded-3xl border border-white/[0.04] overflow-hidden my-4 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.roundness")}
													value={borderRadius}
													defaultValue={12.5}
													min={0}
													max={25}
													step={0.5}
													onChange={(v) => onBorderRadiusChange?.(v)}
													formatValue={(v) => `${v}px`}
													parseInput={(t) => parseFloat(t.replace(/px$/, ""))}
												/>
										</div>
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.padding")}
													value={padding}
													defaultValue={50}
													min={0}
													max={100}
													step={1}
													onChange={(v) => onPaddingChange?.(v)}
													formatValue={(v) => `${v}%`}
													parseInput={(t) => parseFloat(t.replace(/%$/, ""))}
												/>
										</div>
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.shadow")}
													value={shadowIntensity}
													defaultValue={0}
													min={0}
													max={1}
													step={0.01}
													onChange={(v) => onShadowChange?.(v)}
													formatValue={(v) => `${Math.round(v * 100)}%`}
													parseInput={(t) => parseFloat(t.replace(/%$/, "")) / 100}
												/>
										</div>
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.backgroundBlur")}
													value={backgroundBlur}
													defaultValue={0}
													min={0}
													max={8}
													step={0.25}
													onChange={(v) => onBackgroundBlurChange?.(v)}
													formatValue={(v) => `${v.toFixed(1)}px`}
													parseInput={(t) => parseFloat(t.replace(/px$/, ""))}
												/>
										</div>
									</div>
								</div>

								{/* Ambilight toggle */}
								<div className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl hover:bg-white/[0.04] transition-all duration-300">
									<span className="text-[11px] font-medium text-white/50 tracking-wide">
										Ambilight
									</span>
									<Switch
										checked={ambilightEnabled}
										onCheckedChange={onAmbilightEnabledChange}
										className="data-[state=checked]:bg-[#E0000F] data-[state=checked]:shadow-[0_0_8px_rgba(224,0,15,0.25)] data-[state=unchecked]:bg-white/[0.08] scale-90"
									/>
								</div>

								{/* Remove Background toggle */}
								<div className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl hover:bg-white/[0.04] transition-all duration-300">
									<span className="text-[11px] font-medium text-white/50 tracking-wide">
										{tSettings("effects.removeBackground")}
									</span>
									<Switch
										checked={aspectRatio === "native" && padding === 0}
										onCheckedChange={(checked) => {
											if (checked) {
												removeBackgroundStateRef.current = {
													aspectRatio,
													padding,
												};
												onAspectRatioChange?.("native");
												onPaddingChange?.(0);
											} else {
												const prev = removeBackgroundStateRef.current;
												onAspectRatioChange?.(prev?.aspectRatio ?? "16:9");
												onPaddingChange?.(prev?.padding ?? 8);
												removeBackgroundStateRef.current = null;
											}
										}}
										className="data-[state=checked]:bg-[#E0000F] data-[state=checked]:shadow-[0_0_8px_rgba(224,0,15,0.25)] data-[state=unchecked]:bg-white/[0.08] scale-90"
									/>
								</div>

								{/* Crop */}
								<Button
									onClick={handleCropToggle}
									variant="outline"
									className="w-full gap-2 bg-white/[0.02] text-white/60 border-white/[0.06] hover:bg-white/[0.05] hover:text-white/80 hover:border-white/[0.1] text-[11px] font-medium h-9 rounded-lg transition-all duration-150"
								>
									<Crop className="w-3.5 h-3.5" />
									{tSettings("crop.title")}
								</Button>

								{/* Webcam panels (inside Accordion wrapper for compatibility) */}
								{webcamPath && onWebcamVisibleChange && (
									<Accordion type="multiple" defaultValue={["camera"]}>
										<WebcamPanel
											webcamVisible={webcamVisible}
											onWebcamVisibleChange={onWebcamVisibleChange}
											webcamShape={webcamShape}
											onWebcamShapeChange={onWebcamShapeChange}
											webcamSize={webcamSize}
											onWebcamSizeChange={onWebcamSizeChange}
											webcamOpacity={webcamOpacity}
											onWebcamOpacityChange={onWebcamOpacityChange}
											webcamBorderColor={webcamBorderColor}
											onWebcamBorderColorChange={onWebcamBorderColorChange}
											webcamBorderWidth={webcamBorderWidth}
											onWebcamBorderWidthChange={onWebcamBorderWidthChange}
											webcamShadow={webcamShadow}
											onWebcamShadowChange={onWebcamShadowChange}
										/>
										{/* AI Background Removal — shelved, will re-enable in AI features phase
										{onWebcamBgModeChange && (
											<WebcamBackgroundPanel
												webcamBgMode={webcamBgMode}
												onWebcamBgModeChange={onWebcamBgModeChange}
												webcamBgBlur={webcamBgBlur}
												onWebcamBgBlurChange={onWebcamBgBlurChange ?? (() => undefined)}
												webcamBgColor={webcamBgColor}
												onWebcamBgColorChange={onWebcamBgColorChange ?? (() => undefined)}
											/>
										)}
										*/}
									</Accordion>
								)}

								{/* Thumbnails (inside Accordion wrapper for compatibility) */}
								<Accordion type="multiple" defaultValue={["thumbnails"]}>
									<ThumbnailPanel videoUrl={videoUrl ?? null} onSaveThumbnail={handleSaveThumbnail} />
								</Accordion>
							</motion.div>
						)}

						{/* ===== MOTION TAB ===== */}
						{activeTab === "motion" && (
							<motion.div key="motion" {...TAB_ANIMATION} className="space-y-5">
								{/* Zoom Contextual Card */}
								{zoomEnabled && selectedZoomDepth && (
									<div
										className="rounded-[14px]"
										style={{
											background: "rgba(224,0,15,0.03)",
											border: "1px solid rgba(224,0,15,0.1)",
											padding: "14px",
										}}
									>
										<div className="flex items-center gap-2 mb-3">
											<span className="w-2 h-2 rounded-full bg-[#E0000F]" />
											<span className="text-[10px] font-medium text-white/60">Zoom Region</span>
										</div>

										{/* Zoom depth grid — 6 columns */}
										<div className="grid grid-cols-6 gap-[3px]">
											{ZOOM_DEPTH_OPTIONS.map((option) => {
												const isActive = selectedZoomDepth === option.depth;
												return (
													<button
														key={option.depth}
														type="button"
														onClick={() => onZoomDepthChange?.(option.depth)}
														className={cn(
															"py-[6px] text-center rounded-md transition-all duration-150 text-[9px]",
															isActive
																? "bg-white/[0.08] text-white font-semibold"
																: "bg-white/[0.03] text-white/30",
														)}
														style={isActive ? { border: "1px solid rgba(255,255,255,0.15)" } : { border: "1px solid transparent" }}
													>
														{option.label}
													</button>
												);
											})}
										</div>

										<div className="flex justify-end mt-3">
											<button
												onClick={handleDeleteClick}
												className="text-[10px] text-[#E0000F]/40 hover:text-[#E0000F]/70 transition-colors duration-150"
											>
												Delete region
											</button>
										</div>
									</div>
								)}

								{/* Zoom Controls (when no region selected) */}
								{!zoomEnabled && (
									<div>
										<SectionHeader>{tSettings("zoom.level")}</SectionHeader>
										<div className="grid grid-cols-6 gap-[3px]">
											{ZOOM_DEPTH_OPTIONS.map((option) => (
												<button
													key={option.depth}
													type="button"
													disabled
													className="py-[6px] text-center rounded-md text-[9px] bg-white/[0.03] text-white/30 opacity-30 cursor-not-allowed"
													style={{ border: "1px solid transparent" }}
												>
													{option.label}
												</button>
											))}
										</div>
										<p className="text-[10px] text-white/20 mt-2 text-center">
											{tSettings("zoom.selectRegion")}
										</p>
									</div>
								)}

								{/* Zoom Motion Settings */}
								<div>
									<SectionHeader>Zoom Settings</SectionHeader>
									<div className="flex flex-col bg-white/[0.02] rounded-3xl border border-white/[0.04] overflow-hidden my-4 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.zoomMotionBlur")}
													value={zoomMotionBlur}
													defaultValue={DEFAULT_ZOOM_MOTION_BLUR}
													min={0}
													max={2}
													step={0.05}
													onChange={(v) => onZoomMotionBlurChange?.(v)}
													formatValue={(v) => `${v.toFixed(2)}\u00d7`}
													parseInput={(t) => parseFloat(t.replace(/\u00d7$/, ""))}
												/>
										</div>
										<div className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl hover:bg-white/[0.04] transition-all duration-300">
											<span className="text-[11px] font-medium text-white/50 tracking-wide">
												{tSettings("effects.connectZooms")}
											</span>
											<Switch
												checked={connectZooms}
												onCheckedChange={onConnectZoomsChange}
												className="data-[state=checked]:bg-[#E0000F] data-[state=checked]:shadow-[0_0_8px_rgba(224,0,15,0.25)] data-[state=unchecked]:bg-white/[0.08] scale-90"
											/>
										</div>
									</div>
								</div>

								{/* Speed Contextual Card */}
								{selectedSpeedId && selectedSpeedValue && (
									<div
										className="rounded-[14px]"
										style={{
											background: "rgba(224,0,15,0.03)",
											border: "1px solid rgba(224,0,15,0.1)",
											padding: "14px",
										}}
									>
										<div className="flex items-center gap-2 mb-3">
											<span className="w-2 h-2 rounded-full bg-[#E0000F]" />
											<span className="text-[10px] font-medium text-white/60">Speed Region</span>
										</div>

										{/* Speed pills — outlined, flex row */}
										<div className="flex gap-[4px]">
											{SPEED_OPTIONS.map((option) => {
												const isActive = selectedSpeedValue === option.speed;
												return (
													<button
														key={option.speed}
														type="button"
														onClick={() => onSpeedChange?.(option.speed)}
														className={cn(
															"px-4 py-2 rounded-xl text-[11px] transition-all duration-300",
															isActive
																? "bg-[#E0000F] border-[#E0000F] text-white font-bold shadow-[0_0_15px_rgba(224,0,15,0.4)] scale-105"
																: "bg-white/[0.02] text-white/40 hover:bg-white/[0.06] hover:text-white/70 hover:scale-105",
														)}
														style={
															isActive
																? { border: "1px solid #E0000F" }
																: { border: "1px solid rgba(255,255,255,0.08)" }
														}
													>
														{option.label}
													</button>
												);
											})}
										</div>

										<div className="flex justify-end mt-3">
											<button
												onClick={handleSpeedDeleteClick}
												className="text-[10px] text-[#E0000F]/40 hover:text-[#E0000F]/70 transition-colors duration-150"
											>
												Delete region
											</button>
										</div>
									</div>
								)}

								{/* Speed Controls (when no region selected) */}
								{!selectedSpeedId && (
									<div>
										<SectionHeader>{tSettings("speed.playbackSpeed")}</SectionHeader>
										<div className="flex gap-[4px]">
											{SPEED_OPTIONS.map((option) => (
												<button
													key={option.speed}
													type="button"
													disabled
													className="px-3 py-1.5 rounded-full text-[10px] bg-transparent text-white/35 opacity-30 cursor-not-allowed"
													style={{ border: "1px solid rgba(255,255,255,0.08)" }}
												>
													{option.label}
												</button>
											))}
										</div>
										<p className="text-[10px] text-white/20 mt-2 text-center">
											{tSettings("speed.selectRegion")}
										</p>
									</div>
								)}

								{/* Trim Contextual Card */}
								{trimEnabled && (
									<div
										className="rounded-[14px]"
										style={{
											background: "rgba(224,0,15,0.03)",
											border: "1px solid rgba(224,0,15,0.1)",
											padding: "14px",
										}}
									>
										<div className="flex items-center gap-2 mb-3">
											<span className="w-2 h-2 rounded-full bg-[#E0000F]" />
											<span className="text-[10px] font-medium text-white/60">Trim Region</span>
										</div>
										<div className="flex justify-end">
											<button
												onClick={handleTrimDeleteClick}
												className="text-[10px] text-[#E0000F]/40 hover:text-[#E0000F]/70 transition-colors duration-150"
											>
												Delete region
											</button>
										</div>
									</div>
								)}

								{/* Cursor Effects */}
								<div>
									<SectionHeader>Cursor</SectionHeader>
									<div className="flex flex-col bg-white/[0.02] rounded-3xl border border-white/[0.04] overflow-hidden my-4 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
										<div className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl hover:bg-white/[0.04] transition-all duration-300">
											<div className="flex items-center gap-2">
												<span className="text-[11px] font-medium text-white/50 tracking-wide">
													{tSettings("effects.showCursor")}
												</span>
												<kbd className="px-1 py-[1px] text-[7px] font-mono text-white/20 rounded-[3px]" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>C</kbd>
											</div>
											<Switch
												checked={showCursor}
												onCheckedChange={onShowCursorChange}
												className="data-[state=checked]:bg-[#E0000F] data-[state=checked]:shadow-[0_0_8px_rgba(224,0,15,0.25)] data-[state=unchecked]:bg-white/[0.08] scale-90"
											/>
										</div>
										<div className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/[0.04] rounded-xl hover:bg-white/[0.04] transition-all duration-300">
											<span className="text-[11px] font-medium text-white/50 tracking-wide">
												{tSettings("effects.loopCursor")}
											</span>
											<Switch
												checked={loopCursor}
												onCheckedChange={onLoopCursorChange}
												className="data-[state=checked]:bg-[#E0000F] data-[state=checked]:shadow-[0_0_8px_rgba(224,0,15,0.25)] data-[state=unchecked]:bg-white/[0.08] scale-90"
											/>
										</div>
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.cursorSize")}
													value={cursorSize}
													defaultValue={DEFAULT_CURSOR_SIZE}
													min={0.5}
													max={10}
													step={0.05}
													onChange={(v) => onCursorSizeChange?.(v)}
													formatValue={(v) => `${v.toFixed(2)}\u00d7`}
													parseInput={(t) => parseFloat(t.replace(/\u00d7$/, ""))}
												/>
										</div>
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.cursorSmoothing")}
													value={cursorSmoothing}
													defaultValue={DEFAULT_CURSOR_SMOOTHING}
													min={0}
													max={2}
													step={0.01}
													onChange={(v) => onCursorSmoothingChange?.(v)}
													formatValue={(v) => (v <= 0 ? "Off" : v.toFixed(2))}
													parseInput={(t) => parseFloat(t)}
												/>
										</div>
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.cursorMotionBlur")}
													value={cursorMotionBlur}
													defaultValue={DEFAULT_CURSOR_MOTION_BLUR}
													min={0}
													max={2}
													step={0.05}
													onChange={(v) => onCursorMotionBlurChange?.(v)}
													formatValue={(v) => `${v.toFixed(2)}\u00d7`}
													parseInput={(t) => parseFloat(t.replace(/\u00d7$/, ""))}
												/>
										</div>
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.cursorClickBounce")}
													value={cursorClickBounce}
													defaultValue={DEFAULT_CURSOR_CLICK_BOUNCE}
													min={0}
													max={5}
													step={0.05}
													onChange={(v) => onCursorClickBounceChange?.(v)}
													formatValue={(v) => `${v.toFixed(2)}\u00d7`}
													parseInput={(t) => parseFloat(t.replace(/\u00d7$/, ""))}
												/>
										</div>
										<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider last:border-0">
											<SliderControl
													label={tSettings("effects.cursorSway")}
													value={toCursorSwaySliderValue(cursorSway)}
													defaultValue={toCursorSwaySliderValue(DEFAULT_CURSOR_SWAY)}
													min={0}
													max={toCursorSwaySliderValue(2)}
													step={toCursorSwaySliderValue(0.05)}
													onChange={(v) => onCursorSwayChange?.(fromCursorSwaySliderValue(v))}
													formatValue={(v) => (v <= 0 ? "Off" : `${v.toFixed(2)}\u00d7`)}
													parseInput={(t) => {
														const normalized = t.trim().toLowerCase();
														if (normalized === "off") {
															return 0;
														}

														return parseFloat(t.replace(/\u00d7$/, ""));
													}}
												/>
										</div>
										{/* Cursor Style Selector */}
										<div className="px-5 py-4 bg-transparent border-b border-white/[0.04] last:border-0">
											<div className="flex items-center justify-between mb-2.5">
												<span className="text-[11px] font-medium text-white/40">Style</span>
											</div>
											<div className="grid grid-cols-4 gap-1.5">
												{CURSOR_STYLE_OPTIONS.map((option) => {
													const isActive = cursorStyle === option.value;
													return (
														<button
															key={option.value}
															type="button"
															onClick={() => onCursorStyleChange?.(option.value)}
															className={cn(
																"flex flex-col items-center gap-1.5 p-1.5 rounded-lg transition-all duration-150",
																isActive
																	? "bg-white/[0.08] border border-white/[0.15]"
																	: "bg-white/[0.02] border border-transparent hover:bg-white/[0.05] hover:border-white/[0.08]",
															)}
														>
															<div
																className={cn(
																	"w-10 h-10 rounded-md flex items-center justify-center",
																	isActive ? "bg-white/[0.06]" : "bg-white/[0.03]",
																)}
															>
																{option.value === "default" && (
																	<svg width="16" height="20" viewBox="0 0 16 20" fill="none" className="text-white/60">
																		<path d="M1 1L1 15L5.5 10.5L9.5 18L12 17L8 9L14 9L1 1Z" fill="currentColor" stroke="currentColor" strokeWidth="0.5" />
																	</svg>
																)}
																{option.value === "dot" && (
																	<div className="w-4 h-4 rounded-full bg-white/60" />
																)}
																{option.value === "figma" && (
																	<svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-white/60">
																		<line x1="8" y1="0" x2="8" y2="16" stroke="currentColor" strokeWidth="1.5" />
																		<line x1="0" y1="8" x2="16" y2="8" stroke="currentColor" strokeWidth="1.5" />
																	</svg>
																)}
																{option.value === "mono" && (
																	<svg width="16" height="20" viewBox="0 0 16 20" fill="none">
																		<path d="M1 1L1 15L5.5 10.5L9.5 18L12 17L8 9L14 9L1 1Z" fill="black" stroke="white" strokeWidth="1.5" />
																	</svg>
																)}
															</div>
															<span className={cn(
																"text-[8px] font-medium uppercase tracking-wider",
																isActive ? "text-white/60" : "text-white/25",
															)}>
																{option.label}
															</span>
														</button>
													);
												})}
											</div>
										</div>
									</div>
								</div>
							</motion.div>
						)}

						{/* ===== AUDIO TAB ===== */}
						{activeTab === "audio" && (
							<motion.div key="audio" {...TAB_ANIMATION} className="space-y-5">
								{onEnhanceAudio && onUndoEnhanceAudio ? (
									<div>
										<SectionHeader>Studio Sound</SectionHeader>
										<StudioSoundPanel
											videoUrl={videoUrl ?? null}
											audioEnhanced={audioEnhanced}
											enhancedAudioUrl={enhancedAudioUrl ?? null}
											onEnhance={onEnhanceAudio}
											onUndo={onUndoEnhanceAudio}
										/>
									</div>
								) : (
									<div className="flex flex-col items-center justify-center py-12 text-center">
										<Mic className="w-8 h-8 text-white/10 mb-3" />
										<p className="text-[12px] text-white/30 font-medium">No audio settings available</p>
										<p className="text-[10px] text-white/15 mt-1">Audio enhancement is not enabled for this recording</p>
									</div>
								)}

								{/* Captions */}
								{onCaptionSettingsChange && (
									<div>
										<SectionHeader>Captions</SectionHeader>
										<div className="flex flex-col bg-white/[0.02] rounded-3xl border border-white/[0.04] overflow-hidden my-4 shadow-[0_10px_30px_rgba(0,0,0,0.2)]">
											{/* Enable toggle */}
											<div className="flex items-center justify-between p-3 bg-white/[0.02] border-b border-white/[0.04] hover:bg-white/[0.04] transition-all duration-300">
												<div className="flex items-center gap-2">
													<Subtitles className="w-3.5 h-3.5 text-white/40" />
													<span className="text-[11px] font-medium text-white/50 tracking-wide">
														Show Captions
													</span>
												</div>
												<Switch
													checked={captionSettings.enabled}
													onCheckedChange={(enabled) =>
														onCaptionSettingsChange({ ...captionSettings, enabled })
													}
													className="data-[state=checked]:bg-[#E0000F] data-[state=checked]:shadow-[0_0_8px_rgba(224,0,15,0.25)] data-[state=unchecked]:bg-white/[0.08] scale-90"
												/>
											</div>

											{/* Generate captions button */}
											{onGenerateCaptions && (
												<div className="p-3 border-b border-white/[0.04]">
													<Button
														onClick={onGenerateCaptions}
														disabled={isTranscribing}
														variant="outline"
														className="w-full gap-2 bg-white/[0.03] text-white/70 border-white/[0.06] hover:bg-white/[0.06] hover:text-white transition-all duration-150 h-8 text-[11px] rounded-lg disabled:opacity-40"
													>
														<Mic className="w-3 h-3" />
														{isTranscribing
															? `Transcribing${transcriptionProgress != null ? ` (${Math.round(transcriptionProgress)}%)` : "..."}`
															: "Generate Captions"}
													</Button>
												</div>
											)}

											{/* Language selector */}
											<div className="flex items-center justify-between p-3 border-b border-white/[0.04]">
												<span className="text-[11px] font-medium text-white/50 tracking-wide">
													Language
												</span>
												<select
													value={captionSettings.language}
													onChange={(e) =>
														onCaptionSettingsChange({
															...captionSettings,
															language: e.target.value,
														})
													}
													className="bg-white/[0.06] text-white/70 text-[10px] rounded-md px-2 py-1 border border-white/[0.08] outline-none"
												>
													<option value="auto">Auto-detect</option>
													<option value="en">English</option>
													<option value="es">Spanish</option>
													<option value="fr">French</option>
													<option value="de">German</option>
													<option value="pt">Portuguese</option>
													<option value="it">Italian</option>
													<option value="ja">Japanese</option>
													<option value="ko">Korean</option>
													<option value="zh">Chinese</option>
												</select>
											</div>

											{/* Animation style */}
											<div className="flex items-center justify-between p-3 border-b border-white/[0.04]">
												<span className="text-[11px] font-medium text-white/50 tracking-wide">
													Animation
												</span>
												<div className="flex gap-1">
													{(["none", "fade", "rise", "pop"] as const).map((anim) => (
														<button
															key={anim}
															type="button"
															onClick={() =>
																onCaptionSettingsChange({
																	...captionSettings,
																	animation: anim,
																})
															}
															className={`px-2 py-1 rounded-md text-[9px] font-medium transition-all duration-150 ${
																captionSettings.animation === anim
																	? "bg-white/[0.1] text-white border border-white/[0.15]"
																	: "bg-white/[0.03] text-white/30 border border-transparent"
															}`}
														>
															{anim.charAt(0).toUpperCase() + anim.slice(1)}
														</button>
													))}
												</div>
											</div>

											{/* Font size */}
											<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider">
												<SliderControl
													label="Font Size"
													value={captionSettings.fontSize}
													defaultValue={30}
													min={16}
													max={72}
													step={1}
													onChange={(v) =>
														onCaptionSettingsChange({ ...captionSettings, fontSize: v })
													}
													formatValue={(v) => `${v}px`}
													parseInput={(t) => parseFloat(t.replace(/px$/, ""))}
												/>
											</div>

											{/* Max rows */}
											<div className="flex items-center justify-between p-3 border-b border-white/[0.04]">
												<span className="text-[11px] font-medium text-white/50 tracking-wide">
													Max Rows
												</span>
												<div className="flex gap-1">
													{[1, 2, 3, 4].map((rows) => (
														<button
															key={rows}
															type="button"
															onClick={() =>
																onCaptionSettingsChange({
																	...captionSettings,
																	maxRows: rows,
																})
															}
															className={`w-7 h-7 rounded-md text-[10px] font-medium transition-all duration-150 ${
																captionSettings.maxRows === rows
																	? "bg-white/[0.1] text-white border border-white/[0.15]"
																	: "bg-white/[0.03] text-white/30 border border-transparent"
															}`}
														>
															{rows}
														</button>
													))}
												</div>
											</div>

											{/* Position offset */}
											<div className="py-4 px-5 bg-transparent border-b border-white/[0.04] transition-colors duration-200 group/slider">
												<SliderControl
													label="Position"
													value={captionSettings.positionOffset}
													defaultValue={85}
													min={10}
													max={95}
													step={1}
													onChange={(v) =>
														onCaptionSettingsChange({
															...captionSettings,
															positionOffset: v,
														})
													}
													formatValue={(v) => `${v}%`}
													parseInput={(t) => parseFloat(t.replace(/%$/, ""))}
												/>
											</div>

											{/* Background opacity */}
											<div className="py-4 px-5 bg-transparent transition-colors duration-200 group/slider">
												<SliderControl
													label="Background"
													value={captionSettings.backgroundOpacity}
													defaultValue={0.6}
													min={0}
													max={1}
													step={0.05}
													onChange={(v) =>
														onCaptionSettingsChange({
															...captionSettings,
															backgroundOpacity: v,
														})
													}
													formatValue={(v) => `${Math.round(v * 100)}%`}
													parseInput={(t) =>
														parseFloat(t.replace(/%$/, "")) / 100
													}
												/>
											</div>
										</div>
									</div>
								)}
							</motion.div>
						)}

						{/* ===== EXPORT TAB ===== */}
						{activeTab === "export" && (
							<motion.div key="export" {...TAB_ANIMATION} className="space-y-5">
								{/* Format Toggle */}
								<div>
									<SectionHeader>Format</SectionHeader>
									<div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-white/[0.03]">
										<button
											onClick={() => onExportFormatChange?.("mp4")}
											className={cn(
												"flex items-center justify-center gap-2 py-2 rounded-lg transition-all duration-150 text-[11px] font-medium",
												exportFormat === "mp4"
													? "bg-white/[0.08] text-white"
													: "text-white/30 hover:text-white/50 hover:bg-white/[0.03]",
											)}
										>
											<Film className="w-3.5 h-3.5" />
											{tSettings("export.mp4")}
										</button>
										<button
											onClick={() => onExportFormatChange?.("gif")}
											className={cn(
												"flex items-center justify-center gap-2 py-2 rounded-lg transition-all duration-150 text-[11px] font-medium",
												exportFormat === "gif"
													? "bg-white/[0.08] text-white"
													: "text-white/30 hover:text-white/50 hover:bg-white/[0.03]",
											)}
										>
											<Image className="w-3.5 h-3.5" />
											{tSettings("export.gif")}
										</button>
									</div>
								</div>

								{/* Quality */}
								{exportFormat === "mp4" && (
									<div>
										<SectionHeader>Quality</SectionHeader>
										<div className="flex gap-1.5">
											{([
												{ value: "medium" as const, label: tSettings("export.quality.low") },
												{ value: "good" as const, label: tSettings("export.quality.medium") },
												{ value: "high" as const, label: tSettings("export.quality.high") },
												{ value: "source" as const, label: tSettings("export.quality.original") },
											]).map((q) => (
												<button
													key={q.value}
													onClick={() => onExportQualityChange?.(q.value)}
													className={cn(
														"flex-1 py-1.5 rounded-lg text-[10px] font-medium transition-all duration-150",
														exportQuality === q.value
															? "bg-white text-black"
															: "text-white/30 hover:text-white/50 bg-white/[0.03] hover:bg-white/[0.06]",
													)}
												>
													{q.label}
												</button>
											))}
										</div>
									</div>
								)}

								{/* GIF Options */}
								{exportFormat === "gif" && (
									<div>
										<SectionHeader>GIF Options</SectionHeader>
										<div className="space-y-3">
											<div className="flex items-center gap-2">
												<div className="flex-1 bg-white/[0.03] p-0.5 grid grid-cols-4 h-7 rounded-lg">
													{GIF_FRAME_RATES.map((rate) => (
														<button
															key={rate.value}
															onClick={() => onGifFrameRateChange?.(rate.value)}
															className={cn(
																"rounded-md transition-all duration-150 text-[10px] font-medium",
																gifFrameRate === rate.value
																	? "bg-white text-black"
																	: "text-white/30 hover:text-white/50",
															)}
														>
															{rate.value}
														</button>
													))}
												</div>
												<div className="flex-1 bg-white/[0.03] p-0.5 grid grid-cols-3 h-7 rounded-lg">
													{Object.entries(GIF_SIZE_PRESETS).map(([key, _preset]) => (
														<button
															key={key}
															onClick={() => onGifSizePresetChange?.(key as GifSizePreset)}
															className={cn(
																"rounded-md transition-all duration-150 text-[10px] font-medium",
																gifSizePreset === key
																	? "bg-white text-black"
																	: "text-white/30 hover:text-white/50",
															)}
														>
															{key === "original" ? "Orig" : key.charAt(0).toUpperCase() + key.slice(1, 3)}
														</button>
													))}
												</div>
											</div>
											<div className="flex items-center justify-between">
												<span className="text-[10px] text-white/20">
													{gifOutputDimensions.width} \u00d7 {gifOutputDimensions.height}px
												</span>
												<div className="flex items-center gap-2">
													<span className="text-[10px] text-white/30">{tSettings("export.loop")}</span>
													<Switch
														checked={gifLoop}
														onCheckedChange={onGifLoopChange}
														className="data-[state=checked]:bg-[#E0000F] data-[state=checked]:shadow-[0_0_8px_rgba(224,0,15,0.25)] data-[state=unchecked]:bg-white/[0.08] scale-90"
													/>
												</div>
											</div>
										</div>
									</div>
								)}
							</motion.div>
						)}
					</AnimatePresence>
				</div>
			</ScrollArea>

			{/* Export section — pinned to bottom */}
			{activeTab === "export" && (
				<div className="flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.04)", padding: "12px 14px" }}>
					{/* Split export button */}
					<div className="relative">
						<div className="flex mb-2" style={{ gap: "1px" }}>
							<button
								onClick={_onExport}
								className="flex-1 text-white font-semibold text-[13px] active:scale-[0.98] transition-all duration-150"
								style={{
									padding: "10px",
									borderRadius: "10px 0 0 10px",
									background: "linear-gradient(135deg, #E0000F, #FF4500)",
									boxShadow: "0 4px 16px rgba(224,0,15,0.25)",
								}}
							>
								Export {exportFormat === "gif" ? "GIF" : "MP4"}
							</button>
							<button
								onClick={() => setShowExportFormatMenu((prev) => !prev)}
								className="flex items-center justify-center text-white/80 hover:text-white active:scale-95 transition-all duration-150"
								style={{
									width: "38px",
									borderRadius: "0 10px 10px 0",
									background: "linear-gradient(135deg, #C0000D, #E03D00)",
								}}
							>
								&#9662;
							</button>
						</div>
						{showExportFormatMenu && (
							<div className="absolute bottom-full left-0 right-0 mb-1 rounded-lg overflow-hidden border border-white/10 bg-[#18181b] shadow-xl z-50">
								<button
									onClick={() => {
										onExportFormatChange?.("mp4");
										setShowExportFormatMenu(false);
									}}
									className={cn(
										"w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium transition-colors",
										exportFormat === "mp4" ? "bg-white/[0.08] text-white" : "text-white/50 hover:bg-white/[0.05] hover:text-white/80",
									)}
								>
									<Film className="w-3.5 h-3.5" />
									Export as MP4
								</button>
								<button
									onClick={() => {
										onExportFormatChange?.("gif");
										setShowExportFormatMenu(false);
									}}
									className={cn(
										"w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium transition-colors",
										exportFormat === "gif" ? "bg-white/[0.08] text-white" : "text-white/50 hover:bg-white/[0.05] hover:text-white/80",
									)}
								>
									<Image className="w-3.5 h-3.5" />
									Export as GIF
								</button>
							</div>
						)}
					</div>

					{/* Load / Save secondary buttons */}
					<div className="grid grid-cols-2 gap-2">
						<button
							onClick={onLoadProject}
							className="flex items-center justify-center gap-1.5 py-3 rounded-[14px] text-[10px] uppercase tracking-wider font-bold text-white/40 hover:text-white/80 transition-all duration-300 bg-white/[0.02] hover:bg-white/[0.06] hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(0,0,0,0.3)]"
							style={{ border: "1px solid rgba(255,255,255,0.06)" }}
						>
							<FolderOpen className="w-4 h-4" />
							{tSettings("export.loadProject")}
						</button>
						<button
							onClick={onSaveProject}
							className="flex items-center justify-center gap-1.5 py-3 rounded-[14px] text-[10px] uppercase tracking-wider font-bold text-white/60 hover:text-white/90 transition-all duration-300 bg-white/[0.04] hover:bg-white/[0.08] hover:-translate-y-0.5 hover:shadow-[0_10px_20px_rgba(255,255,255,0.05)]"
							style={{ border: "1px solid rgba(37,99,235,0.2)" }}
						>
							<Save className="w-4 h-4" />
							{tSettings("export.saveProject")}
						</button>
					</div>
				</div>
			)}

			{/* Crop Modal */}
			{showCropModal && cropRegion && onCropChange && (
				<>
					<div
						className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 animate-in fade-in duration-200"
						onClick={handleCropCancel}
					/>
					<div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[60] bg-[#09090b] rounded-2xl shadow-2xl border border-white/10 p-8 w-[90vw] max-w-5xl max-h-[90vh] overflow-auto animate-in zoom-in-95 duration-200">
						<div className="flex items-center justify-between mb-6">
							<div>
								<span className="text-xl font-bold text-slate-200">{tSettings("crop.title")}</span>
								<p className="text-sm text-slate-400 mt-2">{tSettings("crop.instruction")}</p>
							</div>
							<Button
								variant="ghost"
								size="icon"
								onClick={handleCropCancel}
								className="hover:bg-white/10 text-slate-400 hover:text-white"
							>
								<X className="w-5 h-5" />
							</Button>
						</div>
						<CropControl
							videoElement={videoElement || null}
							cropRegion={cropRegion}
							onCropChange={onCropChange}
							aspectRatio={aspectRatio}
						/>
						<div className="mt-6 flex justify-end">
							<Button
								onClick={() => setShowCropModal(false)}
								size="lg"
								className="bg-[#E0000F] hover:bg-[#E0000F]/90 text-white"
							>
								{t("common.actions.done")}
							</Button>
						</div>
					</div>
				</>
			)}

			{/* Bottom footer links */}
			<div className="flex-shrink-0 px-4 py-3 border-t border-white/[0.04]">
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => {
							window.electronAPI?.openExternalUrl(
								"https://github.com/usmanasim/klipt/issues/new/choose",
							);
						}}
						className="flex-1 flex items-center justify-center gap-1 text-[10px] font-medium text-white/20 hover:text-white/40 py-1.5 rounded-lg transition-all duration-150"
					>
						<Bug className="w-3 h-3" />
						{tSettings("export.reportBug")}
					</button>
					<button
						type="button"
						onClick={() => {
							window.electronAPI?.openExternalUrl("https://github.com/usmanasim/klipt");
						}}
						className="flex-1 flex items-center justify-center gap-1 text-[10px] font-medium text-white/20 hover:text-white/40 py-1.5 rounded-lg transition-all duration-150"
					>
						<Star className="w-3 h-3" />
						{tSettings("export.starOnGithub")}
					</button>
				</div>
			</div>
		</div>
	);
}

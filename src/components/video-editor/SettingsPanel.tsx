import Block from "@uiw/react-color-block";
import {
	Bug,
	Crop,
	Film,
	FolderOpen,
	Image,
	Mic,
	Palette,
	Save,
	Sparkles,
	Star,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
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
	FigureData,
	PlaybackSpeed,
	ZoomDepth,
} from "./types";
import {
	DEFAULT_CURSOR_CLICK_BOUNCE,
	DEFAULT_CURSOR_MOTION_BLUR,
	DEFAULT_CURSOR_SIZE,
	DEFAULT_CURSOR_SMOOTHING,
	DEFAULT_CURSOR_SWAY,
	DEFAULT_ZOOM_MOTION_BLUR,
	SPEED_OPTIONS,
} from "./types";
import { fromCursorSwaySliderValue, toCursorSwaySliderValue } from "./videoPlayback/cursorSway";
import { WebcamBackgroundPanel } from "./WebcamBackgroundPanel";
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
	isExporting?: boolean;
	// Studio Sound
	videoUrl?: string | null;
	audioEnhanced?: boolean;
	enhancedAudioUrl?: string | null;
	onEnhanceAudio?: (blob: Blob) => void;
	onUndoEnhanceAudio?: () => void;
}

const ZOOM_DEPTH_OPTIONS: Array<{ depth: ZoomDepth; label: string }> = [
	{ depth: 1, label: "1.25×" },
	{ depth: 2, label: "1.5×" },
	{ depth: 3, label: "1.8×" },
	{ depth: 4, label: "2.2×" },
	{ depth: 5, label: "3.5×" },
	{ depth: 6, label: "5×" },
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
const ACCORDION_DEFAULT_VALUE = ["effects", "background"];

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
	webcamBgMode = "none",
	onWebcamBgModeChange,
	webcamBgBlur = 10,
	onWebcamBgBlurChange,
	webcamBgColor = "#00FF00",
	onWebcamBgColorChange,
	isExporting: _isExporting = false,
	videoUrl,
	audioEnhanced = false,
	enhancedAudioUrl,
	onEnhanceAudio,
	onUndoEnhanceAudio,
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
			setCustomImages((prev) =>
				prev.includes(selected) ? prev : [selected, ...prev],
			);
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
		() => selectedAnnotationId
			? annotationRegions.find((a) => a.id === selectedAnnotationId) ?? null
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
					onAnnotationFigureDataChange
						? handleAnnotationFigureDataChange
						: undefined
				}
				onDelete={handleAnnotationDeleteClick}
			/>
		);
	}

	return (
		<div className="flex-[2] min-w-0 bg-[#0B0C10] border border-white/10 rounded-2xl flex flex-col shadow-[0_20px_50px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.05)] h-full overflow-hidden">
			<div className="flex-1 overflow-y-auto custom-scrollbar p-4 pb-0">
				<div className="mb-4">
					<div className="flex items-center justify-between mb-3">
						<span className="text-sm font-semibold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300 drop-shadow-[0_0_8px_rgba(56,189,248,0.4)]">
							{tSettings("zoom.level")}
						</span>
						<div className="flex items-center gap-2">
							{zoomEnabled && selectedZoomDepth && (
								<span className="text-[10px] uppercase tracking-wider font-bold text-cyan-300 bg-cyan-950/40 border border-cyan-500/30 shadow-[0_0_10px_rgba(34,211,238,0.2)] px-2 py-0.5 rounded-full">
									{ZOOM_DEPTH_OPTIONS.find((o) => o.depth === selectedZoomDepth)?.label}
								</span>
							)}
							<KeyboardShortcutsHelp />
						</div>
					</div>
					<div className="grid grid-cols-6 gap-1.5">
						{ZOOM_DEPTH_OPTIONS.map((option) => {
							const isActive = selectedZoomDepth === option.depth;
							return (
								<Button
									key={option.depth}
									type="button"
									disabled={!zoomEnabled}
									onClick={() => onZoomDepthChange?.(option.depth)}
									className={cn(
										"h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all",
										"duration-200 ease-out",
										zoomEnabled ? "opacity-100 cursor-pointer" : "opacity-40 cursor-not-allowed",
										isActive
											? "border-cyan-400/50 bg-gradient-to-b from-blue-600/60 to-cyan-700/60 text-white shadow-[0_0_15px_rgba(6,182,212,0.4),inset_0_1px_0_rgba(255,255,255,0.2)] scale-105"
											: "border-white/5 bg-[#11131A] text-slate-400 hover:bg-[#1A1D27] hover:border-white/20 hover:text-slate-200 hover:shadow-[0_0_10px_rgba(255,255,255,0.05)]",
									)}
								>
									<span className="text-xs font-semibold tracking-wide">{option.label}</span>
								</Button>
							);
						})}
					</div>
					{!zoomEnabled && (
						<p className="text-[10px] text-slate-500 mt-2 text-center">
							{tSettings("zoom.selectRegion")}
						</p>
					)}
					{zoomEnabled && (
						<Button
							onClick={handleDeleteClick}
							variant="destructive"
							size="sm"
							className="mt-3 w-full gap-2 bg-gradient-to-r from-red-600/20 to-red-500/10 text-red-400 border border-red-500/30 hover:from-red-600/30 hover:to-red-500/20 hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:scale-[1.02] transition-all h-8 text-xs font-semibold rounded-lg"
						>
							<Trash2 className="w-3.5 h-3.5" />
							{tSettings("zoom.deleteZoom")}
						</Button>
					)}
				</div>

				{trimEnabled && (
					<div className="mb-5">
						<Button
							onClick={handleTrimDeleteClick}
							variant="destructive"
							size="sm"
							className="w-full gap-2 bg-gradient-to-r from-red-600/20 to-red-500/10 text-red-400 border border-red-500/30 hover:from-red-600/30 hover:to-red-500/20 hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:scale-[1.02] transition-all h-8 text-xs font-semibold rounded-lg"
						>
							<Trash2 className="w-3.5 h-3.5" />
							{tSettings("trim.deleteRegion")}
						</Button>
					</div>
				)}

				<div className="mb-5">
					<div className="flex items-center justify-between mb-3">
						<span className="text-sm font-semibold tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-yellow-300 drop-shadow-[0_0_8px_rgba(251,146,60,0.4)]">
							{tSettings("speed.playbackSpeed")}
						</span>
						{selectedSpeedId && selectedSpeedValue && (
							<span className="text-[10px] uppercase tracking-wider font-bold text-orange-300 bg-orange-950/40 border border-orange-500/30 shadow-[0_0_10px_rgba(249,115,22,0.2)] px-2 py-0.5 rounded-full">
								{SPEED_OPTIONS.find((o) => o.speed === selectedSpeedValue)?.label ??
									`${selectedSpeedValue}×`}
							</span>
						)}
					</div>
					<div className="grid grid-cols-7 gap-1.5">
						{SPEED_OPTIONS.map((option) => {
							const isActive = selectedSpeedValue === option.speed;
							return (
								<Button
									key={option.speed}
									type="button"
									disabled={!selectedSpeedId}
									onClick={() => onSpeedChange?.(option.speed)}
									className={cn(
										"h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all",
										"duration-200 ease-out",
										selectedSpeedId
											? "opacity-100 cursor-pointer"
											: "opacity-40 cursor-not-allowed",
										isActive
											? "border-orange-400/50 bg-gradient-to-b from-orange-600/60 to-yellow-600/60 text-white shadow-[0_0_15px_rgba(249,115,22,0.4),inset_0_1px_0_rgba(255,255,255,0.2)] scale-105"
											: "border-white/5 bg-[#11131A] text-slate-400 hover:bg-[#1A1D27] hover:border-white/20 hover:text-slate-200 hover:shadow-[0_0_10px_rgba(255,255,255,0.05)]",
									)}
								>
									<span className="text-xs font-semibold tracking-wide">{option.label}</span>
								</Button>
							);
						})}
					</div>
					{!selectedSpeedId && (
						<p className="text-[10px] text-slate-500 mt-2 text-center">
							{tSettings("speed.selectRegion")}
						</p>
					)}
					{selectedSpeedId && (
						<Button
							onClick={handleSpeedDeleteClick}
							variant="destructive"
							size="sm"
							className="mt-3 w-full gap-2 bg-gradient-to-r from-red-600/20 to-red-500/10 text-red-400 border border-red-500/30 hover:from-red-600/30 hover:to-red-500/20 hover:border-red-500/50 hover:shadow-[0_0_15px_rgba(239,68,68,0.3)] hover:scale-[1.02] transition-all h-8 text-xs font-semibold rounded-lg"
						>
							<Trash2 className="w-3.5 h-3.5" />
							{tSettings("speed.deleteRegion")}
						</Button>
					)}
				</div>

				<Accordion type="multiple" defaultValue={ACCORDION_DEFAULT_VALUE} className="space-y-2">
					<AccordionItem
						value="effects"
						className="border border-white/5 rounded-xl bg-gradient-to-b from-white/[0.03] to-white/[0.01] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] px-4"
					>
						<AccordionTrigger className="py-3 hover:no-underline group">
							<div className="flex items-center gap-2">
								<Sparkles className="w-4 h-4 text-cyan-400 group-hover:text-cyan-300 drop-shadow-[0_0_5px_rgba(34,211,238,0.6)] transition-colors" />
								<span className="text-xs font-semibold tracking-wide text-slate-200 group-hover:text-white transition-colors">
									{tSettings("effects.title")}
								</span>
							</div>
						</AccordionTrigger>
						<AccordionContent className="pb-3">
							<div className="grid grid-cols-2 gap-2 mb-3">
								<div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
									<div className="text-[10px] font-semibold text-slate-300 tracking-wide">
										{tSettings("effects.showCursor")}
									</div>
									<Switch
										checked={showCursor}
										onCheckedChange={onShowCursorChange}
										className="data-[state=checked]:bg-blue-500 data-[state=checked]:shadow-[0_0_10px_rgba(59,130,246,0.5)] scale-90"
									/>
								</div>
								<div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
									<div className="text-[10px] font-semibold text-slate-300 tracking-wide">
										{tSettings("effects.loopCursor")}
									</div>
									<Switch
										checked={loopCursor}
										onCheckedChange={onLoopCursorChange}
										className="data-[state=checked]:bg-blue-500 data-[state=checked]:shadow-[0_0_10px_rgba(59,130,246,0.5)] scale-90"
									/>
								</div>
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
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
										accentColor="blue"
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-2 mb-3">
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
									<SliderControl
										label={tSettings("effects.zoomMotionBlur")}
										value={zoomMotionBlur}
										defaultValue={DEFAULT_ZOOM_MOTION_BLUR}
										min={0}
										max={2}
										step={0.05}
										onChange={(v) => onZoomMotionBlurChange?.(v)}
										formatValue={(v) => `${v.toFixed(2)}×`}
										parseInput={(t) => parseFloat(t.replace(/×$/, ""))}
										accentColor="green"
									/>
								</div>

								<div className="flex items-center justify-between p-2.5 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
									<div className="text-[10px] font-semibold text-slate-300 tracking-wide">
										{tSettings("effects.connectZooms")}
									</div>
									<Switch
										checked={connectZooms}
										onCheckedChange={onConnectZoomsChange}
										className="data-[state=checked]:bg-cyan-500 data-[state=checked]:shadow-[0_0_10px_rgba(34,211,238,0.5)] scale-90"
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-2 mb-3">
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
									<SliderControl
										label={tSettings("effects.cursorSize")}
										value={cursorSize}
										defaultValue={DEFAULT_CURSOR_SIZE}
										min={0.5}
										max={10}
										step={0.05}
										onChange={(v) => onCursorSizeChange?.(v)}
										formatValue={(v) => `${v.toFixed(2)}×`}
										parseInput={(t) => parseFloat(t.replace(/×$/, ""))}
										accentColor="purple"
									/>
								</div>
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
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
										accentColor="purple"
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-2 mb-3">
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
									<SliderControl
										label={tSettings("effects.cursorMotionBlur")}
										value={cursorMotionBlur}
										defaultValue={DEFAULT_CURSOR_MOTION_BLUR}
										min={0}
										max={2}
										step={0.05}
										onChange={(v) => onCursorMotionBlurChange?.(v)}
										formatValue={(v) => `${v.toFixed(2)}×`}
										parseInput={(t) => parseFloat(t.replace(/×$/, ""))}
										accentColor="purple"
									/>
								</div>
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
									<SliderControl
										label={tSettings("effects.cursorClickBounce")}
										value={cursorClickBounce}
										defaultValue={DEFAULT_CURSOR_CLICK_BOUNCE}
										min={0}
										max={5}
										step={0.05}
										onChange={(v) => onCursorClickBounceChange?.(v)}
										formatValue={(v) => `${v.toFixed(2)}×`}
										parseInput={(t) => parseFloat(t.replace(/×$/, ""))}
										accentColor="purple"
									/>
								</div>
							</div>

							<div className="grid grid-cols-2 gap-2">
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
									<SliderControl
										label={tSettings("effects.cursorSway")}
										value={toCursorSwaySliderValue(cursorSway)}
										defaultValue={toCursorSwaySliderValue(DEFAULT_CURSOR_SWAY)}
										min={0}
										max={toCursorSwaySliderValue(2)}
										step={toCursorSwaySliderValue(0.05)}
										onChange={(v) => onCursorSwayChange?.(fromCursorSwaySliderValue(v))}
										formatValue={(v) => (v <= 0 ? "Off" : `${v.toFixed(2)}×`)}
										parseInput={(t) => {
											const normalized = t.trim().toLowerCase();
											if (normalized === "off") {
												return 0;
											}

											return parseFloat(t.replace(/×$/, ""));
										}}
										accentColor="purple"
									/>
								</div>
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
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
										accentColor="blue"
									/>
								</div>
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
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
										accentColor="blue"
									/>
								</div>
								<div className="p-2 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
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
										accentColor="blue"
									/>
								</div>
								<div className="col-span-2 flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
									<div className="text-[10px] font-semibold text-slate-300 tracking-wide">
										{tSettings("effects.removeBackground")}
									</div>
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
										className="data-[state=checked]:bg-red-500 data-[state=checked]:shadow-[0_0_10px_rgba(239,68,68,0.5)] scale-90"
									/>
								</div>
							</div>

							<Button
								onClick={handleCropToggle}
								variant="outline"
								className="w-full mt-3 gap-2 bg-gradient-to-r from-white/[0.05] to-white/[0.02] text-slate-200 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white text-xs font-semibold tracking-wide h-9 transition-all shadow-sm"
							>
								<Crop className="w-3.5 h-3.5" />
								{tSettings("crop.title")}
							</Button>
						</AccordionContent>
					</AccordionItem>

					{onEnhanceAudio && onUndoEnhanceAudio && (
						<AccordionItem
							value="audio"
							className="border border-white/5 rounded-xl bg-gradient-to-b from-white/[0.03] to-white/[0.01] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] px-4"
						>
							<AccordionTrigger className="py-3 hover:no-underline group">
								<div className="flex items-center gap-2">
									<Mic className="w-4 h-4 text-cyan-400 group-hover:text-cyan-300 drop-shadow-[0_0_5px_rgba(34,211,238,0.6)] transition-colors" />
									<span className="text-xs font-semibold tracking-wide text-slate-200 group-hover:text-white transition-colors">
										Studio Sound
									</span>
								</div>
							</AccordionTrigger>
							<AccordionContent className="pb-3">
								<StudioSoundPanel
									videoUrl={videoUrl ?? null}
									audioEnhanced={audioEnhanced}
									enhancedAudioUrl={enhancedAudioUrl ?? null}
									onEnhance={onEnhanceAudio}
									onUndo={onUndoEnhanceAudio}
								/>
							</AccordionContent>
						</AccordionItem>
					)}

					<AccordionItem
						value="background"
						className="border border-white/5 rounded-xl bg-gradient-to-b from-white/[0.03] to-white/[0.01] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] px-4"
					>
						<AccordionTrigger className="py-3 hover:no-underline group">
							<div className="flex items-center gap-2">
								<Palette className="w-4 h-4 text-purple-400 group-hover:text-purple-300 drop-shadow-[0_0_5px_rgba(192,132,252,0.6)] transition-colors" />
								<span className="text-xs font-semibold tracking-wide text-slate-200 group-hover:text-white transition-colors">
									{tSettings("background.title")}
								</span>
							</div>
						</AccordionTrigger>
						<AccordionContent className="pb-3">
							<Tabs
								value={backgroundTab}
								onValueChange={(value) => setBackgroundTab(value as BackgroundTab)}
								className="w-full"
							>
								<TabsList className="mb-2 bg-white/5 border border-white/5 p-0.5 w-full grid grid-cols-3 h-7 rounded-lg">
									<TabsTrigger
										value="image"
										className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-slate-400 text-[10px] py-1 rounded-md transition-all"
									>
										{tSettings("background.image")}
									</TabsTrigger>
									<TabsTrigger
										value="color"
										className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-slate-400 text-[10px] py-1 rounded-md transition-all"
									>
										{tSettings("background.color")}
									</TabsTrigger>
									<TabsTrigger
										value="gradient"
										className="data-[state=active]:bg-[#2563EB] data-[state=active]:text-white text-slate-400 text-[10px] py-1 rounded-md transition-all"
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
											className="w-full gap-2 bg-white/5 text-slate-200 border-white/10 hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-all h-7 text-[10px]"
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
															"aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 relative group shadow-sm",
															isSelected
																? "border-[#2563EB] ring-1 ring-[#2563EB]/30"
																: "border-white/10 hover:border-[#2563EB]/40 opacity-80 hover:opacity-100 bg-white/5",
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
															className="absolute top-0.5 right-0.5 w-3 h-3 bg-red-500/90 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
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
															"aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 shadow-sm",
															isSelected
																? "border-[#2563EB] ring-1 ring-[#2563EB]/30"
																: "border-white/10 hover:border-[#2563EB]/40 opacity-80 hover:opacity-100 bg-white/5",
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
														"aspect-square w-9 h-9 rounded-md border-2 overflow-hidden cursor-pointer transition-all duration-200 shadow-sm",
														gradient === g
															? "border-[#2563EB] ring-1 ring-[#2563EB]/30"
															: "border-white/10 hover:border-[#2563EB]/40 opacity-80 hover:opacity-100 bg-white/5",
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
						</AccordionContent>
					</AccordionItem>

					{webcamPath && onWebcamVisibleChange && (
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
					)}

					{webcamPath && onWebcamBgModeChange && (
						<WebcamBackgroundPanel
							webcamBgMode={webcamBgMode}
							onWebcamBgModeChange={onWebcamBgModeChange}
							webcamBgBlur={webcamBgBlur}
							onWebcamBgBlurChange={onWebcamBgBlurChange ?? (() => undefined)}
							webcamBgColor={webcamBgColor}
							onWebcamBgColorChange={onWebcamBgColorChange ?? (() => undefined)}
						/>
					)}

					<ThumbnailPanel videoUrl={videoUrl ?? null} onSaveThumbnail={handleSaveThumbnail} />
				</Accordion>
			</div>

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
								className="bg-[#2563EB] hover:bg-[#2563EB]/90 text-white"
							>
								{t("common.actions.done")}
							</Button>
						</div>
					</div>
				</>
			)}

			<div className="flex-shrink-0 p-5 pt-4 bg-[#080A10] border-t border-white/10 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
				<div className="flex items-center gap-3 mb-4">
					<button
						onClick={() => onExportFormatChange?.("mp4")}
						className={cn(
							"flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all text-xs font-semibold tracking-wide",
							exportFormat === "mp4"
								? "bg-blue-600/20 border-blue-500/50 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]"
								: "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:border-white/20 hover:text-slate-200",
						)}
					>
						<Film className="w-4 h-4" />
						{tSettings("export.mp4")}
					</button>
					<button
						onClick={() => onExportFormatChange?.("gif")}
						className={cn(
							"flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border transition-all text-xs font-semibold tracking-wide",
							exportFormat === "gif"
								? "bg-blue-600/20 border-blue-500/50 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]"
								: "bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 hover:border-white/20 hover:text-slate-200",
						)}
					>
						<Image className="w-4 h-4" />
						{tSettings("export.gif")}
					</button>
				</div>

				{exportFormat === "mp4" && (
					<div className="mb-3 grid h-7 w-full grid-cols-4 rounded-lg border border-white/5 bg-white/5 p-0.5">
						<button
							onClick={() => onExportQualityChange?.("medium")}
							className={cn(
								"rounded-md transition-all text-[10px] font-medium",
								exportQuality === "medium"
									? "bg-white text-black"
									: "text-slate-400 hover:text-slate-200",
							)}
						>
							{tSettings("export.quality.low")}
						</button>
						<button
							onClick={() => onExportQualityChange?.("good")}
							className={cn(
								"rounded-md transition-all text-[10px] font-medium",
								exportQuality === "good"
									? "bg-white text-black"
									: "text-slate-400 hover:text-slate-200",
							)}
						>
							{tSettings("export.quality.medium")}
						</button>
						<button
							onClick={() => onExportQualityChange?.("high")}
							className={cn(
								"rounded-md transition-all text-[10px] font-medium",
								exportQuality === "high"
									? "bg-white text-black"
									: "text-slate-400 hover:text-slate-200",
							)}
						>
							{tSettings("export.quality.high")}
						</button>
						<button
							onClick={() => onExportQualityChange?.("source")}
							className={cn(
								"rounded-md transition-all text-[10px] font-medium",
								exportQuality === "source"
									? "bg-white text-black"
									: "text-slate-400 hover:text-slate-200",
							)}
						>
							{tSettings("export.quality.original")}
						</button>
					</div>
				)}

				{exportFormat === "gif" && (
					<div className="mb-3 space-y-2">
						<div className="flex items-center gap-2">
							<div className="flex-1 bg-white/5 border border-white/5 p-0.5 grid grid-cols-4 h-7 rounded-lg">
								{GIF_FRAME_RATES.map((rate) => (
									<button
										key={rate.value}
										onClick={() => onGifFrameRateChange?.(rate.value)}
										className={cn(
											"rounded-md transition-all text-[10px] font-medium",
											gifFrameRate === rate.value
												? "bg-white text-black"
												: "text-slate-400 hover:text-slate-200",
										)}
									>
										{rate.value}
									</button>
								))}
							</div>
							<div className="flex-1 bg-white/5 border border-white/5 p-0.5 grid grid-cols-3 h-7 rounded-lg">
								{Object.entries(GIF_SIZE_PRESETS).map(([key, _preset]) => (
									<button
										key={key}
										onClick={() => onGifSizePresetChange?.(key as GifSizePreset)}
										className={cn(
											"rounded-md transition-all text-[10px] font-medium",
											gifSizePreset === key
												? "bg-white text-black"
												: "text-slate-400 hover:text-slate-200",
										)}
									>
										{key === "original" ? "Orig" : key.charAt(0).toUpperCase() + key.slice(1, 3)}
									</button>
								))}
							</div>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-[10px] text-slate-500">
								{gifOutputDimensions.width} × {gifOutputDimensions.height}px
							</span>
							<div className="flex items-center gap-2">
								<span className="text-[10px] text-slate-400">{tSettings("export.loop")}</span>
								<Switch
									checked={gifLoop}
									onCheckedChange={onGifLoopChange}
									className="data-[state=checked]:bg-[#2563EB] scale-75"
								/>
							</div>
						</div>
					</div>
				)}

				<div className="grid grid-cols-2 gap-3 mb-4">
					<Button
						type="button"
						variant="outline"
						onClick={onLoadProject}
						className="h-10 text-xs font-semibold gap-2 bg-[#1A1D24] border-white/10 text-slate-300 hover:bg-[#252936] hover:text-white hover:border-white/20 transition-all rounded-xl shadow-sm"
					>
						<FolderOpen className="w-4 h-4" />
						{tSettings("export.loadProject")}
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={onSaveProject}
						className="h-10 text-xs font-semibold gap-2 bg-[#1A1D24] border-white/10 text-slate-300 hover:bg-[#252936] hover:text-white hover:border-white/20 transition-all rounded-xl shadow-sm"
					>
						<Save className="w-4 h-4" />
						{tSettings("export.saveProject")}
					</Button>
				</div>
			</div>

			<div className="flex-shrink-0 p-5 pt-4 bg-[#0D0D0D] border-t border-[#2E2E2E]">
				<div className="flex gap-2">
					<button
						type="button"
						onClick={() => {
							window.electronAPI?.openExternalUrl(
								"https://github.com/usmanasim/klipt/issues/new/choose",
							);
						}}
						className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-[#555] hover:text-[#F2F0ED] py-2 hover:bg-[#1C1C1C] rounded-lg transition-colors"
					>
						<Bug className="w-3.5 h-3.5" />
						{tSettings("export.reportBug")}
					</button>
					<button
						type="button"
						onClick={() => {
							window.electronAPI?.openExternalUrl("https://github.com/usmanasim/klipt");
						}}
						className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium text-[#555] hover:text-[#F2F0ED] py-2 hover:bg-[#1C1C1C] rounded-lg transition-colors"
					>
						<Star className="w-3.5 h-3.5 text-[#E0000F]" />
						{tSettings("export.starOnGithub")}
					</button>
				</div>
			</div>
		</div>
	);
}


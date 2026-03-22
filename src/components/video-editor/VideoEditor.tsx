import type { Span } from "dnd-timeline";
import { Download, FolderOpen, Languages, Redo2, Share, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { useI18n } from "@/contexts/I18nContext";
import { useShortcuts } from "@/contexts/ShortcutsContext";
import type { AppLocale } from "@/i18n/config";
import { SUPPORTED_LOCALES } from "@/i18n/config";
import { getAssetPath } from "@/lib/assetPath";
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
import { matchesShortcut } from "@/lib/shortcuts";
import { DEFAULT_WALLPAPER_RELATIVE_PATH } from "@/lib/wallpapers";
import { type AspectRatio, getAspectRatioValue } from "@/utils/aspectRatioUtils";
import { ExportDialog } from "./ExportDialog";
import { loadEditorPreferences, saveEditorPreferences } from "./editorPreferences";
import PlaybackControls from "./PlaybackControls";
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
	type CropRegion,
	type CursorTelemetryPoint,
	clampFocusToDepth,
	DEFAULT_ANNOTATION_POSITION,
	DEFAULT_ANNOTATION_SIZE,
	DEFAULT_ANNOTATION_STYLE,
	DEFAULT_FIGURE_DATA,
	DEFAULT_PLAYBACK_SPEED,
	DEFAULT_ZOOM_DEPTH,
	type FigureData,
	type PlaybackSpeed,
	type SpeedRegion,
	type TrimRegion,
	type ZoomDepth,
	type ZoomFocus,
	type ZoomRegion,
} from "./types";
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

type EditorHistorySnapshot = {
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	speedRegions: SpeedRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
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
		<div className="flex flex-col h-screen w-screen overflow-hidden bg-[#0A0A0C] font-sans selection:bg-[#E0000F]/30 relative items-center justify-center">
			
			{/* Ambient Spatial Lighting */}
			<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[70vw] h-[70vw] rounded-full bg-white/[0.03] blur-[150px] pointer-events-none mix-blend-screen opacity-100" />
			<div className="absolute top-[20%] left-[-10%] w-[40vw] h-[40vw] rounded-full bg-[#E0000F]/10 blur-[150px] pointer-events-none mix-blend-screen opacity-40 animate-pulse-slow" />
			<div className="absolute bottom-[10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-[#2563EB]/10 blur-[180px] pointer-events-none mix-blend-screen opacity-30" />
			<div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.05] mix-blend-overlay pointer-events-none" />

			{/* Floating Top-Left Actions */}
			<div 
				className="absolute top-6 left-6 h-12 bg-white/[0.03] backdrop-blur-[80px] border border-white/[0.08] rounded-full flex items-center px-4 shadow-[0_10px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] z-50 transition-all hover:bg-white/[0.05] hover:border-white/[0.15]"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div className="flex items-center gap-4" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
					<div className="flex items-center gap-2 select-none">
						<div className="w-5 h-5 relative flex items-center justify-center">
							<div className="absolute w-3.5 h-3.5 border-[1.5px] border-white/30 rounded-[4px] transform rotate-12 backdrop-blur-sm shadow-sm" />
							<div className="absolute w-3.5 h-3.5 border-[1.5px] border-white/50 rounded-[4px] transform -rotate-12 backdrop-blur-sm shadow-sm" />
							<div className="absolute w-3.5 h-3.5 bg-gradient-to-tr from-[#FF3B30] to-[#FF9F0A] rounded-[4px] transform rotate-45 shadow-[0_0_12px_rgba(255,59,48,0.6),inset_0_2px_4px_rgba(255,255,255,0.4)]" />
						</div>
						<span className="text-[15px] font-semibold tracking-tight text-white mt-0.5 ml-1 drop-shadow-md">Klipt</span>
					</div>

					<div className="h-4 w-[1px] bg-white/10 mx-1" />

					<div className="flex items-center gap-1">
						<button
							onClick={handleUndo}
							disabled={historyPastRef.current.length === 0}
							className="h-8 w-8 flex items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
							title="Undo (Cmd/Ctrl + Z)"
						>
							<Undo2 className="w-4 h-4" />
						</button>
						<button
							onClick={handleRedo}
							disabled={historyFutureRef.current.length === 0}
							className="h-8 w-8 flex items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent transition-all cursor-pointer"
							title="Redo (Cmd/Ctrl + Shift + Z)"
						>
							<Redo2 className="w-4 h-4" />
						</button>
					</div>
				</div>
			</div>

			{/* Floating Top-Center Project Title */}
			<div className="absolute top-6 left-1/2 -translate-x-1/2 h-12 flex items-center justify-center z-50" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
				<div className="px-5 py-2 rounded-full bg-white/[0.02] backdrop-blur-[60px] border border-white/[0.05] hover:bg-white/[0.05] hover:border-white/[0.1] transition-all cursor-text group flex items-center gap-2 shadow-[0_10px_30px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)]">
					<span className="text-[13px] font-medium tracking-wide text-white/70 group-hover:text-white">
						{currentProjectPath ? currentProjectPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") : "Untitled Project"}
					</span>
					{hasUnsavedChanges && <div className="w-1.5 h-1.5 rounded-full bg-[#FF3B30] shadow-[0_0_8px_rgba(255,59,48,0.8)]" />}
				</div>
			</div>

			{/* Floating Top-Right Actions */}
			<div 
				className="absolute top-6 right-6 h-12 bg-white/[0.03] backdrop-blur-[80px] border border-white/[0.08] rounded-full flex items-center px-2 shadow-[0_10px_40px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] z-50 transition-all hover:bg-white/[0.05] hover:border-white/[0.15]"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
					<LanguageSwitcher />
					<button
						type="button"
						onClick={() => void openRecordingsFolder()}
						className="h-8 w-8 flex items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white transition-all cursor-pointer"
						title={t("common.app.manageRecordings", "Open recordings folder")}
					>
						<FolderOpen className="h-4 w-4" />
					</button>

					<div className="h-4 w-[1px] bg-white/10" />

					<button className="h-8 px-4 rounded-full flex items-center gap-2 text-white/60 hover:bg-white/10 hover:text-white transition-all text-[13px] font-medium cursor-pointer">
						<Share className="w-3.5 h-3.5" />
						Share
					</button>

					<button
						onClick={handleOpenExportDialog}
						disabled={isExporting}
						className="h-8 px-5 flex items-center gap-2 rounded-full bg-white text-black text-[13px] font-bold shadow-[0_4px_15px_rgba(255,255,255,0.2)] hover:shadow-[0_8px_25px_rgba(255,255,255,0.4)] hover:-translate-y-px active:translate-y-0 transition-all disabled:opacity-50 disabled:pointer-events-none ml-1 cursor-pointer"
					>
						<Download className="w-3.5 h-3.5" />
						Export
					</button>
				</div>
			</div>

			{/* The Floating Canvas (Video) */}
			<div className="absolute top-28 bottom-[200px] left-10 right-[360px] flex items-center justify-center z-10 transition-all duration-500">
				<div 
					className="relative w-full h-full flex items-center justify-center drop-shadow-[0_40px_100px_rgba(0,0,0,0.8)]"
				>
					<div
						className="relative"
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
							borderRadius: "16px",
							overflow: "hidden",
							border: "1px solid rgba(255,255,255,0.05)",
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
							speedRegions={speedRegions}
							trimRegions={trimRegions}
							audioRegions={audioRegions}
							annotationRegions={annotationRegions}
							onAnnotationUpdate={handleAnnotationUpdate}
							onAddTextAnnotation={handleAddTextAnnotation}
						/>
					</div>
				</div>
			</div>

			{/* Floating Settings Inspector */}
			<div className="absolute right-6 top-24 bottom-[180px] w-[320px] z-40 flex flex-col">
				<SettingsPanel
					selected={wallpaper}
					onWallpaperChange={setWallpaper}
					selectedZoomDepth={selectedZoomDepth}
					onZoomDepthChange={handleZoomDepthChange}
					selectedZoomId={selectedZoomId}
					onZoomDelete={handleZoomDelete}
					selectedSpeedId={selectedSpeedId}
					selectedSpeedValue={selectedSpeedValue}
					onSpeedValueChange={handleSpeedValueChange}
					onSpeedDelete={handleSpeedDelete}
					selectedTrimId={selectedTrimId}
					onTrimDelete={handleTrimDelete}
					selectedAudioId={selectedAudioId}
					selectedAudioVolume={selectedAudioVolume}
					onAudioVolumeChange={handleAudioVolumeChange}
					selectedAudioFade={selectedAudioFade}
					onAudioFadeChange={handleAudioFadeChange}
					onAudioDelete={handleAudioDelete}
					selectedAnnotationId={selectedAnnotationId}
					onSelectAnnotation={handleSelectAnnotation}
					onAnnotationDelete={handleAnnotationDelete}
					onAddTextAnnotation={handleAddTextAnnotation}
					onAddImageAnnotation={handleAddImageAnnotation}
					updateAnnotation={handleAnnotationUpdate}
					videoWidth={videoPlaybackRef.current?.video?.videoWidth}
					videoHeight={videoPlaybackRef.current?.video?.videoHeight}
					annotationRegions={annotationRegions}
					cursorTelemetry={effectiveCursorTelemetry}
					showCursor={showCursor}
					onShowCursorChange={setShowCursor}
					cursorSize={cursorSize}
					onCursorSizeChange={setCursorSize}
					cursorSmoothing={cursorSmoothing}
					onCursorSmoothingChange={setCursorSmoothing}
					loopCursor={loopCursor}
					onLoopCursorChange={setLoopCursor}
					motionBlur={motionBlur}
					onMotionBlurChange={setMotionBlur}
					zoomMotionBlur={zoomMotionBlur}
					onZoomMotionBlurChange={setZoomMotionBlur}
					cursorSway={cursorSway}
					onCursorSwayChange={setCursorSway}
					shadowOpacity={shadowOpacity}
					onShadowOpacityChange={setShadowOpacity}
					clickBounce={clickBounce}
					onClickBounceChange={setClickBounce}
					backgroundBlur={backgroundBlur}
					onBackgroundBlurChange={setBackgroundBlur}
					connectZooms={connectZooms}
					onConnectZoomsChange={setConnectZooms}
					outputFormat={outputFormat}
					onOutputFormatChange={setOutputFormat}
					exportQuality={exportQuality}
					onExportQualityChange={setExportQuality}
					gifSizePreset={gifSizePreset}
					onGifSizePresetChange={setGifSizePreset}
					gifFps={gifFps}
					onGifFpsChange={setGifFps}
					projectHasTrimRegions={trimRegions.length > 0}
					projectHasSpeedRegions={speedRegions.length > 0}
					projectHasZooms={zoomRegions.length > 0}
					activePanel={activePanel}
					onPanelChange={setActivePanel}
					webcamShape={webcamShape}
					onWebcamShapeChange={setWebcamShape}
				/>
			</div>

			{/* Floating Timeline Console */}
			<div className="absolute bottom-6 left-6 right-[360px] h-[160px] bg-white/[0.03] backdrop-blur-[80px] border border-white/[0.08] rounded-[32px] shadow-[0_30px_100px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(255,255,255,0.1)] overflow-hidden flex flex-col z-50">
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
					selectedAudioId={selectedAudioId}
					onSelectAudio={handleSelectAudio}
					annotationRegions={annotationRegions}
					onAnnotationAdded={handleAnnotationAdded}
					onAnnotationSpanChange={handleAnnotationSpanChange}
					onAnnotationDelete={handleAnnotationDelete}
					selectedAnnotationId={selectedAnnotationId}
					onSelectAnnotation={handleSelectAnnotation}
					aspectRatio={aspectRatio}
					onAspectRatioChange={setAspectRatio}
				/>
			</div>

			<Toaster theme="dark" position="top-center" toastOptions={{ className: "bg-white/[0.05] backdrop-blur-xl border border-white/10 text-white shadow-2xl rounded-2xl" }} />
			
			<ExportDialog
				open={showExportDialog}
				onOpenChange={setShowExportDialog}
				onExport={handleExport}
				progress={exportProgress}
				isExporting={isExporting}
				outputFormat={outputFormat}
			/>
		</div>
	);
}

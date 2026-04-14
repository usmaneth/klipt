/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		/**
		 * The built directory structure
		 *
		 * ```tree
		 * ├─┬─┬ dist
		 * │ │ └── index.html
		 * │ │
		 * │ ├─┬ dist-electron
		 * │ │ ├── main.js
		 * │ │ └── preload.js
		 * │
		 * ```
		 */
		APP_ROOT: string;
		/** /dist/ or /public/ */
		VITE_PUBLIC: string;
	}
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
	electronAPI: {
		getAssetBasePath: () => Promise<string>;
		getVideoAssetPath: (filename: string) => Promise<string | null>;
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		setCursorScale: (scale: number) => Promise<{ success: boolean }>;
		switchToEditor: () => Promise<void>;
		openSourceSelector: () => Promise<void>;
		selectSource: (source: any) => Promise<any>;
		getSelectedSource: () => Promise<any>;
		startNativeScreenRecording: (
			source: any,
			options?: {
				capturesSystemAudio?: boolean;
				capturesMicrophone?: boolean;
				microphoneDeviceId?: string;
				microphoneLabel?: string;
			},
		) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>;
		stopNativeScreenRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		startFfmpegRecording: (
			source: any,
		) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>;
		stopFfmpegRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		storeRecordedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string }>;
		storeEnhancedAudio: (
			audioData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>;
		getRecordedVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>;
		readLocalFile: (
			filePath: string,
		) => Promise<{ success: boolean; data?: Uint8Array; error?: string }>;
		setRecordingState: (recording: boolean) => Promise<void>;
		setIgnoreMouseEvents: (ignore: boolean) => Promise<{ success: boolean }>;
		openCameraBubble: (size?: number) => Promise<{ success: boolean }>;
		closeCameraBubble: () => Promise<{ success: boolean }>;
		resizeCameraBubble: (size: number) => Promise<{ success: boolean }>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		getSystemCursorAssets: () => Promise<{
			success: boolean;
			cursors: Record<string, SystemCursorAsset>;
			error?: string;
		}>;
		onStopRecordingFromTray: (callback: () => void) => () => void;
		onRecordingStateChanged: (
			callback: (state: { recording: boolean; sourceName: string }) => void,
		) => () => void;
		onRecordingInterrupted: (
			callback: (state: { reason: string; message: string }) => void,
		) => () => void;
		onCursorStateChanged: (
			callback: (state: { cursorType: CursorTelemetryPoint["cursorType"] }) => void,
		) => () => void;
		openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
		getAccessibilityPermissionStatus: () => Promise<{
			success: boolean;
			trusted: boolean;
			prompted: boolean;
			error?: string;
		}>;
		requestAccessibilityPermission: () => Promise<{
			success: boolean;
			trusted: boolean;
			prompted: boolean;
			error?: string;
		}>;
		getScreenRecordingPermissionStatus: () => Promise<{
			success: boolean;
			status: string;
			error?: string;
		}>;
		openScreenRecordingPreferences: () => Promise<{ success: boolean; error?: string }>;
		openAccessibilityPreferences: () => Promise<{ success: boolean; error?: string }>;
		saveExportedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string; canceled?: boolean }>;
		saveThumbnail: (
			imageData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string; canceled?: boolean }>;
		openVideoFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		openAudioFilePicker: () => Promise<{ success: boolean; path?: string; canceled?: boolean }>;
		setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadCurrentProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		getPlatform: () => Promise<string>;
		revealInFolder: (
			filePath: string,
		) => Promise<{ success: boolean; error?: string; message?: string }>;
		openRecordingsFolder: () => Promise<{ success: boolean; error?: string; message?: string }>;
		getRecordingsDirectory: () => Promise<{
			success: boolean;
			path: string;
			isDefault: boolean;
			error?: string;
		}>;
		chooseRecordingsDirectory: () => Promise<{
			success: boolean;
			canceled?: boolean;
			path?: string;
			isDefault?: boolean;
			message?: string;
			error?: string;
		}>;
		getShortcuts: () => Promise<Record<string, unknown> | null>;
		saveShortcuts: (shortcuts: unknown) => Promise<{ success: boolean; error?: string }>;
		hudOverlayHide: () => void;
		hudOverlayClose: () => void;
		getHudOverlayCaptureProtection: () => Promise<{ success: boolean; enabled: boolean }>;
		setHudOverlayCaptureProtection: (
			enabled: boolean,
		) => Promise<{ success: boolean; enabled: boolean }>;
		setHasUnsavedChanges: (hasChanges: boolean) => void;
		onRequestSaveBeforeClose: (callback: () => Promise<void>) => () => void;
		isWgcAvailable: () => Promise<{ available: boolean }>;
		muxWgcRecording: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		/** Hide the OS cursor before browser capture starts. */
		hideOsCursor: () => Promise<{ success: boolean }>;
		/** Countdown timer before recording */
		getCountdownDelay: () => Promise<{ success: boolean; delay: number }>;
		setCountdownDelay: (delay: number) => Promise<{ success: boolean; error?: string }>;
		startCountdown: (seconds: number) => Promise<{ success: boolean; cancelled?: boolean }>;
		cancelCountdown: () => Promise<{ success: boolean }>;
		onCountdownTick: (callback: (seconds: number) => void) => () => void;
		storeWebcamVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{ success: boolean; path?: string; message?: string }>;
		getWebcamVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>;
		setCurrentWebcamPath: (path: string) => Promise<{ success: boolean }>;
		getCurrentWebcamPath: () => Promise<{ success: boolean; path?: string }>;
		checkCameraPermission: () => Promise<{ success: boolean; status: string }>;
		requestCameraPermission: () => Promise<{ success: boolean; granted: boolean }>;
		transcribeAudio: (videoPath: string) => Promise<{
			success: boolean;
			result?: {
				words: Array<{ text: string; start: number; end: number; confidence: number }>;
				fullText: string;
				language: string;
			};
			error?: string;
		}>;
		getWhisperModelStatus: () => Promise<{
			success: boolean;
			downloaded: boolean;
			modelPath: string;
			sizeBytes: number;
		}>;
		downloadWhisperModel: () => Promise<{
			success: boolean;
			modelPath?: string;
			error?: string;
		}>;
		onTranscriptionProgress: (callback: (progress: { percent: number }) => void) => () => void;
		onWhisperModelDownloadProgress: (
			callback: (progress: { percent: number }) => void,
		) => () => void;
		getRecentProjects: () => Promise<{
			success: boolean;
			projects: Array<{ name: string; path: string; mtime: number }>;
			error?: string;
		}>;
		openHudOverlay: () => Promise<{ success: boolean }>;
		openSpecificProject: (filePath: string) => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			error?: string;
		}>;
		deleteRecentProject: (filePath: string) => Promise<{
			success: boolean;
			error?: string;
		}>;
		denoiseAudio: (args: {
			inputPath: string;
			outputPath?: string;
			profile: "light" | "moderate" | "aggressive";
		}) => Promise<{
			success: boolean;
			outputPath?: string;
			error?: string;
		}>;
		nativeDenoiseAudio: (inputPath: string) => Promise<{
			success: boolean;
			path?: string;
			error?: string;
		}>;
		detectSilences: (
			filePath: string,
			options?: { thresholdDb?: number; minDurationMs?: number; paddingMs?: number },
		) => Promise<{
			success: boolean;
			silences: Array<{ startMs: number; endMs: number }>;
			error?: string;
		}>;
		nativeDetectSilence: (
			inputPath: string,
			options?: { threshold?: number; minDuration?: number },
		) => Promise<{
			success: boolean;
			regions: Array<{ start: number; end: number }>;
			error?: string;
		}>;
		translateText: (
			text: string,
			targetLang: string,
			sourceLang?: string,
		) => Promise<{
			success: boolean;
			translatedText?: string;
			sourceLanguage?: string;
			targetLanguage?: string;
			error?: string;
		}>;
		dubVideo: (
			videoPath: string,
			targetLanguage: string,
		) => Promise<{
			success: boolean;
			audioPath?: string;
			duration?: number;
			error?: string;
		}>;
		onDubbingProgress: (
			callback: (progress: { phase: string; percent: number; message: string }) => void,
		) => () => void;
		getVoiceCloneStatus: () => Promise<{
			installed: boolean;
			downloadedBytes: number;
			totalBytes: number;
		}>;
		setupVoiceClone: () => Promise<{ success: boolean; error?: string }>;
		onVoiceCloneDownloadProgress: (
			callback: (progress: {
				percent: number;
				downloaded: number;
				total: number;
				file: string;
			}) => void,
		) => () => void;
		copyFileToClipboard: (
			filePath: string,
		) => Promise<{ success: boolean; error?: string }>;
		startShareServer: (
			filePath: string,
			metadata?: {
				title?: string;
				transcript?: Array<{ startMs: number; endMs: number; text: string }>;
				chapters?: Array<{ startMs: number; title: string }>;
				duration?: number;
			},
		) => Promise<{ success: boolean; url?: string; port?: number; error?: string }>;
		stopShareServer: () => Promise<{ success: boolean; error?: string }>;
		getShareAnalytics: () => Promise<{
			success: boolean;
			analytics?: ViewerAnalytics;
			error?: string;
		}>;
		encryptExportedFile: (
			filePath: string,
			password: string,
		) => Promise<{ success: boolean; encryptedPath?: string; error?: string }>;
		decryptExportedFile: (
			filePath: string,
			password: string,
			outputPath: string,
		) => Promise<{ success: boolean; decryptedPath?: string; error?: string }>;
		uploadToS3: (
			filePath: string,
			config: {
				endpoint: string;
				bucket: string;
				accessKeyId: string;
				secretAccessKey: string;
				region?: string;
				pathStyle?: boolean;
			},
		) => Promise<{ success: boolean; url?: string; error?: string }>;
		testS3Connection: (
			config: {
				endpoint: string;
				bucket: string;
				accessKeyId: string;
				secretAccessKey: string;
				region?: string;
				pathStyle?: boolean;
			},
		) => Promise<{ success: boolean; error?: string }>;
		fastExport: (
			inputPath: string,
			outputPath: string,
			trimRegions: Array<{ startMs: number; endMs: number }>,
		) => Promise<{ success: boolean; outputPath?: string; error?: string; canceled?: boolean }>;
		onFastExportProgress: (
			callback: (progress: { percent: number }) => void,
		) => () => void;
		detectScenes: (
			filePath: string,
			threshold?: number,
		) => Promise<{
			success: boolean;
			scenes: Array<{ timeMs: number; confidence: number }>;
			error?: string;
		}>;
		detectFaceRegions: (
			filePath: string,
			intervalMs?: number,
		) => Promise<{
			success: boolean;
			faceRegions: Array<{
				timeMs: number;
				cx: number;
				cy: number;
				width: number;
				height: number;
			}>;
			videoWidth?: number;
			videoHeight?: number;
			error?: string;
		}>;
		extractFramesForFaceDetection: (
			filePath: string,
			options?: { intervalMs?: number; maxFrames?: number },
		) => Promise<{
			success: boolean;
			frames?: Array<{ timeMs: number; path: string }>;
			error?: string;
		}>;
		autoColorCorrect: (
			filePath: string,
			profile: "auto" | "warm" | "cool" | "vivid",
		) => Promise<{ success: boolean; correctedPath?: string; error?: string }>;
		cleanupFaceDetectionFrames: (frameDir: string) => Promise<{ success: boolean }>;
		startBackgroundUpload: (
			filePath: string,
			config: {
				endpoint: string;
				bucket: string;
				accessKeyId: string;
				secretAccessKey: string;
				region?: string;
				pathStyle?: boolean;
			},
		) => Promise<{ success: boolean; url?: string; error?: string }>;
		cancelBackgroundUpload: () => Promise<{ success: boolean }>;
		onBackgroundUploadProgress: (
			callback: (progress: { percent: number }) => void,
		) => () => void;
	};
}

interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
	originalName?: string;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
}

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	interactionType?: "move" | "click" | "double-click" | "right-click" | "middle-click" | "mouseup";
	cursorType?:
		| "arrow"
		| "text"
		| "pointer"
		| "crosshair"
		| "open-hand"
		| "closed-hand"
		| "resize-ew"
		| "resize-ns"
		| "not-allowed";
}

interface SystemCursorAsset {
	dataUrl: string;
	hotspotX: number;
	hotspotY: number;
	width: number;
	height: number;
}

interface ViewerAnalytics {
	totalViews: number;
	uniqueViewers: number;
	viewEvents: Array<{ timestamp: number; ip: string; userAgent: string }>;
}

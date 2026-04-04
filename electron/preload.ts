import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
	hudOverlayHide: () => {
		ipcRenderer.send("hud-overlay-hide");
	},
	hudOverlayClose: () => {
		ipcRenderer.send("hud-overlay-close");
	},
	getHudOverlayCaptureProtection: () => {
		return ipcRenderer.invoke("get-hud-overlay-capture-protection");
	},
	setHudOverlayCaptureProtection: (enabled: boolean) => {
		return ipcRenderer.invoke("set-hud-overlay-capture-protection", enabled);
	},
	getAssetBasePath: async () => {
		return await ipcRenderer.invoke("get-asset-base-path");
	},
	getVideoAssetPath: async (filename: string) => {
		return await ipcRenderer.invoke("get-video-asset-path", filename);
	},
	readLocalFile: (filePath: string) => {
		return ipcRenderer.invoke("read-local-file", filePath);
	},
	getSources: async (opts: Electron.SourcesOptions) => {
		return await ipcRenderer.invoke("get-sources", opts);
	},
	switchToEditor: () => {
		return ipcRenderer.invoke("switch-to-editor");
	},
	openSourceSelector: () => {
		return ipcRenderer.invoke("open-source-selector");
	},
	selectSource: (source: any) => {
		return ipcRenderer.invoke("select-source", source);
	},
	getSelectedSource: () => {
		return ipcRenderer.invoke("get-selected-source");
	},
	startNativeScreenRecording: (
		source: any,
		options?: {
			capturesSystemAudio?: boolean;
			capturesMicrophone?: boolean;
			microphoneDeviceId?: string;
			microphoneLabel?: string;
		},
	) => {
		return ipcRenderer.invoke("start-native-screen-recording", source, options);
	},
	stopNativeScreenRecording: () => {
		return ipcRenderer.invoke("stop-native-screen-recording");
	},
	startFfmpegRecording: (source: any) => {
		return ipcRenderer.invoke("start-ffmpeg-recording", source);
	},
	stopFfmpegRecording: () => {
		return ipcRenderer.invoke("stop-ffmpeg-recording");
	},
	storeRecordedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-recorded-video", videoData, fileName);
	},
	storeEnhancedAudio: (audioData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-enhanced-audio", audioData, fileName);
	},
	getRecordedVideoPath: () => {
		return ipcRenderer.invoke("get-recorded-video-path");
	},
	setRecordingState: (recording: boolean) => {
		return ipcRenderer.invoke("set-recording-state", recording);
	},
	setCursorScale: (scale: number) => {
		return ipcRenderer.invoke("set-cursor-scale", scale);
	},
	getCursorTelemetry: (videoPath?: string) => {
		return ipcRenderer.invoke("get-cursor-telemetry", videoPath);
	},
	getSystemCursorAssets: () => {
		return ipcRenderer.invoke("get-system-cursor-assets");
	},
	onStopRecordingFromTray: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("stop-recording-from-tray", listener);
		return () => ipcRenderer.removeListener("stop-recording-from-tray", listener);
	},
	onRecordingStateChanged: (
		callback: (state: { recording: boolean; sourceName: string }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { recording: boolean; sourceName: string },
		) => callback(payload);
		ipcRenderer.on("recording-state-changed", listener);
		return () => ipcRenderer.removeListener("recording-state-changed", listener);
	},
	onRecordingInterrupted: (callback: (state: { reason: string; message: string }) => void) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { reason: string; message: string },
		) => callback(payload);
		ipcRenderer.on("recording-interrupted", listener);
		return () => ipcRenderer.removeListener("recording-interrupted", listener);
	},
	onCursorStateChanged: (
		callback: (state: { cursorType: CursorTelemetryPoint["cursorType"] }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { cursorType: CursorTelemetryPoint["cursorType"] },
		) => callback(payload);
		ipcRenderer.on("cursor-state-changed", listener);
		return () => ipcRenderer.removeListener("cursor-state-changed", listener);
	},
	openExternalUrl: (url: string) => {
		return ipcRenderer.invoke("open-external-url", url);
	},
	getAccessibilityPermissionStatus: () => {
		return ipcRenderer.invoke("get-accessibility-permission-status");
	},
	requestAccessibilityPermission: () => {
		return ipcRenderer.invoke("request-accessibility-permission");
	},
	getScreenRecordingPermissionStatus: () => {
		return ipcRenderer.invoke("get-screen-recording-permission-status");
	},
	openScreenRecordingPreferences: () => {
		return ipcRenderer.invoke("open-screen-recording-preferences");
	},
	openAccessibilityPreferences: () => {
		return ipcRenderer.invoke("open-accessibility-preferences");
	},
	setIgnoreMouseEvents: (ignore: boolean) => {
		return ipcRenderer.invoke("set-ignore-mouse-events", ignore);
	},
	openCameraBubble: (size?: number) => {
		return ipcRenderer.invoke("open-camera-bubble", size);
	},
	closeCameraBubble: () => {
		return ipcRenderer.invoke("close-camera-bubble");
	},
	resizeCameraBubble: (size: number) => {
		return ipcRenderer.invoke("resize-camera-bubble", size);
	},
	saveExportedVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("save-exported-video", videoData, fileName);
	},
	saveThumbnail: (imageData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("save-thumbnail", imageData, fileName);
	},
	openVideoFilePicker: () => {
		return ipcRenderer.invoke("open-video-file-picker");
	},
	openAudioFilePicker: () => {
		return ipcRenderer.invoke("open-audio-file-picker");
	},
	setCurrentVideoPath: (path: string) => {
		return ipcRenderer.invoke("set-current-video-path", path);
	},
	getCurrentVideoPath: () => {
		return ipcRenderer.invoke("get-current-video-path");
	},
	clearCurrentVideoPath: () => {
		return ipcRenderer.invoke("clear-current-video-path");
	},
	saveProjectFile: (projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
		return ipcRenderer.invoke("save-project-file", projectData, suggestedName, existingProjectPath);
	},
	loadProjectFile: () => {
		return ipcRenderer.invoke("load-project-file");
	},
	loadCurrentProjectFile: () => {
		return ipcRenderer.invoke("load-current-project-file");
	},
	onMenuLoadProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-load-project", listener);
		return () => ipcRenderer.removeListener("menu-load-project", listener);
	},
	onMenuSaveProject: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project", listener);
		return () => ipcRenderer.removeListener("menu-save-project", listener);
	},
	onMenuSaveProjectAs: (callback: () => void) => {
		const listener = () => callback();
		ipcRenderer.on("menu-save-project-as", listener);
		return () => ipcRenderer.removeListener("menu-save-project-as", listener);
	},
	getPlatform: () => {
		return ipcRenderer.invoke("get-platform");
	},
	revealInFolder: (filePath: string) => {
		return ipcRenderer.invoke("reveal-in-folder", filePath);
	},
	openRecordingsFolder: () => {
		return ipcRenderer.invoke("open-recordings-folder");
	},
	getRecordingsDirectory: () => {
		return ipcRenderer.invoke("get-recordings-directory");
	},
	chooseRecordingsDirectory: () => {
		return ipcRenderer.invoke("choose-recordings-directory");
	},
	getShortcuts: () => {
		return ipcRenderer.invoke("get-shortcuts");
	},
	saveShortcuts: (shortcuts: unknown) => {
		return ipcRenderer.invoke("save-shortcuts", shortcuts);
	},
	setHasUnsavedChanges: (hasChanges: boolean) => {
		ipcRenderer.send("set-has-unsaved-changes", hasChanges);
	},
	onRequestSaveBeforeClose: (callback: () => Promise<void>) => {
		const listener = async () => {
			await callback();
			ipcRenderer.send("save-before-close-done");
		};
		ipcRenderer.on("request-save-before-close", listener);
		return () => ipcRenderer.removeListener("request-save-before-close", listener);
	},
	isWgcAvailable: () => ipcRenderer.invoke("is-wgc-available"),
	muxWgcRecording: () => ipcRenderer.invoke("mux-wgc-recording"),
	hideOsCursor: () => ipcRenderer.invoke("hide-cursor"),
	getCountdownDelay: () => ipcRenderer.invoke("get-countdown-delay"),
	setCountdownDelay: (delay: number) => ipcRenderer.invoke("set-countdown-delay", delay),
	startCountdown: (seconds: number) => ipcRenderer.invoke("start-countdown", seconds),
	cancelCountdown: () => ipcRenderer.invoke("cancel-countdown"),
	onCountdownTick: (callback: (seconds: number) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, seconds: number) => callback(seconds);
		ipcRenderer.on("countdown-tick", listener);
		return () => ipcRenderer.removeListener("countdown-tick", listener);
	},
	storeWebcamVideo: (videoData: ArrayBuffer, fileName: string) => {
		return ipcRenderer.invoke("store-webcam-video", videoData, fileName);
	},
	getWebcamVideoPath: () => {
		return ipcRenderer.invoke("get-webcam-video-path");
	},
	setCurrentWebcamPath: (path: string) => {
		return ipcRenderer.invoke("set-current-webcam-path", path);
	},
	getCurrentWebcamPath: () => {
		return ipcRenderer.invoke("get-current-webcam-path");
	},
	checkCameraPermission: () => {
		return ipcRenderer.invoke("check-camera-permission");
	},
	requestCameraPermission: () => {
		return ipcRenderer.invoke("request-camera-permission");
	},
	transcribeAudio: (videoPath: string) => {
		return ipcRenderer.invoke("transcribe-audio", videoPath);
	},
	getWhisperModelStatus: () => {
		return ipcRenderer.invoke("get-whisper-model-status");
	},
	downloadWhisperModel: () => {
		return ipcRenderer.invoke("download-whisper-model");
	},
	onTranscriptionProgress: (callback: (progress: { percent: number }) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: { percent: number }) =>
			callback(payload);
		ipcRenderer.on("transcription-progress", listener);
		return () => ipcRenderer.removeListener("transcription-progress", listener);
	},
	onWhisperModelDownloadProgress: (callback: (progress: { percent: number }) => void) => {
		const listener = (_event: Electron.IpcRendererEvent, payload: { percent: number }) =>
			callback(payload);
		ipcRenderer.on("whisper-model-download-progress", listener);
		return () => ipcRenderer.removeListener("whisper-model-download-progress", listener);
	},
	getRecentProjects: () => {
		return ipcRenderer.invoke("get-recent-projects");
	},
	openHudOverlay: () => {
		return ipcRenderer.invoke("open-hud-overlay");
	},
	openSpecificProject: (filePath: string) => {
		return ipcRenderer.invoke("open-specific-project", filePath);
	},
	nativeDenoiseAudio: (inputPath: string) => {
		return ipcRenderer.invoke("native-denoise-audio", inputPath);
	},
	nativeDetectSilence: (
		inputPath: string,
		options?: { threshold?: number; minDuration?: number },
	) => {
		return ipcRenderer.invoke("native-detect-silence", inputPath, options);
	},
	translateText: (text: string, targetLang: string, sourceLang?: string) => {
		return ipcRenderer.invoke("translate-text", text, targetLang, sourceLang);
	},
	dubVideo: (videoPath: string, targetLanguage: string) => {
		return ipcRenderer.invoke("dub-video", videoPath, targetLanguage);
	},
	onDubbingProgress: (
		callback: (progress: { phase: string; percent: number; message: string }) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { phase: string; percent: number; message: string },
		) => callback(payload);
		ipcRenderer.on("dubbing-progress", listener);
		return () => ipcRenderer.removeListener("dubbing-progress", listener);
	},
	getVoiceCloneStatus: () => {
		return ipcRenderer.invoke("get-voice-clone-status");
	},
	setupVoiceClone: () => {
		return ipcRenderer.invoke("setup-voice-clone");
	},
	onVoiceCloneDownloadProgress: (
		callback: (progress: {
			percent: number;
			downloaded: number;
			total: number;
			file: string;
		}) => void,
	) => {
		const listener = (
			_event: Electron.IpcRendererEvent,
			payload: { percent: number; downloaded: number; total: number; file: string },
		) => callback(payload);
		ipcRenderer.on("voice-clone-download-progress", listener);
		return () => ipcRenderer.removeListener("voice-clone-download-progress", listener);
	},
	copyFileToClipboard: (filePath: string) => {
		return ipcRenderer.invoke("copy-file-to-clipboard", filePath);
	},
	startShareServer: (filePath: string) => {
		return ipcRenderer.invoke("start-share-server", filePath);
	},
	stopShareServer: () => {
		return ipcRenderer.invoke("stop-share-server");
	},
});

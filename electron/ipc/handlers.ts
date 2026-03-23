import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile, spawn, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";

import fs from "node:fs/promises";
import fsSync from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	shell,
	systemPreferences,
} from "electron";
import { transcribeAudio } from "../ai/whisperTranscriber";
import { translateText } from "../../src/lib/ai/translationService";
import {
	downloadVoiceCloneModel,
	extractVoiceReference,
	generateClonedSpeech,
	getVoiceCloneModelStatus,
} from "../ai/voiceCloneEngine";
import { RECORDINGS_DIR } from "../main";
import { closeCountdownWindow, createCountdownWindow, getCountdownWindow } from "../windows";

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(import.meta.url);

const PROJECT_FILE_EXTENSION = "klipt";
const LEGACY_PROJECT_FILE_EXTENSIONS = ["pixelcast", "recordly", "openscreen"];
const WHISPER_MODELS_DIR = path.join(app.getPath("userData"), "whisper-models");
const WHISPER_MODEL_FILENAME = "ggml-base.en.bin";
const WHISPER_MODEL_URL =
	"https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const SHORTCUTS_FILE = path.join(app.getPath("userData"), "shortcuts.json");
const RECORDINGS_SETTINGS_FILE = path.join(app.getPath("userData"), "recordings-settings.json");
const COUNTDOWN_SETTINGS_FILE = path.join(app.getPath("userData"), "countdown-settings.json");
const AUTO_RECORDING_PREFIX = "recording-";
const AUTO_RECORDING_RETENTION_COUNT = 20;
const AUTO_RECORDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const ALLOW_KLIPT_WINDOW_CAPTURE = Boolean(process.env["VITE_DEV_SERVER_URL"]);

function getScreen() {
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

type SelectedSource = {
	id?: string;
	name: string;
	display_id?: string;
	sourceType?: "screen" | "window";
	appName?: string;
	windowTitle?: string;
	[key: string]: unknown;
};

type NativeMacRecordingOptions = {
	capturesSystemAudio?: boolean;
	capturesMicrophone?: boolean;
	microphoneDeviceId?: string;
	microphoneLabel?: string;
};

type WindowBounds = {
	x: number;
	y: number;
	width: number;
	height: number;
};

let selectedSource: SelectedSource | null = null;
let currentProjectPath: string | null = null;
let nativeScreenRecordingActive = false;
let currentVideoPath: string | null = null;
let currentWebcamPath: string | null = null;
let nativeCaptureProcess: ChildProcessWithoutNullStreams | null = null;
let nativeCaptureOutputBuffer = "";
let nativeCaptureTargetPath: string | null = null;
let nativeCaptureStopRequested = false;
let nativeCaptureMicrophonePath: string | null = null;
let nativeCursorMonitorProcess: ChildProcessWithoutNullStreams | null = null;
let nativeCursorMonitorOutputBuffer = "";
let wgcCaptureProcess: ChildProcessWithoutNullStreams | null = null;
let wgcCaptureOutputBuffer = "";
let wgcCaptureTargetPath: string | null = null;
let wgcScreenRecordingActive = false;
let wgcCaptureStopRequested = false;
let wgcSystemAudioPath: string | null = null;
let wgcMicAudioPath: string | null = null;
let wgcPendingVideoPath: string | null = null;
let ffmpegScreenRecordingActive = false;
let ffmpegCaptureProcess: ChildProcessWithoutNullStreams | null = null;
let ffmpegCaptureOutputBuffer = "";
let ffmpegCaptureTargetPath: string | null = null;
let customRecordingsDir: string | null = null;
let recordingsDirLoaded = false;
let cachedSystemCursorAssets: Record<string, SystemCursorAsset> | null = null;
let cachedSystemCursorAssetsSourceMtimeMs: number | null = null;
let countdownTimer: ReturnType<typeof setInterval> | null = null;
let countdownCancelled = false;
let countdownInProgress = false;

type SystemCursorAsset = {
	dataUrl: string;
	hotspotX: number;
	hotspotY: number;
	width: number;
	height: number;
};

type CursorVisualType =
	| "arrow"
	| "text"
	| "pointer"
	| "crosshair"
	| "open-hand"
	| "closed-hand"
	| "resize-ew"
	| "resize-ns"
	| "not-allowed";

let currentCursorVisualType: CursorVisualType | undefined = undefined;

/** Returns the currently selected source ID for setDisplayMediaRequestHandler */
export function getSelectedSourceId(): string | null {
	return (selectedSource?.id as string | null) ?? null;
}

export function killWgcCaptureProcess() {
	if (wgcCaptureProcess) {
		try {
			wgcCaptureProcess.kill();
		} catch {
			/* ignore */
		}
		wgcCaptureProcess = null;
		wgcCaptureTargetPath = null;
		wgcScreenRecordingActive = false;
		nativeScreenRecordingActive = false;
		wgcCaptureStopRequested = false;
		wgcSystemAudioPath = null;
		wgcMicAudioPath = null;
		wgcPendingVideoPath = null;
	}
}

function normalizePath(filePath: string) {
	return path.resolve(filePath);
}

function normalizeDesktopSourceName(value: string) {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasUsableSourceThumbnail(
	thumbnail:
		| {
				isEmpty: () => boolean;
				getSize: () => { width: number; height: number };
		  }
		| null
		| undefined,
) {
	if (!thumbnail || thumbnail.isEmpty()) {
		return false;
	}

	const size = thumbnail.getSize();
	return size.width > 1 && size.height > 1;
}

function getMacPrivacySettingsUrl(pane: "screen" | "accessibility") {
	return pane === "screen"
		? "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
		: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
}

function isAutoRecordingPath(filePath: string) {
	const baseName = path.basename(filePath);
	return baseName.startsWith(AUTO_RECORDING_PREFIX) || baseName.startsWith("webcam-");
}

function getTelemetryPathForVideo(videoPath: string) {
	return `${videoPath}.cursor.json`;
}

async function loadRecordingsDirectorySetting() {
	if (recordingsDirLoaded) {
		return;
	}

	recordingsDirLoaded = true;

	try {
		const content = await fs.readFile(RECORDINGS_SETTINGS_FILE, "utf-8");
		const parsed = JSON.parse(content) as { recordingsDir?: unknown };
		if (typeof parsed.recordingsDir === "string" && parsed.recordingsDir.trim()) {
			customRecordingsDir = path.resolve(parsed.recordingsDir);
		}
	} catch {
		customRecordingsDir = null;
	}
}

async function getRecordingsDir() {
	await loadRecordingsDirectorySetting();
	const targetDir = customRecordingsDir ?? RECORDINGS_DIR;
	await fs.mkdir(targetDir, { recursive: true });
	return targetDir;
}

async function persistRecordingsDirectorySetting(nextDir: string) {
	customRecordingsDir = path.resolve(nextDir);
	recordingsDirLoaded = true;
	await fs.writeFile(
		RECORDINGS_SETTINGS_FILE,
		JSON.stringify({ recordingsDir: customRecordingsDir }, null, 2),
		"utf-8",
	);
}

function normalizeVideoSourcePath(videoPath?: string | null): string | null {
	if (typeof videoPath !== "string") {
		return null;
	}

	const trimmed = videoPath.trim();
	if (!trimmed) {
		return null;
	}

	if (/^file:\/\//i.test(trimmed)) {
		try {
			return fileURLToPath(trimmed);
		} catch {
			// Fall through and keep best-effort string path below.
		}
	}

	return trimmed;
}

async function hasSiblingProjectFile(videoPath: string) {
	const baseName = path.basename(videoPath, path.extname(videoPath));
	const candidateExtensions = [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS];

	for (const extension of candidateExtensions) {
		const projectPath = path.join(path.dirname(videoPath), `${baseName}.${extension}`);

		try {
			await fs.access(projectPath);
			return true;
		} catch {
			continue;
		}
	}

	return false;
}

async function pruneAutoRecordings(exemptPaths: string[] = []) {
	const recordingsDir = await getRecordingsDir();
	const exempt = new Set(
		[currentVideoPath, currentWebcamPath, ...exemptPaths]
			.filter((value): value is string => Boolean(value))
			.map((value) => normalizePath(value)),
	);

	const entries = await fs.readdir(recordingsDir, { withFileTypes: true });
	const autoRecordingStats = await Promise.all(
		entries
			.filter(
				(entry) => entry.isFile() && /^(recording|webcam)-.*\.(mp4|mov|webm)$/i.test(entry.name),
			)
			.map(async (entry) => {
				const filePath = path.join(recordingsDir, entry.name);
				const stats = await fs.stat(filePath);
				return { filePath, stats };
			}),
	);

	const sorted = autoRecordingStats.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
	const now = Date.now();

	for (const [index, entry] of sorted.entries()) {
		const normalizedFilePath = normalizePath(entry.filePath);
		if (exempt.has(normalizedFilePath)) {
			continue;
		}

		if (await hasSiblingProjectFile(entry.filePath)) {
			continue;
		}

		const tooOld = now - entry.stats.mtimeMs > AUTO_RECORDING_MAX_AGE_MS;
		const overLimit = index >= AUTO_RECORDING_RETENTION_COUNT;
		if (!tooOld && !overLimit) {
			continue;
		}

		try {
			await fs.rm(entry.filePath, { force: true });
			await fs.rm(getTelemetryPathForVideo(entry.filePath), { force: true });
		} catch (error) {
			console.warn("Failed to prune old auto recording:", entry.filePath, error);
		}
	}
}

/**
 * Resolve a path within the app bundle, handling asar unpacking in production.
 * Files listed in asarUnpack are extracted to app.asar.unpacked/ and must be
 * accessed via that path instead of the asar virtual filesystem.
 */
function resolveUnpackedAppPath(...segments: string[]) {
	const base = app.getAppPath();
	const resolved = path.join(base, ...segments);
	if (app.isPackaged) {
		return resolved.replace(/\.asar([/\\])/, ".asar.unpacked$1");
	}
	return resolved;
}

function getNativeCaptureHelperSourcePath() {
	return resolveUnpackedAppPath("electron", "native", "ScreenCaptureKitRecorder.swift");
}

function getNativeArchTag() {
	return process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
}

function getPrebundledNativeHelperPath(binaryName: string) {
	return resolveUnpackedAppPath("electron", "native", "bin", getNativeArchTag(), binaryName);
}

function getNativeCaptureHelperBinaryPath() {
	return path.join(app.getPath("userData"), "native-tools", "klipt-screencapturekit-helper");
}

function getSystemCursorHelperSourcePath() {
	return resolveUnpackedAppPath("electron", "native", "SystemCursorAssets.swift");
}

function getSystemCursorHelperBinaryPath() {
	return path.join(app.getPath("userData"), "native-tools", "klipt-system-cursors");
}

function getNativeCursorMonitorSourcePath() {
	return resolveUnpackedAppPath("electron", "native", "NativeCursorMonitor.swift");
}

function getNativeCursorMonitorBinaryPath() {
	return path.join(app.getPath("userData"), "native-tools", "klipt-native-cursor-monitor");
}

function getAudioProcessorSourcePath() {
	return resolveUnpackedAppPath("electron", "native", "AudioProcessor.swift");
}

function getAudioProcessorBinaryPath() {
	return path.join(app.getPath("userData"), "native-tools", "klipt-audio");
}

async function ensureAudioProcessorBinary() {
	return ensureSwiftHelperBinary(
		getAudioProcessorSourcePath(),
		getAudioProcessorBinaryPath(),
		"native audio processor",
		"klipt-audio",
	);
}

function getNativeWindowListSourcePath() {
	return resolveUnpackedAppPath("electron", "native", "ScreenCaptureKitWindowList.swift");
}

function getNativeWindowListBinaryPath() {
	return path.join(app.getPath("userData"), "native-tools", "klipt-window-list");
}

type NativeMacWindowSource = {
	id: string;
	name: string;
	display_id?: string;
	appName?: string;
	windowTitle?: string;
	bundleId?: string;
	appIcon?: string | null;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
};

let cachedNativeMacWindowSources: NativeMacWindowSource[] | null = null;
let cachedNativeMacWindowSourcesAtMs = 0;

async function ensureSwiftHelperBinary(
	sourcePath: string,
	binaryPath: string,
	label: string,
	prebundledBinaryName?: string,
) {
	if (prebundledBinaryName) {
		const prebundledPath = getPrebundledNativeHelperPath(prebundledBinaryName);
		try {
			await fs.access(prebundledPath, fsConstants.X_OK);
			return prebundledPath;
		} catch {
			if (app.isPackaged) {
				throw new Error(
					`${label} is missing from this app build (${prebundledPath}). Reinstall or update the app.`,
				);
			}
		}
	}

	const helperDir = path.dirname(binaryPath);

	await fs.mkdir(helperDir, { recursive: true });

	let shouldCompile = false;
	try {
		const [sourceStat, binaryStat] = await Promise.all([
			fs.stat(sourcePath),
			fs.stat(binaryPath).catch(() => null),
		]);
		shouldCompile = !binaryStat || sourceStat.mtimeMs > binaryStat.mtimeMs;
	} catch (error) {
		throw new Error(`${label} source is unavailable: ${String(error)}`);
	}

	if (!shouldCompile) {
		return binaryPath;
	}

	const result = spawnSync("swiftc", ["-O", sourcePath, "-o", binaryPath], {
		encoding: "utf8",
		timeout: 120000,
	});

	if (result.status !== 0) {
		const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
		throw new Error(details || `Failed to compile ${label}`);
	}

	return binaryPath;
}

async function ensureNativeCaptureHelperBinary() {
	return ensureSwiftHelperBinary(
		getNativeCaptureHelperSourcePath(),
		getNativeCaptureHelperBinaryPath(),
		"native ScreenCaptureKit helper",
		"klipt-screencapturekit-helper",
	);
}

async function ensureNativeWindowListBinary() {
	return ensureSwiftHelperBinary(
		getNativeWindowListSourcePath(),
		getNativeWindowListBinaryPath(),
		"native ScreenCaptureKit window list helper",
		"klipt-window-list",
	);
}

async function getNativeMacWindowSources(options?: { maxAgeMs?: number }) {
	if (process.platform !== "darwin") {
		return [] as NativeMacWindowSource[];
	}

	const maxAgeMs = options?.maxAgeMs ?? 5000;
	const now = Date.now();
	if (cachedNativeMacWindowSources && now - cachedNativeMacWindowSourcesAtMs < maxAgeMs) {
		return cachedNativeMacWindowSources;
	}

	const binaryPath = await ensureNativeWindowListBinary();
	const { stdout } = await execFileAsync(binaryPath, [], {
		timeout: 30000,
		maxBuffer: 10 * 1024 * 1024,
	});

	const parsed = JSON.parse(stdout);
	if (!Array.isArray(parsed)) {
		return [] as NativeMacWindowSource[];
	}

	const entries = parsed.filter((entry: unknown): entry is NativeMacWindowSource => {
		if (!entry || typeof entry !== "object") {
			return false;
		}

		const candidate = entry as Partial<NativeMacWindowSource>;
		return typeof candidate.id === "string" && typeof candidate.name === "string";
	});

	cachedNativeMacWindowSources = entries;
	cachedNativeMacWindowSourcesAtMs = now;
	return entries;
}

async function getSystemCursorAssets() {
	if (process.platform !== "darwin") {
		cachedSystemCursorAssets = {};
		cachedSystemCursorAssetsSourceMtimeMs = null;
		return cachedSystemCursorAssets;
	}

	const sourcePath = getSystemCursorHelperSourcePath();
	const sourceStat = await fs.stat(sourcePath);
	if (cachedSystemCursorAssets && cachedSystemCursorAssetsSourceMtimeMs === sourceStat.mtimeMs) {
		return cachedSystemCursorAssets;
	}

	const binaryPath = await ensureSwiftHelperBinary(
		sourcePath,
		getSystemCursorHelperBinaryPath(),
		"system cursor helper",
		"klipt-system-cursors",
	);

	const { stdout } = await execFileAsync(binaryPath, [], {
		timeout: 15000,
		maxBuffer: 20 * 1024 * 1024,
	});
	const parsed = JSON.parse(stdout) as Record<string, Partial<SystemCursorAsset>>;
	cachedSystemCursorAssets = Object.fromEntries(
		Object.entries(parsed).filter(
			([, asset]) =>
				typeof asset?.dataUrl === "string" &&
				typeof asset?.hotspotX === "number" &&
				typeof asset?.hotspotY === "number" &&
				typeof asset?.width === "number" &&
				typeof asset?.height === "number",
		),
	) as Record<string, SystemCursorAsset>;
	cachedSystemCursorAssetsSourceMtimeMs = sourceStat.mtimeMs;

	return cachedSystemCursorAssets;
}

function parseWindowId(sourceId?: string) {
	if (!sourceId) return null;
	const match = sourceId.match(/^window:(\d+)/);
	return match ? Number.parseInt(match[1], 10) : null;
}

function loadFfmpegStatic() {
	const moduleExports = nodeRequire("ffmpeg-static");
	if (typeof moduleExports === "string") {
		return moduleExports;
	}

	if (typeof moduleExports?.default === "string") {
		return moduleExports.default as string;
	}

	return null;
}

function loadUiohookModule() {
	const moduleExports = nodeRequire("uiohook-napi");
	return (
		(moduleExports as any)?.uIOhook ??
		(moduleExports as any)?.uiohook ??
		(moduleExports as any)?.Uiohook ??
		(moduleExports as any)?.default?.uIOhook ??
		(moduleExports as any)?.default?.uiohook ??
		(moduleExports as any)?.default ??
		moduleExports
	);
}

function getFfmpegBinaryPath() {
	const ffmpegStatic = loadFfmpegStatic();
	if (!ffmpegStatic || typeof ffmpegStatic !== "string") {
		throw new Error("FFmpeg binary is unavailable. Install ffmpeg-static for this platform.");
	}

	if (app.isPackaged) {
		return ffmpegStatic.replace(/\.asar([/\\])/, ".asar.unpacked$1");
	}

	return ffmpegStatic;
}

function waitForFfmpegCaptureStart(process: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					ffmpegCaptureOutputBuffer.trim() ||
						`FFmpeg exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const timer = setTimeout(() => {
			cleanup();
			resolve();
		}, 900);

		const cleanup = () => {
			clearTimeout(timer);
			process.off("error", onError);
			process.off("exit", onExit);
		};

		process.once("error", onError);
		process.once("exit", onExit);
	});
}

function waitForFfmpegCaptureStop(process: ChildProcessWithoutNullStreams, outputPath: string) {
	return new Promise<string>((resolve, reject) => {
		const onClose = async (code: number | null) => {
			cleanup();

			try {
				await fs.access(outputPath);
				if (code === 0 || code === null) {
					resolve(outputPath);
					return;
				}

				if (ffmpegCaptureOutputBuffer.includes("Exiting normally")) {
					resolve(outputPath);
					return;
				}
			} catch {
				// handled below
			}

			reject(
				new Error(
					ffmpegCaptureOutputBuffer.trim() || `FFmpeg exited with code ${code ?? "unknown"}`,
				),
			);
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const cleanup = () => {
			process.off("close", onClose);
			process.off("error", onError);
		};

		process.once("close", onClose);
		process.once("error", onError);
	});
}

function getDisplayBoundsForSource(source: SelectedSource) {
	const sourceDisplayId = Number(source?.display_id);
	if (Number.isFinite(sourceDisplayId)) {
		const matched = getScreen()
			.getAllDisplays()
			.find((display) => display.id === sourceDisplayId);
		if (matched) {
			return matched.bounds;
		}
	}

	return getScreen().getPrimaryDisplay().bounds;
}

function parseXwininfoBounds(stdout: string): WindowBounds | null {
	const absX = stdout.match(/Absolute upper-left X:\s+(-?\d+)/);
	const absY = stdout.match(/Absolute upper-left Y:\s+(-?\d+)/);
	const width = stdout.match(/Width:\s+(\d+)/);
	const height = stdout.match(/Height:\s+(\d+)/);

	if (!absX || !absY || !width || !height) {
		return null;
	}

	return {
		x: Number.parseInt(absX[1], 10),
		y: Number.parseInt(absY[1], 10),
		width: Number.parseInt(width[1], 10),
		height: Number.parseInt(height[1], 10),
	};
}

async function resolveLinuxWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source?.id);

	if (windowId) {
		try {
			const { stdout } = await execFileAsync("xwininfo", ["-id", String(windowId)], {
				timeout: 1500,
			});
			const bounds = parseXwininfoBounds(stdout);
			if (bounds && bounds.width > 0 && bounds.height > 0) {
				return bounds;
			}
		} catch {
			// fall back to title lookup below
		}
	}

	const windowTitle =
		typeof source.windowTitle === "string" ? source.windowTitle.trim() : source.name.trim();
	if (!windowTitle) {
		return null;
	}

	try {
		const { stdout } = await execFileAsync("xwininfo", ["-name", windowTitle], { timeout: 1500 });
		const bounds = parseXwininfoBounds(stdout);
		return bounds && bounds.width > 0 && bounds.height > 0 ? bounds : null;
	} catch {
		return null;
	}
}

async function buildFfmpegCaptureArgs(source: SelectedSource, outputPath: string) {
	const commonOutputArgs = [
		"-an",
		"-c:v",
		"libx264",
		"-preset",
		"veryfast",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		outputPath,
	];

	if (process.platform === "win32") {
		if (source?.id?.startsWith("window:")) {
			const windowTitle =
				typeof source.windowTitle === "string" ? source.windowTitle.trim() : source.name.trim();
			if (!windowTitle) {
				throw new Error("Missing window title for FFmpeg window capture");
			}

			return [
				"-y",
				"-f",
				"gdigrab",
				"-framerate",
				"60",
				"-draw_mouse",
				"0",
				"-i",
				`title=${windowTitle}`,
				...commonOutputArgs,
			];
		}

		return [
			"-y",
			"-f",
			"gdigrab",
			"-framerate",
			"60",
			"-draw_mouse",
			"0",
			"-i",
			"desktop",
			...commonOutputArgs,
		];
	}

	if (process.platform === "linux") {
		const displayEnv = process.env.DISPLAY || ":0.0";
		if (source?.id?.startsWith("window:")) {
			const bounds = await resolveLinuxWindowBounds(source);
			if (!bounds) {
				throw new Error("Unable to resolve Linux window bounds for FFmpeg capture");
			}

			return [
				"-y",
				"-f",
				"x11grab",
				"-framerate",
				"60",
				"-draw_mouse",
				"0",
				"-video_size",
				`${Math.max(2, bounds.width)}x${Math.max(2, bounds.height)}`,
				"-i",
				`${displayEnv}+${Math.round(bounds.x)},${Math.round(bounds.y)}`,
				...commonOutputArgs,
			];
		}

		const bounds = getDisplayBoundsForSource(source);
		return [
			"-y",
			"-f",
			"x11grab",
			"-framerate",
			"60",
			"-draw_mouse",
			"0",
			"-video_size",
			`${Math.max(2, bounds.width)}x${Math.max(2, bounds.height)}`,
			"-i",
			`${displayEnv}+${Math.round(bounds.x)},${Math.round(bounds.y)}`,
			...commonOutputArgs,
		];
	}

	if (process.platform === "darwin") {
		return [
			"-y",
			"-f",
			"avfoundation",
			"-capture_cursor",
			"0",
			"-framerate",
			"60",
			"-i",
			"1:none",
			...commonOutputArgs,
		];
	}

	throw new Error(`FFmpeg capture is not supported on ${process.platform}`);
}

function getWgcCaptureExePath() {
	return resolveUnpackedAppPath(
		"electron",
		"native",
		"wgc-capture",
		"build",
		"Release",
		"wgc-capture.exe",
	);
}

function getCursorMonitorExePath() {
	return resolveUnpackedAppPath(
		"electron",
		"native",
		"cursor-monitor",
		"build",
		"Release",
		"cursor-monitor.exe",
	);
}

async function isWgcCaptureAvailable(): Promise<boolean> {
	if (process.platform !== "win32") return false;

	try {
		await fs.access(getWgcCaptureExePath(), fsConstants.X_OK);
	} catch {
		return false;
	}

	// Windows 10 2004 (Build 19041) minimum for IsCursorCaptureEnabled
	const os = await import("node:os");
	const [major, , build] = os.release().split(".").map(Number);
	return major >= 10 && build >= 19041;
}

function waitForWgcCaptureStart(proc: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for WGC capture to start"));
		}, 12000);

		const onStdout = (chunk: Buffer) => {
			const text = chunk.toString();
			if (text.includes("Recording started")) {
				cleanup();
				resolve();
			}
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					wgcCaptureOutputBuffer.trim() ||
						`WGC capture exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const cleanup = () => {
			clearTimeout(timer);
			proc.stdout.off("data", onStdout);
			proc.off("error", onError);
			proc.off("exit", onExit);
		};

		proc.stdout.on("data", onStdout);
		proc.once("error", onError);
		proc.once("exit", onExit);
	});
}

function waitForWgcCaptureStop(proc: ChildProcessWithoutNullStreams) {
	return new Promise<string>((resolve, reject) => {
		const onClose = (code: number | null) => {
			cleanup();
			const match = wgcCaptureOutputBuffer.match(/Recording stopped\. Output path: (.+)/);
			if (match?.[1]) {
				resolve(match[1].trim());
				return;
			}
			if (code === 0 && wgcCaptureTargetPath) {
				resolve(wgcCaptureTargetPath);
				return;
			}
			reject(
				new Error(
					wgcCaptureOutputBuffer.trim() || `WGC capture exited with code ${code ?? "unknown"}`,
				),
			);
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const cleanup = () => {
			proc.off("close", onClose);
			proc.off("error", onError);
		};

		proc.once("close", onClose);
		proc.once("error", onError);
	});
}

function attachWgcCaptureLifecycle(proc: ChildProcessWithoutNullStreams) {
	proc.once("close", () => {
		const wasActive = wgcScreenRecordingActive;
		wgcCaptureProcess = null;

		if (!wasActive || wgcCaptureStopRequested) {
			return;
		}

		wgcScreenRecordingActive = false;
		wgcCaptureTargetPath = null;
		wgcCaptureStopRequested = false;

		const sourceName = selectedSource?.name ?? "Screen";
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording: false,
					sourceName,
				});
			}
		});

		emitRecordingInterrupted("capture-stopped", "Recording stopped unexpectedly.");
	});
}

async function muxWgcVideoWithAudio(
	videoPath: string,
	systemAudioPath: string | null,
	micAudioPath: string | null,
) {
	const ffmpegPath = getFfmpegBinaryPath();
	const inputs: string[] = ["-i", videoPath];
	const audioInputs: string[] = [];

	if (systemAudioPath) {
		try {
			await fs.access(systemAudioPath);
			inputs.push("-i", systemAudioPath);
			audioInputs.push("system");
		} catch {
			// system audio file not available
		}
	}

	if (micAudioPath) {
		try {
			await fs.access(micAudioPath);
			inputs.push("-i", micAudioPath);
			audioInputs.push("mic");
		} catch {
			// mic audio file not available
		}
	}

	if (audioInputs.length === 0) return;

	const mixedOutputPath = `${videoPath}.muxed.mp4`;

	if (audioInputs.length === 2) {
		// Both system + mic audio: mix them
		await execFileAsync(
			ffmpegPath,
			[
				"-y",
				...inputs,
				"-filter_complex",
				"[2:a]atrim=start=0.10,asetpts=PTS-STARTPTS[m];[1:a][m]amix=inputs=2:duration=longest:normalize=0[aout]",
				"-map",
				"0:v:0",
				"-map",
				"[aout]",
				"-c:v",
				"copy",
				"-c:a",
				"aac",
				"-b:a",
				"192k",
				"-shortest",
				mixedOutputPath,
			],
			{ timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
		);
	} else {
		// Single audio track
		await execFileAsync(
			ffmpegPath,
			[
				"-y",
				...inputs,
				"-map",
				"0:v:0",
				"-map",
				"1:a:0",
				"-c:v",
				"copy",
				"-c:a",
				"aac",
				"-b:a",
				"192k",
				"-shortest",
				mixedOutputPath,
			],
			{ timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
		);
	}

	try {
		await moveFileWithOverwrite(mixedOutputPath, videoPath);
	} catch (moveError) {
		await fs.rm(mixedOutputPath, { force: true }).catch(() => {});
		throw moveError;
	}

	// Clean up audio files
	for (const audioPath of [systemAudioPath, micAudioPath]) {
		if (audioPath) {
			await fs.rm(audioPath, { force: true }).catch(() => {});
		}
	}
}

function waitForNativeCaptureStart(process: ChildProcessWithoutNullStreams) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Timed out waiting for ScreenCaptureKit recorder to start"));
		}, 12000);

		// Only check for the start pattern — the start handler already
		// appends stdout/stderr to nativeCaptureOutputBuffer
		const onStdout = (chunk: Buffer) => {
			const text = chunk.toString();
			if (text.includes("Recording started")) {
				cleanup();
				resolve();
			}
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const onExit = (code: number | null) => {
			cleanup();
			reject(
				new Error(
					nativeCaptureOutputBuffer.trim() ||
						`Native capture helper exited before recording started (code ${code ?? "unknown"})`,
				),
			);
		};

		const cleanup = () => {
			clearTimeout(timer);
			process.stdout.off("data", onStdout);
			process.off("error", onError);
			process.off("exit", onExit);
		};

		process.stdout.on("data", onStdout);
		process.once("error", onError);
		process.once("exit", onExit);
	});
}

function waitForNativeCaptureStop(process: ChildProcessWithoutNullStreams) {
	return new Promise<string>((resolve, reject) => {
		const onClose = (code: number | null) => {
			cleanup();
			const match = nativeCaptureOutputBuffer.match(/Recording stopped\. Output path: (.+)/);
			if (match?.[1]) {
				resolve(match[1].trim());
				return;
			}
			// Fallback: if exit code was 0 and we know the target path, try to use it
			if (code === 0 && nativeCaptureTargetPath) {
				resolve(nativeCaptureTargetPath);
				return;
			}
			reject(
				new Error(
					nativeCaptureOutputBuffer.trim() ||
						`Native capture helper exited with code ${code ?? "unknown"}`,
				),
			);
		};

		const onError = (error: Error) => {
			cleanup();
			reject(error);
		};

		const cleanup = () => {
			process.off("close", onClose);
			process.off("error", onError);
		};

		process.once("close", onClose);
		process.once("error", onError);
	});
}

async function mixNativeMacAudioTracks(videoPath: string, microphonePath: string) {
	const ffmpegPath = getFfmpegBinaryPath();
	const mixedOutputPath = `${videoPath}.mixed.mp4`;

	await execFileAsync(
		ffmpegPath,
		[
			"-y",
			"-i",
			videoPath,
			"-i",
			microphonePath,
			"-filter_complex",
			"[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[aout]",
			"-map",
			"0:v:0",
			"-map",
			"[aout]",
			"-c:v",
			"copy",
			"-c:a",
			"aac",
			"-b:a",
			"192k",
			"-shortest",
			mixedOutputPath,
		],
		{ timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
	);

	await moveFileWithOverwrite(mixedOutputPath, videoPath);
	await fs.rm(microphonePath, { force: true });
}

function emitRecordingInterrupted(reason: string, message: string) {
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("recording-interrupted", { reason, message });
		}
	});
}

function emitCursorStateChanged(cursorType: CursorVisualType) {
	BrowserWindow.getAllWindows().forEach((window) => {
		if (!window.isDestroyed()) {
			window.webContents.send("cursor-state-changed", { cursorType });
		}
	});
}

function sampleCursorStateChange(cursorType: CursorVisualType) {
	if (!isCursorCaptureActive) {
		return;
	}

	const point = getNormalizedCursorPoint();
	if (!point) {
		return;
	}

	pushCursorSample(point.cx, point.cy, Date.now() - cursorCaptureStartTimeMs, "move", cursorType);
}

function attachNativeCaptureLifecycle(process: ChildProcessWithoutNullStreams) {
	process.once("close", () => {
		const wasActive = nativeScreenRecordingActive;
		nativeCaptureProcess = null;

		if (!wasActive || nativeCaptureStopRequested) {
			return;
		}

		nativeScreenRecordingActive = false;
		nativeCaptureTargetPath = null;
		nativeCaptureStopRequested = false;

		const sourceName = selectedSource?.name ?? "Screen";
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording: false,
					sourceName,
				});
			}
		});

		const reason = nativeCaptureOutputBuffer.includes("WINDOW_UNAVAILABLE")
			? "window-unavailable"
			: "capture-stopped";
		const message =
			reason === "window-unavailable"
				? "The selected window is no longer capturable. Please reselect a window."
				: "Recording stopped unexpectedly.";

		emitRecordingInterrupted(reason, message);
	});
}

async function ensureNativeCursorMonitorBinary() {
	return ensureSwiftHelperBinary(
		getNativeCursorMonitorSourcePath(),
		getNativeCursorMonitorBinaryPath(),
		"native cursor monitor helper",
		"klipt-native-cursor-monitor",
	);
}

function handleCursorMonitorStdout(chunk: Buffer) {
	nativeCursorMonitorOutputBuffer += chunk.toString();
	const lines = nativeCursorMonitorOutputBuffer.split(/\r?\n/);
	nativeCursorMonitorOutputBuffer = lines.pop() ?? "";

	for (const line of lines) {
		const match = line.match(/^STATE:(.+)$/);
		if (!match) continue;
		const next = match[1].trim() as CursorVisualType;
		if (
			next === "arrow" ||
			next === "text" ||
			next === "pointer" ||
			next === "crosshair" ||
			next === "open-hand" ||
			next === "closed-hand" ||
			next === "resize-ew" ||
			next === "resize-ns" ||
			next === "not-allowed"
		) {
			if (currentCursorVisualType !== next) {
				currentCursorVisualType = next;
				sampleCursorStateChange(next);
				emitCursorStateChanged(next);
			}
		}
	}
}

async function startNativeCursorMonitor() {
	stopNativeCursorMonitor();

	if (process.platform !== "darwin" && process.platform !== "win32") {
		currentCursorVisualType = "arrow";
		return;
	}

	try {
		let helperPath: string;
		if (process.platform === "win32") {
			helperPath = getCursorMonitorExePath();
			try {
				await fs.access(helperPath, fsConstants.X_OK);
			} catch {
				console.warn("Windows cursor monitor helper missing or not executable:", helperPath);
				currentCursorVisualType = "arrow";
				return;
			}
		} else {
			helperPath = await ensureNativeCursorMonitorBinary();
		}

		nativeCursorMonitorOutputBuffer = "";
		currentCursorVisualType = "arrow";
		nativeCursorMonitorProcess = spawn(helperPath, [], {
			stdio: ["pipe", "pipe", "pipe"],
		});

		nativeCursorMonitorProcess.once("error", (error) => {
			console.warn("Native cursor monitor process error:", error);
			nativeCursorMonitorProcess = null;
			nativeCursorMonitorOutputBuffer = "";
			currentCursorVisualType = "arrow";
		});

		nativeCursorMonitorProcess.stdout.on("data", handleCursorMonitorStdout);

		nativeCursorMonitorProcess.once("close", () => {
			nativeCursorMonitorProcess = null;
			nativeCursorMonitorOutputBuffer = "";
			currentCursorVisualType = "arrow";
		});
	} catch (error) {
		console.warn("Failed to start native cursor monitor:", error);
		nativeCursorMonitorProcess = null;
		nativeCursorMonitorOutputBuffer = "";
		currentCursorVisualType = "arrow";
	}
}

function stopNativeCursorMonitor() {
	currentCursorVisualType = "arrow";

	if (!nativeCursorMonitorProcess) {
		return;
	}

	try {
		nativeCursorMonitorProcess.stdin.write("stop\n");
	} catch {
		// ignore stop signal issues
	}
	const proc = nativeCursorMonitorProcess;
	nativeCursorMonitorProcess = null;
	nativeCursorMonitorOutputBuffer = "";

	try {
		proc.kill("SIGTERM");
	} catch {
		// ignore kill issues
	}

	const killTimeout = setTimeout(() => {
		try {
			if (!proc.killed) {
				proc.kill("SIGKILL");
			}
		} catch {
			// ignore kill issues
		}
	}, 3000);

	proc.once("exit", () => {
		clearTimeout(killTimeout);
	});
}

async function moveFileWithOverwrite(sourcePath: string, destinationPath: string) {
	await fs.mkdir(path.dirname(destinationPath), { recursive: true });
	await fs.rm(destinationPath, { force: true });

	try {
		await fs.rename(sourcePath, destinationPath);
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code !== "EXDEV") {
			throw error;
		}

		await fs.copyFile(sourcePath, destinationPath);
		await fs.unlink(sourcePath);
	}
}

function isTrustedProjectPath(filePath?: string | null) {
	if (!filePath || !currentProjectPath) {
		return false;
	}
	return normalizePath(filePath) === normalizePath(currentProjectPath);
}

const CURSOR_TELEMETRY_VERSION = 2;
const CURSOR_SAMPLE_INTERVAL_MS = 33;
const MAX_CURSOR_SAMPLES = 60 * 60 * 30; // 1 hour @ 30Hz

type CursorInteractionType =
	| "move"
	| "click"
	| "double-click"
	| "right-click"
	| "middle-click"
	| "mouseup";

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
	interactionType?: CursorInteractionType;
	cursorType?: CursorVisualType;
}

let cursorCaptureInterval: NodeJS.Timeout | null = null;
let cursorCaptureStartTimeMs = 0;
let activeCursorSamples: CursorTelemetryPoint[] = [];
let pendingCursorSamples: CursorTelemetryPoint[] = [];
let isCursorCaptureActive = false;
let interactionCaptureCleanup: (() => void) | null = null;
let hasLoggedInteractionHookFailure = false;
let lastLeftClick: { timeMs: number; cx: number; cy: number } | null = null;
let linuxCursorScreenPoint: { x: number; y: number; updatedAt: number } | null = null;
let selectedWindowBounds: WindowBounds | null = null;
let windowBoundsCaptureInterval: NodeJS.Timeout | null = null;

function normalizeHookMouseButton(rawButton: unknown): 1 | 2 | 3 {
	if (typeof rawButton !== "number" || !Number.isFinite(rawButton)) {
		return 1;
	}

	// uiohook/libuiohook button codes are typically 1/2/3. Some wrappers may
	// expose alternate constants depending on platform/runtime.
	if (rawButton === 2 || rawButton === 39) {
		return 2;
	}

	if (rawButton === 3 || rawButton === 38) {
		return 3;
	}

	return 1;
}

function getHookMouseButton(event: any): 1 | 2 | 3 {
	return normalizeHookMouseButton(
		event?.button ?? event?.mouseButton ?? event?.data?.button ?? event?.data?.mouseButton,
	);
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function stopCursorCapture() {
	if (cursorCaptureInterval) {
		clearInterval(cursorCaptureInterval);
		cursorCaptureInterval = null;
	}
}

function stopInteractionCapture() {
	if (interactionCaptureCleanup) {
		interactionCaptureCleanup();
		interactionCaptureCleanup = null;
	}
}

function stopWindowBoundsCapture() {
	if (windowBoundsCaptureInterval) {
		clearInterval(windowBoundsCaptureInterval);
		windowBoundsCaptureInterval = null;
	}
	selectedWindowBounds = null;
}

function getWindowBoundsFromNativeSource(
	source?: NativeMacWindowSource | null,
): WindowBounds | null {
	if (!source) {
		return null;
	}

	const { x, y, width, height } = source;
	if (
		typeof x !== "number" ||
		!Number.isFinite(x) ||
		typeof y !== "number" ||
		!Number.isFinite(y) ||
		typeof width !== "number" ||
		!Number.isFinite(width) ||
		typeof height !== "number" ||
		!Number.isFinite(height)
	) {
		return null;
	}

	if (width <= 0 || height <= 0) {
		return null;
	}

	return { x, y, width, height };
}

async function resolveMacWindowBounds(source: SelectedSource): Promise<WindowBounds | null> {
	const windowId = parseWindowId(source.id);
	if (!windowId) {
		return null;
	}

	try {
		const nativeSources = await getNativeMacWindowSources({ maxAgeMs: 250 });
		const matchedSource = nativeSources.find((entry) => parseWindowId(entry.id) === windowId);
		return getWindowBoundsFromNativeSource(matchedSource);
	} catch {
		return null;
	}
}

async function refreshSelectedWindowBounds() {
	if (!selectedSource?.id?.startsWith("window:")) {
		selectedWindowBounds = null;
		return;
	}

	let bounds: WindowBounds | null = null;

	if (process.platform === "darwin") {
		bounds = await resolveMacWindowBounds(selectedSource);
	} else if (process.platform === "linux") {
		bounds = await resolveLinuxWindowBounds(selectedSource);
	}

	selectedWindowBounds = bounds;
}

function startWindowBoundsCapture() {
	stopWindowBoundsCapture();

	if (
		!["darwin", "linux"].includes(process.platform) ||
		!selectedSource?.id?.startsWith("window:")
	) {
		return;
	}

	void refreshSelectedWindowBounds();
	windowBoundsCaptureInterval = setInterval(() => {
		if (!isCursorCaptureActive) {
			stopWindowBoundsCapture();
			return;
		}
		void refreshSelectedWindowBounds();
	}, 250);
}

function getNormalizedCursorPoint() {
	const fallbackCursor = getScreen().getCursorScreenPoint();
	const linuxCursorCache = process.platform === "linux" ? linuxCursorScreenPoint : null;
	const isLinuxCacheFresh = !!linuxCursorCache && Date.now() - linuxCursorCache.updatedAt <= 1000;

	const cursor = isLinuxCacheFresh
		? { x: linuxCursorCache.x, y: linuxCursorCache.y }
		: fallbackCursor;

	const windowBounds = selectedSource?.id?.startsWith("window:") ? selectedWindowBounds : null;
	if (windowBounds) {
		const width = Math.max(1, windowBounds.width);
		const height = Math.max(1, windowBounds.height);

		return {
			cx: clamp((cursor.x - windowBounds.x) / width, 0, 1),
			cy: clamp((cursor.y - windowBounds.y) / height, 0, 1),
		};
	}

	const sourceDisplayId = Number(selectedSource?.display_id);
	const sourceDisplay = Number.isFinite(sourceDisplayId)
		? (getScreen()
				.getAllDisplays()
				.find((display) => display.id === sourceDisplayId) ?? null)
		: null;
	const display = sourceDisplay ?? getScreen().getDisplayNearestPoint(cursor);
	const bounds = display.bounds;
	const width = Math.max(1, bounds.width);
	const height = Math.max(1, bounds.height);

	const cx = clamp((cursor.x - bounds.x) / width, 0, 1);
	const cy = clamp((cursor.y - bounds.y) / height, 0, 1);
	return { cx, cy };
}

function getHookCursorScreenPoint(event: any): { x: number; y: number } | null {
	const rawX = event?.x ?? event?.data?.x ?? event?.screenX ?? event?.data?.screenX;
	const rawY = event?.y ?? event?.data?.y ?? event?.screenY ?? event?.data?.screenY;

	if (
		typeof rawX !== "number" ||
		!Number.isFinite(rawX) ||
		typeof rawY !== "number" ||
		!Number.isFinite(rawY)
	) {
		return null;
	}

	return { x: rawX, y: rawY };
}

function pushCursorSample(
	cx: number,
	cy: number,
	timeMs: number,
	interactionType: CursorInteractionType = "move",
	cursorType?: CursorVisualType,
) {
	activeCursorSamples.push({
		timeMs: Math.max(0, timeMs),
		cx,
		cy,
		interactionType,
		cursorType: cursorType ?? currentCursorVisualType,
	});

	if (activeCursorSamples.length > MAX_CURSOR_SAMPLES) {
		activeCursorSamples.shift();
	}
}

function sampleCursorPoint() {
	const point = getNormalizedCursorPoint();
	if (!point) {
		return;
	}

	pushCursorSample(point.cx, point.cy, Date.now() - cursorCaptureStartTimeMs, "move");
}

async function persistPendingCursorTelemetry(videoPath: string) {
	const telemetryPath = getTelemetryPathForVideo(videoPath);
	if (pendingCursorSamples.length > 0) {
		await fs.writeFile(
			telemetryPath,
			JSON.stringify({ version: CURSOR_TELEMETRY_VERSION, samples: pendingCursorSamples }, null, 2),
			"utf-8",
		);
	}
	pendingCursorSamples = [];
}

function snapshotCursorTelemetryForPersistence() {
	if (activeCursorSamples.length === 0) {
		return;
	}

	if (pendingCursorSamples.length === 0) {
		pendingCursorSamples = [...activeCursorSamples];
		return;
	}

	const lastPendingTimeMs = pendingCursorSamples[pendingCursorSamples.length - 1]?.timeMs ?? -1;
	const newSamples = activeCursorSamples.filter((sample) => sample.timeMs > lastPendingTimeMs);
	pendingCursorSamples = [...pendingCursorSamples, ...newSamples];
	if (pendingCursorSamples.length > MAX_CURSOR_SAMPLES) {
		pendingCursorSamples = pendingCursorSamples.slice(
			pendingCursorSamples.length - MAX_CURSOR_SAMPLES,
		);
	}
}

async function finalizeStoredVideo(videoPath: string) {
	snapshotCursorTelemetryForPersistence();
	currentVideoPath = videoPath;
	currentProjectPath = null;
	await persistPendingCursorTelemetry(videoPath);
	if (isAutoRecordingPath(videoPath)) {
		await pruneAutoRecordings([videoPath]);
	}

	return {
		success: true,
		path: videoPath,
		message: "Video stored successfully",
	};
}

async function startInteractionCapture() {
	if (!isCursorCaptureActive) {
		return;
	}

	if (!["darwin", "win32", "linux"].includes(process.platform)) {
		return;
	}

	try {
		const hook = loadUiohookModule();
		console.log(
			"[CursorTelemetry] hook loaded:",
			!!hook,
			"has.on:",
			typeof hook?.on,
			"has.start:",
			typeof hook?.start,
		);
		if (!isCursorCaptureActive) {
			return;
		}

		if (!hook || typeof hook.on !== "function" || typeof hook.start !== "function") {
			console.log("[CursorTelemetry] hook unusable — aborting interaction capture");
			return;
		}

		const onMouseDown = (event: any) => {
			if (!isCursorCaptureActive) {
				return;
			}

			const point = getNormalizedCursorPoint();
			if (!point) {
				return;
			}

			const timeMs = Date.now() - cursorCaptureStartTimeMs;
			const button = getHookMouseButton(event);
			let interactionType: CursorInteractionType = "click";

			if (button === 2) {
				interactionType = "right-click";
			} else if (button === 3) {
				interactionType = "middle-click";
			} else {
				const thresholdMs = 350;
				const distance = lastLeftClick
					? Math.hypot(point.cx - lastLeftClick.cx, point.cy - lastLeftClick.cy)
					: Number.POSITIVE_INFINITY;

				if (lastLeftClick && timeMs - lastLeftClick.timeMs <= thresholdMs && distance <= 0.04) {
					interactionType = "double-click";
				}

				lastLeftClick = { timeMs, cx: point.cx, cy: point.cy };
			}

			pushCursorSample(point.cx, point.cy, timeMs, interactionType);
		};

		const onMouseUp = (_event: any) => {
			if (!isCursorCaptureActive) {
				return;
			}

			const point = getNormalizedCursorPoint();
			if (!point) {
				return;
			}

			const timeMs = Date.now() - cursorCaptureStartTimeMs;
			pushCursorSample(point.cx, point.cy, timeMs, "mouseup");
		};

		const onMouseMove = (event: any) => {
			if (process.platform !== "linux" || !isCursorCaptureActive) {
				return;
			}

			const point = getHookCursorScreenPoint(event);
			if (!point) {
				return;
			}

			linuxCursorScreenPoint = { x: point.x, y: point.y, updatedAt: Date.now() };
		};

		hook.on("mousedown", onMouseDown);
		hook.on("mouseup", onMouseUp);
		hook.on("mousemove", onMouseMove);

		try {
			hook.start();
		} catch (err) {
			try {
				if (typeof hook.off === "function") {
					hook.off("mousedown", onMouseDown);
					hook.off("mouseup", onMouseUp);
					hook.off("mousemove", onMouseMove);
				} else if (typeof hook.removeListener === "function") {
					hook.removeListener("mousedown", onMouseDown);
					hook.removeListener("mouseup", onMouseUp);
					hook.removeListener("mousemove", onMouseMove);
				}
			} catch {
				// ignore listener cleanup errors
			}
			throw err;
		}

		interactionCaptureCleanup = () => {
			try {
				if (typeof hook.off === "function") {
					hook.off("mousedown", onMouseDown);
					hook.off("mouseup", onMouseUp);
					hook.off("mousemove", onMouseMove);
				} else if (typeof hook.removeListener === "function") {
					hook.removeListener("mousedown", onMouseDown);
					hook.removeListener("mouseup", onMouseUp);
					hook.removeListener("mousemove", onMouseMove);
				}
			} catch {
				// ignore listener cleanup errors
			}

			try {
				if (typeof hook.stop === "function") {
					hook.stop();
				}
			} catch {
				// ignore hook shutdown errors
			}
		};
	} catch (error) {
		if (!hasLoggedInteractionHookFailure) {
			hasLoggedInteractionHookFailure = true;
			console.warn("[CursorTelemetry] Global interaction capture unavailable:", error);
		}
	}
}

export function registerIpcHandlers(
	createEditorWindow: () => void,
	createHudOverlayWindow: () => void,
	createSourceSelectorWindow: () => BrowserWindow,
	getMainWindow: () => BrowserWindow | null,
	getSourceSelectorWindow: () => BrowserWindow | null,
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
) {
	ipcMain.handle("get-sources", async (_, opts) => {
		const includeScreens = Array.isArray(opts?.types) ? opts.types.includes("screen") : true;
		const includeWindows = Array.isArray(opts?.types) ? opts.types.includes("window") : true;
		const electronTypes = [
			...(includeScreens ? ["screen" as const] : []),
			...(includeWindows ? ["window" as const] : []),
		];
		const electronSources =
			electronTypes.length > 0
				? await desktopCapturer.getSources({
						...opts,
						types: electronTypes,
					})
				: [];
		const ownWindowNames = new Set(
			[
				app.getName(),
				"klipt",
				...BrowserWindow.getAllWindows().flatMap((win) => {
					const title = win.getTitle().trim();
					return title ? [title] : [];
				}),
			]
				.map((name) => normalizeDesktopSourceName(name))
				.filter(Boolean),
		);
		const ownAppName = normalizeDesktopSourceName(app.getName());

		const screenSources = electronSources
			.filter((source) => source.id.startsWith("screen:"))
			.map((source) => ({
				id: source.id,
				name: source.name,
				display_id: source.display_id,
				thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
				appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
			}));

		if (process.platform !== "darwin" || !includeWindows) {
			const windowSources = electronSources
				.filter((source) => source.id.startsWith("window:"))
				.filter((source) => hasUsableSourceThumbnail(source.thumbnail))
				.filter((source) => {
					const normalizedName = normalizeDesktopSourceName(source.name);
					if (!normalizedName) {
						return true;
					}

					if (ALLOW_KLIPT_WINDOW_CAPTURE && normalizedName.includes("klipt")) {
						return true;
					}

					for (const ownName of ownWindowNames) {
						if (!ownName) continue;
						if (normalizedName === ownName) {
							return false;
						}
					}

					return true;
				})
				.map((source) => ({
					id: source.id,
					name: source.name,
					display_id: source.display_id,
					thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
					appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
				}));

			return [...screenSources, ...windowSources];
		}

		try {
			const nativeWindowSources = await getNativeMacWindowSources();
			const electronWindowSourceMap = new Map(
				electronSources
					.filter((source) => source.id.startsWith("window:"))
					.map((source) => [source.id, source] as const),
			);

			const mergedWindowSources = nativeWindowSources
				.filter((source) => {
					const normalizedWindowName = normalizeDesktopSourceName(
						source.windowTitle ?? source.name,
					);
					const normalizedAppName = normalizeDesktopSourceName(source.appName ?? "");

					if (
						!ALLOW_KLIPT_WINDOW_CAPTURE &&
						normalizedAppName &&
						normalizedAppName === ownAppName
					) {
						return false;
					}

					if (
						ALLOW_KLIPT_WINDOW_CAPTURE &&
						(normalizedAppName === "klipt" || normalizedWindowName?.includes("klipt"))
					) {
						return true;
					}

					if (!normalizedWindowName) {
						return true;
					}

					for (const ownName of ownWindowNames) {
						if (!ownName) continue;
						if (normalizedWindowName === ownName) {
							return false;
						}
					}

					return true;
				})
				.map((source) => {
					const electronWindowSource = electronWindowSourceMap.get(source.id);
					return {
						id: source.id,
						name: source.name,
						display_id: source.display_id ?? electronWindowSource?.display_id ?? "",
						thumbnail: electronWindowSource?.thumbnail
							? electronWindowSource.thumbnail.toDataURL()
							: null,
						appIcon:
							source.appIcon ??
							(electronWindowSource?.appIcon ? electronWindowSource.appIcon.toDataURL() : null),
						appName: source.appName,
						windowTitle: source.windowTitle,
					};
				})
				// Equivalent to hasUsableSourceThumbnail — at this point thumbnails are already
				// converted to data URL strings (null when NativeImage was empty/missing).
				.filter((source) => Boolean(source.thumbnail));

			return [...screenSources, ...mergedWindowSources];
		} catch (error) {
			console.warn("Falling back to Electron window enumeration on macOS:", error);

			const windowSources = electronSources
				.filter((source) => source.id.startsWith("window:"))
				.filter((source) => hasUsableSourceThumbnail(source.thumbnail))
				.filter((source) => {
					const normalizedName = normalizeDesktopSourceName(source.name);
					if (!normalizedName) {
						return true;
					}

					if (ALLOW_KLIPT_WINDOW_CAPTURE && normalizedName.includes("klipt")) {
						return true;
					}

					for (const ownName of ownWindowNames) {
						if (!ownName) continue;
						if (
							normalizedName === ownName ||
							normalizedName.includes(ownName) ||
							ownName.includes(normalizedName)
						) {
							return false;
						}
					}

					return true;
				})
				.map((source) => ({
					id: source.id,
					name: source.name,
					display_id: source.display_id,
					thumbnail: source.thumbnail ? source.thumbnail.toDataURL() : null,
					appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
				}));

			return [...screenSources, ...windowSources];
		}
	});

	ipcMain.handle("select-source", (_, source: SelectedSource) => {
		selectedSource = source;
		stopWindowBoundsCapture();
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.close();
		}
		return selectedSource;
	});

	ipcMain.handle("get-selected-source", () => {
		return selectedSource;
	});

	ipcMain.handle("open-source-selector", () => {
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.focus();
			return;
		}
		createSourceSelectorWindow();
	});

	ipcMain.handle("open-hud-overlay", () => {
		// The wrapper already closes the current mainWindow (home) before
		// creating the HUD overlay, so no extra close is needed here.
		createHudOverlayWindow();
		return { success: true };
	});

	ipcMain.handle("switch-to-editor", () => {
		// The wrapper already closes the current mainWindow (home) before
		// creating the editor window, so no extra close is needed here.
		createEditorWindow();
		return { success: true };
	});

	ipcMain.handle(
		"start-native-screen-recording",
		async (_, source: SelectedSource, options?: NativeMacRecordingOptions) => {
			// Windows WGC path
			if (process.platform === "win32") {
				const wgcAvailable = await isWgcCaptureAvailable();
				if (!wgcAvailable) {
					return { success: false, message: "WGC capture is not available on this system." };
				}

				if (wgcCaptureProcess && !wgcScreenRecordingActive) {
					try {
						wgcCaptureProcess.kill();
					} catch {
						/* ignore */
					}
					wgcCaptureProcess = null;
					wgcCaptureTargetPath = null;
					wgcCaptureStopRequested = false;
				}

				if (wgcCaptureProcess) {
					return { success: false, message: "A WGC screen recording is already active." };
				}

				try {
					const exePath = getWgcCaptureExePath();
					const recordingsDir = await getRecordingsDir();
					const timestamp = Date.now();
					const outputPath = path.join(recordingsDir, `recording-${timestamp}.mp4`);

					const config: Record<string, unknown> = {
						outputPath,
						fps: 60,
					};

					if (options?.capturesSystemAudio) {
						const audioPath = path.join(recordingsDir, `recording-${timestamp}.system.wav`);
						config.captureSystemAudio = true;
						config.audioOutputPath = audioPath;
						wgcSystemAudioPath = audioPath;
					}

					if (options?.capturesMicrophone) {
						const micPath = path.join(recordingsDir, `recording-${timestamp}.mic.wav`);
						config.captureMic = true;
						config.micOutputPath = micPath;
						if (options.microphoneLabel) {
							config.micDeviceName = options.microphoneLabel;
						}
						wgcMicAudioPath = micPath;
					}

					const windowId = parseWindowId(source?.id);
					if (windowId && source?.id?.startsWith("window:")) {
						config.windowHandle = windowId;
					} else {
						const screenId = Number(source?.display_id);
						config.displayId =
							Number.isFinite(screenId) && screenId > 0
								? screenId
								: Number(getScreen().getPrimaryDisplay().id);
					}

					wgcCaptureOutputBuffer = "";
					wgcCaptureTargetPath = outputPath;
					wgcCaptureStopRequested = false;
					wgcCaptureProcess = spawn(exePath, [JSON.stringify(config)], {
						cwd: recordingsDir,
						stdio: ["pipe", "pipe", "pipe"],
					});
					attachWgcCaptureLifecycle(wgcCaptureProcess);

					wgcCaptureProcess.stdout.on("data", (chunk: Buffer) => {
						wgcCaptureOutputBuffer += chunk.toString();
					});
					wgcCaptureProcess.stderr.on("data", (chunk: Buffer) => {
						wgcCaptureOutputBuffer += chunk.toString();
					});

					await waitForWgcCaptureStart(wgcCaptureProcess);
					wgcScreenRecordingActive = true;
					nativeScreenRecordingActive = true;
					return { success: true };
				} catch (error) {
					console.error("Failed to start WGC capture:", error);
					try {
						wgcCaptureProcess?.kill();
					} catch {
						/* ignore */
					}
					wgcScreenRecordingActive = false;
					nativeScreenRecordingActive = false;
					wgcCaptureProcess = null;
					wgcCaptureTargetPath = null;
					wgcCaptureStopRequested = false;
					return {
						success: false,
						message: "Failed to start WGC capture",
						error: String(error),
					};
				}
			}

			if (process.platform !== "darwin") {
				return { success: false, message: "Native screen recording is only available on macOS." };
			}

			if (nativeCaptureProcess && !nativeScreenRecordingActive) {
				try {
					nativeCaptureProcess.kill();
				} catch {
					// ignore stale helper cleanup failures
				}
				nativeCaptureProcess = null;
				nativeCaptureTargetPath = null;
				nativeCaptureStopRequested = false;
			}

			if (nativeCaptureProcess) {
				return { success: false, message: "A native screen recording is already active." };
			}

			try {
				const recordingsDir = await getRecordingsDir();
				const appName = normalizeDesktopSourceName(String(source?.appName ?? ""));
				const ownAppName = normalizeDesktopSourceName(app.getName());
				if (
					!ALLOW_KLIPT_WINDOW_CAPTURE &&
					source?.id?.startsWith("window:") &&
					appName &&
					(appName === ownAppName || appName === "klipt")
				) {
					return {
						success: false,
						message: "Cannot record klipt windows. Please select another app window.",
					};
				}

				const helperPath = await ensureNativeCaptureHelperBinary();
				const outputPath = path.join(recordingsDir, `recording-${Date.now()}.mp4`);
				const capturesSystemAudio = Boolean(options?.capturesSystemAudio);
				const capturesMicrophone = Boolean(options?.capturesMicrophone);
				const microphoneOutputPath =
					capturesSystemAudio && capturesMicrophone
						? path.join(recordingsDir, `recording-${Date.now()}.mic.m4a`)
						: null;
				const config: Record<string, unknown> = {
					fps: 60,
					outputPath,
					capturesSystemAudio,
					capturesMicrophone,
				};

				if (options?.microphoneDeviceId) {
					config.microphoneDeviceId = options.microphoneDeviceId;
				}

				if (microphoneOutputPath) {
					config.microphoneOutputPath = microphoneOutputPath;
				}

				const windowId = parseWindowId(source?.id);
				const screenId = Number(source?.display_id);

				if (Number.isFinite(windowId) && windowId && source?.id?.startsWith("window:")) {
					config.windowId = windowId;
				} else if (Number.isFinite(screenId) && screenId > 0) {
					config.displayId = screenId;
				} else {
					config.displayId = Number(getScreen().getPrimaryDisplay().id);
				}

				nativeCaptureOutputBuffer = "";
				nativeCaptureTargetPath = outputPath;
				nativeCaptureMicrophonePath = microphoneOutputPath;
				nativeCaptureStopRequested = false;
				nativeCaptureProcess = spawn(helperPath, [JSON.stringify(config)], {
					cwd: recordingsDir,
					stdio: ["pipe", "pipe", "pipe"],
				});
				attachNativeCaptureLifecycle(nativeCaptureProcess);

				nativeCaptureProcess.stdout.on("data", (chunk: Buffer) => {
					nativeCaptureOutputBuffer += chunk.toString();
				});
				nativeCaptureProcess.stderr.on("data", (chunk: Buffer) => {
					nativeCaptureOutputBuffer += chunk.toString();
				});

				await waitForNativeCaptureStart(nativeCaptureProcess);
				nativeScreenRecordingActive = true;
				return { success: true };
			} catch (error) {
				console.error("Failed to start native ScreenCaptureKit recording:", error);
				try {
					nativeCaptureProcess?.kill();
				} catch {
					// ignore cleanup failures
				}
				nativeScreenRecordingActive = false;
				nativeCaptureProcess = null;
				nativeCaptureTargetPath = null;
				nativeCaptureMicrophonePath = null;
				nativeCaptureStopRequested = false;
				return {
					success: false,
					message: "Failed to start native ScreenCaptureKit recording",
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle("stop-native-screen-recording", async () => {
		// Windows WGC stop path
		if (process.platform === "win32" && wgcScreenRecordingActive) {
			try {
				if (!wgcCaptureProcess) {
					throw new Error("WGC capture process is not running");
				}

				const proc = wgcCaptureProcess;
				const preferredVideoPath = wgcCaptureTargetPath;
				wgcCaptureStopRequested = true;
				proc.stdin.write("stop\n");
				const tempVideoPath = await waitForWgcCaptureStop(proc);
				wgcCaptureProcess = null;
				wgcScreenRecordingActive = false;
				nativeScreenRecordingActive = false;
				wgcCaptureTargetPath = null;
				wgcCaptureStopRequested = false;

				const finalVideoPath = preferredVideoPath ?? tempVideoPath;
				if (tempVideoPath !== finalVideoPath) {
					await moveFileWithOverwrite(tempVideoPath, finalVideoPath);
				}

				wgcPendingVideoPath = finalVideoPath;
				return { success: true, path: finalVideoPath };
			} catch (error) {
				console.error("Failed to stop WGC capture:", error);
				const fallbackPath = wgcCaptureTargetPath;
				wgcScreenRecordingActive = false;
				nativeScreenRecordingActive = false;
				wgcCaptureProcess = null;
				wgcCaptureTargetPath = null;
				wgcCaptureStopRequested = false;
				wgcSystemAudioPath = null;
				wgcMicAudioPath = null;
				wgcPendingVideoPath = null;

				if (fallbackPath) {
					try {
						await fs.access(fallbackPath);
						wgcPendingVideoPath = fallbackPath;
						return { success: true, path: fallbackPath };
					} catch {
						// File doesn't exist
					}
				}

				return {
					success: false,
					message: "Failed to stop WGC capture",
					error: String(error),
				};
			}
		}

		if (process.platform !== "darwin") {
			return { success: false, message: "Native screen recording is only available on macOS." };
		}

		if (!nativeScreenRecordingActive) {
			return { success: false, message: "No native screen recording is active." };
		}

		try {
			if (!nativeCaptureProcess) {
				throw new Error("Native capture helper process is not running");
			}

			const process = nativeCaptureProcess;
			const preferredVideoPath = nativeCaptureTargetPath;
			const preferredMicrophonePath = nativeCaptureMicrophonePath;
			nativeCaptureStopRequested = true;
			process.stdin.write("stop\n");
			const tempVideoPath = await waitForNativeCaptureStop(process);
			nativeCaptureProcess = null;
			nativeScreenRecordingActive = false;
			nativeCaptureTargetPath = null;
			nativeCaptureMicrophonePath = null;
			nativeCaptureStopRequested = false;

			const finalVideoPath = preferredVideoPath ?? tempVideoPath;
			if (tempVideoPath !== finalVideoPath) {
				await moveFileWithOverwrite(tempVideoPath, finalVideoPath);
			}

			if (preferredMicrophonePath) {
				try {
					await fs.access(preferredMicrophonePath);
					await mixNativeMacAudioTracks(finalVideoPath, preferredMicrophonePath);
				} catch (error) {
					console.warn("Failed to mix native macOS microphone audio into capture:", error);
				}
			}

			return await finalizeStoredVideo(finalVideoPath);
		} catch (error) {
			console.error("Failed to stop native ScreenCaptureKit recording:", error);
			const fallbackPath = nativeCaptureTargetPath;
			nativeScreenRecordingActive = false;
			nativeCaptureProcess = null;
			nativeCaptureTargetPath = null;
			nativeCaptureMicrophonePath = null;
			nativeCaptureStopRequested = false;

			// Try to recover: if the target file exists on disk, finalize with it
			if (fallbackPath) {
				try {
					await fs.access(fallbackPath);
					console.log(
						"[stop-native-screen-recording] Recovering with fallback path:",
						fallbackPath,
					);
					return await finalizeStoredVideo(fallbackPath);
				} catch {
					// File doesn't exist or isn't accessible
				}
			}

			return {
				success: false,
				message: "Failed to stop native ScreenCaptureKit recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-system-cursor-assets", async () => {
		try {
			return { success: true, cursors: await getSystemCursorAssets() };
		} catch (error) {
			console.error("Failed to load system cursor assets:", error);
			return { success: false, cursors: {}, error: String(error) };
		}
	});

	ipcMain.handle("is-wgc-available", async () => {
		return { available: await isWgcCaptureAvailable() };
	});

	ipcMain.handle("mux-wgc-recording", async () => {
		const videoPath = wgcPendingVideoPath;
		wgcPendingVideoPath = null;

		if (!videoPath) {
			return { success: false, message: "No WGC video pending for mux" };
		}

		try {
			if (wgcSystemAudioPath || wgcMicAudioPath) {
				await muxWgcVideoWithAudio(videoPath, wgcSystemAudioPath, wgcMicAudioPath);
				wgcSystemAudioPath = null;
				wgcMicAudioPath = null;
			}

			return await finalizeStoredVideo(videoPath);
		} catch (error) {
			console.error("Failed to mux WGC recording:", error);
			wgcSystemAudioPath = null;
			wgcMicAudioPath = null;
			try {
				return await finalizeStoredVideo(videoPath);
			} catch {
				return { success: false, message: "Failed to mux WGC recording", error: String(error) };
			}
		}
	});

	ipcMain.handle("start-ffmpeg-recording", async (_, source: SelectedSource) => {
		if (ffmpegCaptureProcess) {
			return { success: false, message: "An FFmpeg recording is already active." };
		}

		try {
			const recordingsDir = await getRecordingsDir();
			const ffmpegPath = getFfmpegBinaryPath();
			const outputPath = path.join(recordingsDir, `recording-${Date.now()}.mp4`);
			const args = await buildFfmpegCaptureArgs(source, outputPath);

			ffmpegCaptureOutputBuffer = "";
			ffmpegCaptureTargetPath = outputPath;
			ffmpegCaptureProcess = spawn(ffmpegPath, args, {
				cwd: recordingsDir,
				stdio: ["pipe", "pipe", "pipe"],
			});

			ffmpegCaptureProcess.stdout.on("data", (chunk: Buffer) => {
				ffmpegCaptureOutputBuffer += chunk.toString();
			});
			ffmpegCaptureProcess.stderr.on("data", (chunk: Buffer) => {
				ffmpegCaptureOutputBuffer += chunk.toString();
			});

			// Attach lifecycle handler so unexpected crashes clean up state and notify renderer
			ffmpegCaptureProcess.once("close", () => {
				const wasActive = ffmpegScreenRecordingActive;
				ffmpegCaptureProcess = null;

				if (!wasActive) {
					return;
				}

				ffmpegScreenRecordingActive = false;
				ffmpegCaptureTargetPath = null;
				emitRecordingInterrupted("ffmpeg_crash", "FFmpeg recording process exited unexpectedly.");
			});

			await waitForFfmpegCaptureStart(ffmpegCaptureProcess);
			ffmpegScreenRecordingActive = true;
			return { success: true };
		} catch (error) {
			console.error("Failed to start FFmpeg recording:", error);
			ffmpegScreenRecordingActive = false;
			ffmpegCaptureProcess = null;
			ffmpegCaptureTargetPath = null;
			return {
				success: false,
				message: "Failed to start FFmpeg recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("stop-ffmpeg-recording", async () => {
		if (!ffmpegScreenRecordingActive) {
			return { success: false, message: "No FFmpeg recording is active." };
		}

		try {
			if (!ffmpegCaptureProcess || !ffmpegCaptureTargetPath) {
				throw new Error("FFmpeg process is not running");
			}

			const process = ffmpegCaptureProcess;
			const outputPath = ffmpegCaptureTargetPath;
			process.stdin.write("q\n");
			const finalVideoPath = await waitForFfmpegCaptureStop(process, outputPath);

			ffmpegCaptureProcess = null;
			ffmpegCaptureTargetPath = null;
			ffmpegScreenRecordingActive = false;

			return await finalizeStoredVideo(finalVideoPath);
		} catch (error) {
			console.error("Failed to stop FFmpeg recording:", error);
			ffmpegCaptureProcess = null;
			ffmpegCaptureTargetPath = null;
			ffmpegScreenRecordingActive = false;
			return {
				success: false,
				message: "Failed to stop FFmpeg recording",
				error: String(error),
			};
		}
	});

	ipcMain.handle("store-recorded-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			const recordingsDir = await getRecordingsDir();
			await fs.mkdir(recordingsDir, { recursive: true });
			const videoPath = path.join(recordingsDir, fileName);
			await fs.writeFile(videoPath, Buffer.from(videoData));
			return await finalizeStoredVideo(videoPath);
		} catch (error) {
			console.error("Failed to store video:", error);
			return {
				success: false,
				message: "Failed to store video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("store-enhanced-audio", async (_, audioData: ArrayBuffer, fileName: string) => {
		try {
			const recordingsDir = await getRecordingsDir();
			await fs.mkdir(recordingsDir, { recursive: true });
			const audioPath = path.join(recordingsDir, fileName);
			await fs.writeFile(audioPath, Buffer.from(audioData));
			return { success: true, path: audioPath };
		} catch (error) {
			console.error("Failed to store enhanced audio:", error);
			return {
				success: false,
				message: "Failed to store enhanced audio",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-recorded-video-path", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const files = await fs.readdir(recordingsDir);
			const videoFiles = files.filter((file) => /\.(webm|mov|mp4)$/i.test(file));

			if (videoFiles.length === 0) {
				return { success: false, message: "No recorded video found" };
			}

			const latestVideo = videoFiles.sort().reverse()[0];
			const videoPath = path.join(recordingsDir, latestVideo);

			return { success: true, path: videoPath };
		} catch (error) {
			console.error("Failed to get video path:", error);
			return { success: false, message: "Failed to get video path", error: String(error) };
		}
	});

	ipcMain.handle("set-recording-state", (_, recording: boolean) => {
		if (recording) {
			stopCursorCapture();
			stopInteractionCapture();
			startWindowBoundsCapture();
			void startNativeCursorMonitor();
			isCursorCaptureActive = true;
			activeCursorSamples = [];
			pendingCursorSamples = [];
			cursorCaptureStartTimeMs = Date.now();
			linuxCursorScreenPoint = null;
			lastLeftClick = null;
			sampleCursorPoint();
			cursorCaptureInterval = setInterval(sampleCursorPoint, CURSOR_SAMPLE_INTERVAL_MS);
			void startInteractionCapture();
		} else {
			isCursorCaptureActive = false;
			stopCursorCapture();
			stopInteractionCapture();
			stopWindowBoundsCapture();
			stopNativeCursorMonitor();
			linuxCursorScreenPoint = null;
			snapshotCursorTelemetryForPersistence();
			activeCursorSamples = [];
		}

		const source = selectedSource || { name: "Screen" };
		BrowserWindow.getAllWindows().forEach((window) => {
			if (!window.isDestroyed()) {
				window.webContents.send("recording-state-changed", {
					recording,
					sourceName: source.name,
				});
			}
		});

		if (onRecordingStateChange) {
			onRecordingStateChange(recording, source.name);
		}
	});

	ipcMain.handle("set-ignore-mouse-events", (event, ignore: boolean) => {
		const win = BrowserWindow.fromWebContents(event.sender);
		if (win && !win.isDestroyed()) {
			if (ignore) {
				win.setIgnoreMouseEvents(true, { forward: true });
			} else {
				win.setIgnoreMouseEvents(false);
			}
		}
		return { success: true };
	});

	ipcMain.handle("set-cursor-scale", (_) => {
		// Store cursor scale for telemetry — currently a no-op since cursor rendering
		// uses the scale from the editor config, but prevents the IPC call from hanging.
		return { success: true };
	});

	ipcMain.handle("get-cursor-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = normalizeVideoSourcePath(videoPath ?? currentVideoPath);
		if (!targetVideoPath) {
			return { success: true, samples: [] };
		}

		const telemetryPath = getTelemetryPathForVideo(targetVideoPath);
		try {
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = JSON.parse(content);
			const rawSamples = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.samples)
					? parsed.samples
					: [];

			const samples: CursorTelemetryPoint[] = rawSamples
				.filter((sample: unknown) => Boolean(sample && typeof sample === "object"))
				.map((sample: unknown) => {
					const point = sample as Partial<CursorTelemetryPoint>;
					return {
						timeMs:
							typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
								? Math.max(0, point.timeMs)
								: 0,
						cx:
							typeof point.cx === "number" && Number.isFinite(point.cx)
								? clamp(point.cx, 0, 1)
								: 0.5,
						cy:
							typeof point.cy === "number" && Number.isFinite(point.cy)
								? clamp(point.cy, 0, 1)
								: 0.5,
						interactionType:
							point.interactionType === "click" ||
							point.interactionType === "double-click" ||
							point.interactionType === "right-click" ||
							point.interactionType === "middle-click" ||
							point.interactionType === "move" ||
							point.interactionType === "mouseup"
								? point.interactionType
								: undefined,
						cursorType:
							point.cursorType === "arrow" ||
							point.cursorType === "text" ||
							point.cursorType === "pointer" ||
							point.cursorType === "crosshair" ||
							point.cursorType === "open-hand" ||
							point.cursorType === "closed-hand" ||
							point.cursorType === "resize-ew" ||
							point.cursorType === "resize-ns" ||
							point.cursorType === "not-allowed"
								? point.cursorType
								: undefined,
					};
				})
				.sort((a: CursorTelemetryPoint, b: CursorTelemetryPoint) => a.timeMs - b.timeMs);

			return { success: true, samples };
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				return { success: true, samples: [] };
			}
			console.error("Failed to load cursor telemetry:", error);
			return {
				success: false,
				message: "Failed to load cursor telemetry",
				error: String(error),
				samples: [],
			};
		}
	});

	ipcMain.handle("get-recent-projects", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const files = await fs.readdir(recordingsDir, { withFileTypes: true });
			const videoExtensions = [".mp4", ".webm"];
			const projectFiles = files.filter(
				(f) =>
					f.isFile() &&
					(f.name.endsWith(`.${PROJECT_FILE_EXTENSION}`) ||
						videoExtensions.some((ext) => f.name.endsWith(ext))),
			);

			const results = await Promise.allSettled(
				projectFiles.map(async (file) => {
					const filePath = path.join(recordingsDir, file.name);
					const stats = await fs.stat(filePath);
					return {
						name: file.name,
						path: filePath,
						mtime: stats.mtimeMs,
					};
				}),
			);
			const projectsWithStats = results
				.filter(
					(r): r is PromiseFulfilledResult<{ name: string; path: string; mtime: number }> =>
						r.status === "fulfilled",
				)
				.map((r) => r.value);

			// sort descending by modified time
			const sorted = projectsWithStats.sort((a, b) => b.mtime - a.mtime).slice(0, 5);

			return { success: true, projects: sorted };
		} catch (error) {
			console.error("Failed to get recent projects:", error);
			return { success: false, projects: [], error: String(error) };
		}
	});

	ipcMain.handle("open-specific-project", async (_, filePath: string) => {
		try {
			const content = await fs.readFile(filePath, "utf-8");
			const project = JSON.parse(content);
			currentProjectPath = filePath;
			if (project && typeof project === "object" && typeof project.videoPath === "string") {
				currentVideoPath = normalizeVideoSourcePath(project.videoPath) ?? project.videoPath;
			}
			createEditorWindow();
			return { success: true, path: filePath, project };
		} catch (error) {
			console.error("Failed to open specific project file:", error);
			return { success: false, message: "Failed to open project file", error: String(error) };
		}
	});

	ipcMain.handle("open-external-url", async (_, url: string) => {
		try {
			await shell.openExternal(url);
			return { success: true };
		} catch (error) {
			console.error("Failed to open URL:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-accessibility-permission-status", () => {
		if (process.platform !== "darwin") {
			return { success: true, trusted: true, prompted: false };
		}

		return {
			success: true,
			trusted: systemPreferences.isTrustedAccessibilityClient(false),
			prompted: false,
		};
	});

	ipcMain.handle("request-accessibility-permission", () => {
		if (process.platform !== "darwin") {
			return { success: true, trusted: true, prompted: false };
		}

		return {
			success: true,
			trusted: systemPreferences.isTrustedAccessibilityClient(true),
			prompted: true,
		};
	});

	ipcMain.handle("get-screen-recording-permission-status", () => {
		if (process.platform !== "darwin") {
			return { success: true, status: "granted" };
		}

		try {
			return {
				success: true,
				status: systemPreferences.getMediaAccessStatus("screen"),
			};
		} catch (error) {
			console.error("Failed to get screen recording permission status:", error);
			return { success: false, status: "unknown", error: String(error) };
		}
	});

	ipcMain.handle("open-screen-recording-preferences", async () => {
		if (process.platform !== "darwin") {
			return { success: true };
		}

		try {
			await shell.openExternal(getMacPrivacySettingsUrl("screen"));
			return { success: true };
		} catch (error) {
			console.error("Failed to open Screen Recording preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("open-accessibility-preferences", async () => {
		if (process.platform !== "darwin") {
			return { success: true };
		}

		try {
			await shell.openExternal(getMacPrivacySettingsUrl("accessibility"));
			return { success: true };
		} catch (error) {
			console.error("Failed to open Accessibility preferences:", error);
			return { success: false, error: String(error) };
		}
	});

	// Return base path for assets so renderer can resolve file:// paths in production
	ipcMain.handle("get-asset-base-path", () => {
		try {
			if (app.isPackaged) {
				// In packaged app, static assets from public/ are inside the asar at dist/
				const assetPath = path.join(app.getAppPath(), "dist");
				console.log("[get-asset-base-path] packaged path:", assetPath);
				return pathToFileURL(`${assetPath}${path.sep}`).toString();
			}
			const assetPath = path.join(app.getAppPath(), "public");
			console.log("[get-asset-base-path] dev path:", assetPath);
			return pathToFileURL(`${assetPath}${path.sep}`).toString();
		} catch (err) {
			console.error("Failed to resolve asset base path:", err);
			return null;
		}
	});

	ipcMain.handle("get-video-asset-path", (_, filename: string) => {
		try {
			let videoPath: string
			if (app.isPackaged) {
				// In packaged app, unpacked files live in app.asar.unpacked/dist/
				videoPath = path.join(process.resourcesPath, "app.asar.unpacked", "dist", filename)
			} else {
				// In dev, public/ files are served by Vite
				videoPath = path.join(app.getAppPath(), "public", filename)
			}
			return pathToFileURL(videoPath).toString()
		} catch (err) {
			console.error("Failed to resolve video asset path:", err)
			return null
		}
	})

	ipcMain.handle("read-local-file", async (_, filePath: string) => {
		try {
			const resolved = path.resolve(filePath);
			const recordingsDir = await getRecordingsDir();
			const allowedDirs = [
				path.resolve(recordingsDir),
				path.resolve(app.getPath("userData")),
				path.resolve(os.tmpdir()),
				path.resolve(app.getPath("temp")),
			];
			const isAllowed = allowedDirs.some(
				(dir) => resolved.startsWith(`${dir}${path.sep}`) || resolved === dir,
			);
			if (!isAllowed) {
				return { success: false, error: `Access denied: path is outside allowed directories` };
			}
			const data = await fs.readFile(resolved);
			return { success: true, data };
		} catch (error) {
			console.error("Failed to read local file:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("save-exported-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			// Determine file type from extension
			const isGif = fileName.toLowerCase().endsWith(".gif");
			const filters = isGif
				? [{ name: "GIF Image", extensions: ["gif"] }]
				: [{ name: "MP4 Video", extensions: ["mp4"] }];

			const result = await dialog.showSaveDialog({
				title: isGif ? "Save Exported GIF" : "Save Exported Video",
				defaultPath: path.join(app.getPath("downloads"), fileName),
				filters,
				properties: ["createDirectory", "showOverwriteConfirmation"],
			});

			if (result.canceled || !result.filePath) {
				return {
					success: false,
					canceled: true,
					message: "Export canceled",
				};
			}

			await fs.writeFile(result.filePath, Buffer.from(videoData));

			return {
				success: true,
				path: result.filePath,
				message: "Video exported successfully",
			};
		} catch (error) {
			console.error("Failed to save exported video:", error);
			return {
				success: false,
				message: "Failed to save exported video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("save-thumbnail", async (_, imageData: ArrayBuffer, fileName: string) => {
		try {
			const result = await dialog.showSaveDialog({
				title: "Save Thumbnail",
				defaultPath: path.join(app.getPath("downloads"), fileName),
				filters: [{ name: "PNG Image", extensions: ["png"] }],
				properties: ["createDirectory", "showOverwriteConfirmation"],
			});

			if (result.canceled || !result.filePath) {
				return {
					success: false,
					canceled: true,
					message: "Save canceled",
				};
			}

			await fs.writeFile(result.filePath, Buffer.from(imageData));

			return {
				success: true,
				path: result.filePath,
				message: "Thumbnail saved successfully",
			};
		} catch (error) {
			console.error("Failed to save thumbnail:", error);
			return {
				success: false,
				message: "Failed to save thumbnail",
				error: String(error),
			};
		}
	});

	ipcMain.handle("open-video-file-picker", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const result = await dialog.showOpenDialog({
				title: "Select Video File",
				defaultPath: recordingsDir,
				filters: [
					{ name: "Video Files", extensions: ["webm", "mp4", "mov", "avi", "mkv"] },
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			currentProjectPath = null;
			return {
				success: true,
				path: result.filePaths[0],
			};
		} catch (error) {
			console.error("Failed to open file picker:", error);
			return {
				success: false,
				message: "Failed to open file picker",
				error: String(error),
			};
		}
	});

	ipcMain.handle("open-audio-file-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: "Select Audio File",
				filters: [
					{ name: "Audio Files", extensions: ["mp3", "wav", "aac", "m4a", "flac", "ogg"] },
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			return {
				success: true,
				path: result.filePaths[0],
			};
		} catch (error) {
			console.error("Failed to open audio file picker:", error);
			return {
				success: false,
				message: "Failed to open audio file picker",
				error: String(error),
			};
		}
	});

	ipcMain.handle("reveal-in-folder", async (_, filePath: string) => {
		try {
			// shell.showItemInFolder doesn't return a value, it throws on error
			shell.showItemInFolder(filePath);
			return { success: true };
		} catch (error) {
			console.error(`Error revealing item in folder: ${filePath}`, error);
			// Fallback to open the directory if revealing the item fails
			// This might happen if the file was moved or deleted after export,
			// or if the path is somehow invalid for showItemInFolder
			try {
				const openPathResult = await shell.openPath(path.dirname(filePath));
				if (openPathResult) {
					// openPath returned an error message
					return { success: false, error: openPathResult };
				}
				return { success: true, message: "Could not reveal item, but opened directory." };
			} catch (openError) {
				console.error(`Error opening directory: ${path.dirname(filePath)}`, openError);
				return { success: false, error: String(error) };
			}
		}
	});

	ipcMain.handle("open-recordings-folder", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const openPathResult = await shell.openPath(recordingsDir);
			if (openPathResult) {
				return {
					success: false,
					error: openPathResult,
					message: "Failed to open recordings folder.",
				};
			}

			return { success: true };
		} catch (error) {
			console.error("Failed to open recordings folder:", error);
			return { success: false, error: String(error), message: "Failed to open recordings folder." };
		}
	});

	ipcMain.handle("get-recordings-directory", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			return {
				success: true,
				path: recordingsDir,
				isDefault: recordingsDir === RECORDINGS_DIR,
			};
		} catch (error) {
			return {
				success: false,
				path: RECORDINGS_DIR,
				isDefault: true,
				error: String(error),
			};
		}
	});

	ipcMain.handle("choose-recordings-directory", async () => {
		try {
			const current = await getRecordingsDir();
			const result = await dialog.showOpenDialog({
				title: "Choose recordings folder",
				defaultPath: current,
				properties: ["openDirectory", "createDirectory", "promptToCreate"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true, path: current };
			}

			const selectedPath = path.resolve(result.filePaths[0]);
			await fs.mkdir(selectedPath, { recursive: true });
			await fs.access(selectedPath, fsConstants.W_OK);
			await persistRecordingsDirectorySetting(selectedPath);

			return { success: true, path: selectedPath, isDefault: selectedPath === RECORDINGS_DIR };
		} catch (error) {
			return { success: false, error: String(error), message: "Failed to set recordings folder" };
		}
	});

	let projectSaveInProgress = false;
	ipcMain.handle(
		"save-project-file",
		async (_, projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
			if (projectSaveInProgress) {
				return { success: false, message: "A save is already in progress" };
			}
			projectSaveInProgress = true;
			try {
				const recordingsDir = await getRecordingsDir();
				const trustedExistingProjectPath = isTrustedProjectPath(existingProjectPath)
					? existingProjectPath
					: null;

				if (trustedExistingProjectPath) {
					await fs.writeFile(
						trustedExistingProjectPath,
						JSON.stringify(projectData, null, 2),
						"utf-8",
					);
					currentProjectPath = trustedExistingProjectPath;
					return {
						success: true,
						path: trustedExistingProjectPath,
						message: "Project saved successfully",
					};
				}

				const safeName = (suggestedName || `project-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, "_");
				const defaultName = safeName.endsWith(`.${PROJECT_FILE_EXTENSION}`)
					? safeName
					: `${safeName}.${PROJECT_FILE_EXTENSION}`;

				const result = await dialog.showSaveDialog({
					title: "Save klipt Project",
					defaultPath: path.join(recordingsDir, defaultName),
					filters: [
						{ name: "klipt Project", extensions: [PROJECT_FILE_EXTENSION] },
						{ name: "JSON", extensions: ["json"] },
					],
					properties: ["createDirectory", "showOverwriteConfirmation"],
				});

				if (result.canceled || !result.filePath) {
					return {
						success: false,
						canceled: true,
						message: "Save project canceled",
					};
				}

				await fs.writeFile(result.filePath, JSON.stringify(projectData, null, 2), "utf-8");
				currentProjectPath = result.filePath;

				return {
					success: true,
					path: result.filePath,
					message: "Project saved successfully",
				};
			} catch (error) {
				console.error("Failed to save project file:", error);
				return {
					success: false,
					message: "Failed to save project file",
					error: String(error),
				};
			} finally {
				projectSaveInProgress = false;
			}
		},
	);

	ipcMain.handle("load-project-file", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const result = await dialog.showOpenDialog({
				title: "Open klipt Project",
				defaultPath: recordingsDir,
				filters: [
					{
						name: "klipt Project",
						extensions: [PROJECT_FILE_EXTENSION, ...LEGACY_PROJECT_FILE_EXTENSIONS],
					},
					{ name: "JSON", extensions: ["json"] },
					{ name: "All Files", extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true, message: "Open project canceled" };
			}

			const filePath = result.filePaths[0];
			const content = await fs.readFile(filePath, "utf-8");
			const project = JSON.parse(content);
			currentProjectPath = filePath;
			if (project && typeof project === "object" && typeof project.videoPath === "string") {
				currentVideoPath = normalizeVideoSourcePath(project.videoPath) ?? project.videoPath;
			}

			return {
				success: true,
				path: filePath,
				project,
			};
		} catch (error) {
			console.error("Failed to load project file:", error);
			return {
				success: false,
				message: "Failed to load project file",
				error: String(error),
			};
		}
	});

	ipcMain.handle("load-current-project-file", async () => {
		try {
			if (!currentProjectPath) {
				return { success: false, message: "No active project" };
			}

			const content = await fs.readFile(currentProjectPath, "utf-8");
			const project = JSON.parse(content);
			if (project && typeof project === "object" && typeof project.videoPath === "string") {
				currentVideoPath = normalizeVideoSourcePath(project.videoPath) ?? project.videoPath;
			}
			return {
				success: true,
				path: currentProjectPath,
				project,
			};
		} catch (error) {
			console.error("Failed to load current project file:", error);
			return {
				success: false,
				message: "Failed to load current project file",
				error: String(error),
			};
		}
	});
	ipcMain.handle("set-current-video-path", (_, path: string) => {
		currentVideoPath = normalizeVideoSourcePath(path) ?? path;
		currentProjectPath = null;
		return { success: true };
	});

	ipcMain.handle("get-current-video-path", () => {
		return currentVideoPath ? { success: true, path: currentVideoPath } : { success: false };
	});

	ipcMain.handle("clear-current-video-path", () => {
		currentVideoPath = null;
		return { success: true };
	});

	ipcMain.handle("get-platform", () => {
		return process.platform;
	});

	// ---------------------------------------------------------------------------
	// Cursor hiding for the browser-capture fallback.
	// The IPC promise resolves only after the cursor hide attempt completes.
	// ---------------------------------------------------------------------------
	ipcMain.handle("hide-cursor", () => {
		// No-op: macOS excludes the cursor at the ScreenCaptureKit capture level.
		// Windows excludes the cursor via IsCursorCaptureEnabled(false) in wgc_session.cpp.
		// Linux uses Electron desktopCapturer which does not support cursor hiding;
		// if WGC is unavailable on Windows the call also falls back to browser capture
		// where cursor hiding is unsupported — those users may see the real cursor.
		return { success: true };
	});

	ipcMain.handle("get-shortcuts", async () => {
		try {
			const data = await fs.readFile(SHORTCUTS_FILE, "utf-8");
			return JSON.parse(data);
		} catch {
			return null;
		}
	});

	ipcMain.handle("save-shortcuts", async (_, shortcuts: unknown) => {
		try {
			await fs.writeFile(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), "utf-8");
			return { success: true };
		} catch (error) {
			console.error("Failed to save shortcuts:", error);
			return { success: false, error: String(error) };
		}
	});

	// ---------------------------------------------------------------------------
	// Countdown timer before recording
	// ---------------------------------------------------------------------------
	ipcMain.handle("get-countdown-delay", async () => {
		try {
			const content = await fs.readFile(COUNTDOWN_SETTINGS_FILE, "utf-8");
			const parsed = JSON.parse(content) as { delay?: number };
			return { success: true, delay: parsed.delay ?? 3 };
		} catch {
			return { success: true, delay: 3 };
		}
	});

	ipcMain.handle("set-countdown-delay", async (_, delay: number) => {
		try {
			await fs.writeFile(COUNTDOWN_SETTINGS_FILE, JSON.stringify({ delay }, null, 2), "utf-8");
			return { success: true };
		} catch (error) {
			console.error("Failed to save countdown delay:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("start-countdown", async (_, seconds: number) => {
		if (countdownInProgress) {
			return { success: false, error: "Countdown already in progress" };
		}

		countdownInProgress = true;
		countdownCancelled = false;

		const countdownWin = createCountdownWindow();

		await new Promise<void>((resolve) => {
			countdownWin.webContents.once("did-finish-load", () => {
				resolve();
			});
		});

		return new Promise<{ success: boolean; cancelled?: boolean }>((resolve) => {
			let remaining = seconds;

			countdownWin.webContents.send("countdown-tick", remaining);

			countdownTimer = setInterval(() => {
				if (countdownCancelled) {
					if (countdownTimer) {
						clearInterval(countdownTimer);
						countdownTimer = null;
					}
					closeCountdownWindow();
					countdownInProgress = false;
					resolve({ success: false, cancelled: true });
					return;
				}

				remaining--;

				if (remaining <= 0) {
					if (countdownTimer) {
						clearInterval(countdownTimer);
						countdownTimer = null;
					}
					closeCountdownWindow();
					countdownInProgress = false;
					resolve({ success: true });
				} else {
					const win = getCountdownWindow();
					if (win && !win.isDestroyed()) {
						win.webContents.send("countdown-tick", remaining);
					}
				}
			}, 1000);
		});
	});

	ipcMain.handle("cancel-countdown", () => {
		countdownCancelled = true;
		countdownInProgress = false;
		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = null;
		}
		closeCountdownWindow();
		return { success: true };
	});

	// ---------------------------------------------------------------------------
	// Webcam video storage & camera permissions
	// ---------------------------------------------------------------------------

	ipcMain.handle("store-webcam-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			const recordingsDir = await getRecordingsDir();
			const videoPath = path.join(recordingsDir, fileName);
			await fs.writeFile(videoPath, Buffer.from(videoData));
			currentWebcamPath = videoPath;
			return {
				success: true,
				path: videoPath,
				message: "Webcam video stored successfully",
			};
		} catch (error) {
			console.error("Failed to store webcam video:", error);
			return {
				success: false,
				message: "Failed to store webcam video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-webcam-video-path", async () => {
		try {
			const recordingsDir = await getRecordingsDir();
			const files = await fs.readdir(recordingsDir);
			const webcamFiles = files.filter((file) => /^webcam-.*\.(webm|mov|mp4)$/i.test(file));

			if (webcamFiles.length === 0) {
				return { success: false, message: "No webcam video found" };
			}

			const latestWebcam = webcamFiles.sort().reverse()[0];
			const videoPath = path.join(recordingsDir, latestWebcam);
			return { success: true, path: videoPath };
		} catch (error) {
			console.error("Failed to get webcam video path:", error);
			return { success: false, message: "Failed to get webcam video path" };
		}
	});

	ipcMain.handle("set-current-webcam-path", (_, webcamPath: string) => {
		currentWebcamPath = webcamPath;
		return { success: true };
	});

	ipcMain.handle("get-current-webcam-path", () => {
		return currentWebcamPath ? { success: true, path: currentWebcamPath } : { success: false };
	});

	ipcMain.handle("check-camera-permission", () => {
		if (process.platform === "darwin") {
			const status = systemPreferences.getMediaAccessStatus("camera");
			return { success: true, status };
		}
		return { success: true, status: "granted" };
	});

	ipcMain.handle("request-camera-permission", async () => {
		if (process.platform === "darwin") {
			const granted = await systemPreferences.askForMediaAccess("camera");
			return { success: true, granted };
		}
		return { success: true, granted: true };
	});

	// ── Whisper transcription handlers ──

	ipcMain.handle("transcribe-audio", async (_event, rawVideoPath: string) => {
		// Convert file:// URL to filesystem path if needed
		let videoPath = rawVideoPath;
		if (videoPath.startsWith("file://")) {
			videoPath = decodeURIComponent(videoPath.replace(/^file:\/\//, ""));
		}

		const mainWindow = getMainWindow();
		const sendProgress = (percent: number) => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send("transcription-progress", { percent });
			}
		};

		try {
			// Check model is downloaded
			const modelPath = path.join(WHISPER_MODELS_DIR, WHISPER_MODEL_FILENAME);
			try {
				await fs.access(modelPath, fsConstants.R_OK);
			} catch {
				return {
					success: false,
					error: "Whisper model not downloaded. Call downloadWhisperModel() first.",
				};
			}

			sendProgress(5);

			// Extract audio from video to temp WAV (16kHz mono)
			const ffmpegPath = getFfmpegBinaryPath();
			const tempWavPath = path.join(os.tmpdir(), `klipt-whisper-${Date.now()}.wav`);

			sendProgress(10);

			await new Promise<void>((resolve, reject) => {
				const proc = spawn(
					ffmpegPath,
					["-i", videoPath, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", "-y", tempWavPath],
					{ stdio: "pipe" },
				);

				let stderrOutput = "";
				proc.stderr.on("data", (data: Buffer) => {
					stderrOutput += data.toString();
				});

				proc.on("close", (code) => {
					if (code === 0) {
						resolve();
					} else {
						// Check if the video simply has no audio track
						if (stderrOutput.includes("does not contain any stream") || stderrOutput.includes("no audio")) {
							reject(new Error("This video has no audio track. Record with a microphone or system audio enabled to use captions."));
						} else {
							reject(
								new Error(
									`FFmpeg audio extraction failed (code ${code}): ${stderrOutput.slice(-500)}`,
								),
							);
						}
					}
				});

				proc.on("error", reject);
			});

			sendProgress(30);

			// Run whisper transcription
			const result = await transcribeAudio(tempWavPath, modelPath);

			sendProgress(90);

			// Clean up temp file
			try {
				await fs.unlink(tempWavPath);
			} catch {
				// Ignore cleanup errors
			}

			sendProgress(100);

			return { success: true, result };
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { success: false, error: message };
		}
	});

	ipcMain.handle("get-whisper-model-status", async () => {
		try {
			const modelPath = path.join(WHISPER_MODELS_DIR, WHISPER_MODEL_FILENAME);
			const stat = await fs.stat(modelPath);
			return {
				success: true,
				downloaded: true,
				modelPath,
				sizeBytes: stat.size,
			};
		} catch {
			return {
				success: true,
				downloaded: false,
				modelPath: path.join(WHISPER_MODELS_DIR, WHISPER_MODEL_FILENAME),
				sizeBytes: 0,
			};
		}
	});

	ipcMain.handle("download-whisper-model", async () => {
		const mainWindow = getMainWindow();
		const sendProgress = (percent: number) => {
			if (mainWindow && !mainWindow.isDestroyed()) {
				mainWindow.webContents.send("whisper-model-download-progress", { percent });
			}
		};

		try {
			await fs.mkdir(WHISPER_MODELS_DIR, { recursive: true });

			const modelPath = path.join(WHISPER_MODELS_DIR, WHISPER_MODEL_FILENAME);

			// Check if already downloaded
			try {
				const stat = await fs.stat(modelPath);
				if (stat.size > 0) {
					sendProgress(100);
					return { success: true, modelPath };
				}
			} catch {
				// File doesn't exist, proceed with download
			}

			sendProgress(0);

			// Download using Node https/http following redirects
			const { default: https } = await import("node:https");
			const { default: http } = await import("node:http");

			const download = (url: string, redirectCount = 0): Promise<void> => {
				if (redirectCount > 5) {
					return Promise.reject(new Error("Too many redirects"));
				}

				return new Promise((resolve, reject) => {
					const client = url.startsWith("https") ? https : http;
					client
						.get(url, (response) => {
							// Handle redirects
							if (
								response.statusCode &&
								response.statusCode >= 300 &&
								response.statusCode < 400 &&
								response.headers.location
							) {
								response.resume();
								download(response.headers.location, redirectCount + 1).then(resolve, reject);
								return;
							}

							if (response.statusCode !== 200) {
								response.resume();
								reject(new Error(`Download failed with status ${response.statusCode}`));
								return;
							}

							const totalBytes = Number.parseInt(response.headers["content-length"] ?? "0", 10);
							let downloadedBytes = 0;

							const tempPath = `${modelPath}.download`;
							const fileStream = fsSync.createWriteStream(
								tempPath,
							) as import("node:fs").WriteStream;

							response.on("data", (chunk: Buffer) => {
								downloadedBytes += chunk.length;
								if (totalBytes > 0) {
									sendProgress(Math.round((downloadedBytes / totalBytes) * 100));
								}
							});

							response.pipe(fileStream);

							fileStream.on("finish", () => {
								fileStream.close(() => {
									// Rename temp to final
									fsSync.renameSync(tempPath, modelPath);
									resolve();
								});
							});

							fileStream.on("error", (err: Error) => {
								// Clean up partial download
								try {
									fsSync.unlinkSync(tempPath);
								} catch {
									// Ignore
								}
								reject(err);
							});
						})
						.on("error", reject);
				});
			};

			await download(WHISPER_MODEL_URL);

			sendProgress(100);
			return { success: true, modelPath };
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { success: false, error: message };
		}
	});

	// ── Native audio processing handlers ──

	ipcMain.handle("native-denoise-audio", async (_event, inputPath: string) => {
		if (process.platform !== "darwin") {
			return { success: false, error: "Native audio processing is only available on macOS" };
		}

		try {
			const binaryPath = await ensureAudioProcessorBinary();
			const outputPath = path.join(
				os.tmpdir(),
				`klipt-denoised-${Date.now()}.wav`,
			);

			// Resolve file:// URLs
			let resolvedInput = inputPath;
			if (resolvedInput.startsWith("file://")) {
				resolvedInput = decodeURIComponent(resolvedInput.replace(/^file:\/\//, ""));
			}

			const { stdout, stderr } = await execFileAsync(binaryPath, [
				"denoise",
				"-i",
				resolvedInput,
				"-o",
				outputPath,
			], { timeout: 120000 });

			if (stderr) {
				console.warn("[native-denoise-audio] stderr:", stderr);
			}

			let result: Record<string, unknown> = {};
			try {
				result = JSON.parse(stdout);
			} catch {
				// stdout may not be valid JSON if there are warnings
			}

			return {
				success: true,
				path: outputPath,
				...result,
			};
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error("[native-denoise-audio] Failed:", message);
			return { success: false, error: message };
		}
	});

	ipcMain.handle(
		"native-detect-silence",
		async (
			_event,
			inputPath: string,
			options?: { threshold?: number; minDuration?: number },
		) => {
			if (process.platform !== "darwin") {
				return {
					success: false,
					error: "Native audio processing is only available on macOS",
					regions: [],
				};
			}

			try {
				const binaryPath = await ensureAudioProcessorBinary();
				const threshold = options?.threshold ?? -40;
				const minDuration = options?.minDuration ?? 0.5;

				// Resolve file:// URLs
				let resolvedInput = inputPath;
				if (resolvedInput.startsWith("file://")) {
					resolvedInput = decodeURIComponent(resolvedInput.replace(/^file:\/\//, ""));
				}

				const { stdout, stderr } = await execFileAsync(binaryPath, [
					"silence",
					"-i",
					resolvedInput,
					"-threshold",
					String(threshold),
					"-min-duration",
					String(minDuration),
				], { timeout: 60000 });

				if (stderr) {
					console.warn("[native-detect-silence] stderr:", stderr);
				}

				let regions: Array<{ start: number; end: number }> = [];
				try {
					regions = JSON.parse(stdout);
				} catch {
					console.error("[native-detect-silence] Failed to parse JSON output");
				}

				return { success: true, regions };
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[native-detect-silence] Failed:", message);
				return { success: false, error: message, regions: [] };
			}
		},
	);

	// ── Voice Dubbing ───────────────────────────────────────────────────

	ipcMain.handle(
		"dub-video",
		async (
			_event: Electron.IpcMainInvokeEvent,
			rawVideoPath: string,
			targetLanguage: string,
		): Promise<{
			success: boolean;
			audioPath?: string;
			duration?: number;
			error?: string;
		}> => {
			const mainWindow = getMainWindow();
			const sendProgress = (phase: string, percent: number, message: string) => {
				if (mainWindow && !mainWindow.isDestroyed()) {
					mainWindow.webContents.send("dubbing-progress", { phase, percent, message });
				}
			};

			try {
				// Resolve video path
				let videoPath = rawVideoPath;
				if (videoPath.startsWith("file://")) {
					videoPath = decodeURIComponent(videoPath.replace(/^file:\/\//, ""));
				}

				// Phase 1: Extract audio from video
				sendProgress("extracting", 5, "Extracting audio from video...");

				const ffmpegPath = getFfmpegBinaryPath();
				const tempWavPath = path.join(os.tmpdir(), `klipt-dub-extract-${Date.now()}.wav`);

				await new Promise<void>((resolve, reject) => {
					const proc = spawn(
						ffmpegPath,
						["-i", videoPath, "-vn", "-ar", "16000", "-ac", "1", "-f", "wav", "-y", tempWavPath],
						{ stdio: "pipe" },
					);

					let stderrOutput = "";
					proc.stderr.on("data", (data: Buffer) => {
						stderrOutput += data.toString();
					});

					proc.on("close", (code) => {
						if (code === 0) {
							resolve();
						} else {
							if (
								stderrOutput.includes("does not contain any stream") ||
								stderrOutput.includes("no audio")
							) {
								reject(
									new Error(
										"This video has no audio track. Record with a microphone to use dubbing.",
									),
								);
							} else {
								reject(
									new Error(
										`FFmpeg audio extraction failed (code ${code}): ${stderrOutput.slice(-500)}`,
									),
								);
							}
						}
					});

					proc.on("error", reject);
				});

				sendProgress("extracting", 15, "Audio extracted.");

				// Phase 2: Transcribe with Whisper
				sendProgress("translating", 20, "Transcribing audio...");

				const modelPath = path.join(WHISPER_MODELS_DIR, WHISPER_MODEL_FILENAME);
				try {
					await fs.access(modelPath, fsConstants.R_OK);
				} catch {
					try {
						await fs.unlink(tempWavPath);
					} catch {}
					return {
						success: false,
						error: "Whisper model not downloaded. Generate captions first to auto-download the model.",
					};
				}

				const transcriptionResult = await transcribeAudio(tempWavPath, modelPath);

				// Clean up temp wav
				try {
					await fs.unlink(tempWavPath);
				} catch {}

				if (!transcriptionResult || !transcriptionResult.fullText) {
					return {
						success: false,
						error: "Transcription produced no text. The video may have no speech.",
					};
				}

				sendProgress("translating", 35, "Transcription complete. Translating...");

				// Phase 3: Translate text using the translation service
				const sourceLang = transcriptionResult.language || "en";
				let translatedText = transcriptionResult.fullText;

				if (sourceLang !== targetLanguage) {
					try {
						const translationResult = await translateText(
							transcriptionResult.fullText,
							targetLanguage,
							sourceLang,
						);
						translatedText = translationResult.translatedText;
					} catch (translateErr) {
						console.warn("[dub-video] Translation failed, using original text:", translateErr);
					}
				}

				sendProgress("generating", 55, "Generating dubbed audio...");

				// Phase 4: Generate TTS audio — voice clone ONLY, no fallbacks
				const voiceCloneStatus = await getVoiceCloneModelStatus();
				if (!voiceCloneStatus.installed) {
					return {
						success: false,
						error: "Voice clone model not installed. Download the voice clone model first (Settings → Voice Clone).",
					};
				}

				const dubbedAudioPath = path.join(
					os.tmpdir(),
					`klipt-dubbed-${targetLanguage}-${Date.now()}.mp3`,
				);

				sendProgress("generating", 58, "Cloning your voice...");

				// Extract voice reference from original video
				const refAudioPath = await extractVoiceReference(videoPath, ffmpegPath);

				// Generate cloned speech as WAV, then convert to MP3
				const clonedWavPath = path.join(
					os.tmpdir(),
					`klipt-vc-raw-${Date.now()}.wav`,
				);

				await generateClonedSpeech({
					referenceAudioPath: refAudioPath,
					text: translatedText,
					outputPath: clonedWavPath,
					ffmpegPath,
					onProgress: (fraction) => {
						const percent = 58 + Math.round(fraction * 25);
						sendProgress("generating", percent, "Cloning your voice...");
					},
				});

				// Convert WAV → MP3
				await new Promise<void>((resolve, reject) => {
					const proc = spawn(
						ffmpegPath,
						["-i", clonedWavPath, "-ar", "48000", "-y", dubbedAudioPath],
						{ stdio: "pipe" },
					);
					proc.on("close", (code) => {
						if (code === 0) resolve();
						else reject(new Error(`ffmpeg WAV->MP3 conversion failed (code ${code})`));
					});
					proc.on("error", reject);
				});

				// Clean up temp files
				try { await fs.unlink(refAudioPath); } catch {}
				try { await fs.unlink(clonedWavPath); } catch {}

				console.log("[dub-video] Voice clone succeeded");

				sendProgress("syncing", 85, "Finalizing dubbed audio...");

				// Get duration of the generated audio
				let audioDuration = 0;
				try {
					const probeResult = await new Promise<string>((resolve, reject) => {
						const proc = spawn(
							ffmpegPath,
							["-i", dubbedAudioPath, "-f", "null", "-"],
							{ stdio: "pipe" },
						);
						let stderr = "";
						proc.stderr.on("data", (d: Buffer) => {
							stderr += d.toString();
						});
						proc.on("close", () => resolve(stderr));
						proc.on("error", reject);
					});
					const durationMatch = probeResult.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
					if (durationMatch) {
						audioDuration =
							parseInt(durationMatch[1]) * 3600 +
							parseInt(durationMatch[2]) * 60 +
							parseInt(durationMatch[3]) +
							parseInt(durationMatch[4]) / 100;
					}
				} catch {
					// Non-critical — duration is informational
				}

				sendProgress("syncing", 100, "Dubbing complete!");

				return {
					success: true,
					audioPath: dubbedAudioPath,
					duration: audioDuration,
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[dub-video] Failed:", message);
				return { success: false, error: message };
			}
		},
	);

	// ── Translation ─────────────────────────────────────────────────────
	ipcMain.handle(
		"translate-text",
		async (
			_event: Electron.IpcMainInvokeEvent,
			text: string,
			targetLang: string,
			sourceLang?: string,
		) => {
			try {
				const result = await translateText(text, targetLang, sourceLang);
				return {
					success: true,
					translatedText: result.translatedText,
					sourceLanguage: result.sourceLanguage,
					targetLanguage: result.targetLanguage,
				};
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				console.error("[translate-text] Failed:", message);
				return { success: false, error: message };
			}
		},
	);

	// ── Voice Clone Model Management ────────────────────────────────────

	ipcMain.handle("get-voice-clone-status", async () => {
		try {
			return await getVoiceCloneModelStatus();
		} catch (err: unknown) {
			console.error("[get-voice-clone-status]", err);
			return { installed: false, downloadedBytes: 0, totalBytes: 0 };
		}
	});

	ipcMain.handle("setup-voice-clone", async () => {
		const mainWindow = getMainWindow();
		try {
			await downloadVoiceCloneModel((downloaded, total, file) => {
				if (mainWindow && !mainWindow.isDestroyed()) {
					const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
					mainWindow.webContents.send("voice-clone-download-progress", {
						percent,
						downloaded,
						total,
						file,
					});
				}
			});
			return { success: true };
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error("[setup-voice-clone] Failed:", message);
			return { success: false, error: message };
		}
	});
}

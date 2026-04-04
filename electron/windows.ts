import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);

const APP_ROOT = path.join(__dirname, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");
const WINDOW_ICON_PATH = path.join(
	process.env.VITE_PUBLIC || RENDERER_DIST,
	"app-icons",
	"klipt-512.png",
);

let hudOverlayWindow: BrowserWindow | null = null;
let cameraBubbleWindow: BrowserWindow | null = null;
let hudOverlayHiddenFromCapture = true;
let hudOverlayCaptureProtectionLoaded = false;
let countdownWindow: BrowserWindow | null = null;

const HUD_OVERLAY_SETTINGS_FILE = path.join(app.getPath("userData"), "hud-overlay-settings.json");

function isHudOverlayCaptureProtectionSupported(): boolean {
	return process.platform !== "linux";
}

function loadHudOverlayCaptureProtectionSetting(): boolean {
	if (hudOverlayCaptureProtectionLoaded) {
		return hudOverlayHiddenFromCapture;
	}

	hudOverlayCaptureProtectionLoaded = true;

	try {
		if (!fs.existsSync(HUD_OVERLAY_SETTINGS_FILE)) {
			return hudOverlayHiddenFromCapture;
		}

		const raw = fs.readFileSync(HUD_OVERLAY_SETTINGS_FILE, "utf-8");
		const parsed = JSON.parse(raw) as { hiddenFromCapture?: unknown };
		if (typeof parsed.hiddenFromCapture === "boolean") {
			hudOverlayHiddenFromCapture = parsed.hiddenFromCapture;
		}
	} catch {
		// Ignore settings read failures and fall back to defaults.
	}

	return hudOverlayHiddenFromCapture;
}

function persistHudOverlayCaptureProtectionSetting(enabled: boolean): void {
	try {
		fs.writeFileSync(
			HUD_OVERLAY_SETTINGS_FILE,
			JSON.stringify({ hiddenFromCapture: enabled }, null, 2),
			"utf-8",
		);
	} catch {
		// Ignore settings write failures and keep runtime state working.
	}
}

function getScreen() {
	return nodeRequire("electron").screen as typeof import("electron").screen;
}

ipcMain.on("hud-overlay-hide", () => {
	if (hudOverlayWindow && !hudOverlayWindow.isDestroyed()) {
		hudOverlayWindow.minimize();
	}
});

ipcMain.handle("get-hud-overlay-capture-protection", () => {
	const enabled = loadHudOverlayCaptureProtectionSetting();

	return {
		success: true,
		enabled,
	};
});

ipcMain.handle("set-hud-overlay-capture-protection", (_event, enabled: boolean) => {
	loadHudOverlayCaptureProtectionSetting();
	hudOverlayHiddenFromCapture = Boolean(enabled);
	persistHudOverlayCaptureProtectionSetting(hudOverlayHiddenFromCapture);

	if (
		isHudOverlayCaptureProtectionSupported() &&
		hudOverlayWindow &&
		!hudOverlayWindow.isDestroyed()
	) {
		hudOverlayWindow.setContentProtection(hudOverlayHiddenFromCapture);
	}

	return {
		success: true,
		enabled: hudOverlayHiddenFromCapture,
	};
});

export function createHomeWindow(): BrowserWindow {
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { workArea } = primaryDisplay;

	const windowWidth = 800;
	const windowHeight = 600;
	const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
	const y = Math.floor(workArea.y + (workArea.height - windowHeight) / 2);

	const isMac = process.platform === "darwin";

	const win = new BrowserWindow({
		width: windowWidth,
		height: windowHeight,
		x,
		y,
		minWidth: 700,
		minHeight: 500,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		...(isMac && {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 16, y: 16 },
		}),
		frame: isMac ? true : false,
		transparent: false,
		resizable: true,
		movable: true,
		alwaysOnTop: false,
		skipTaskbar: false,
		hasShadow: true,
		show: false,
		backgroundColor: "#0D0D0D",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
			}
		}, 100);
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=home");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "home" },
		});
	}

	return win;
}

export function createHudOverlayWindow(): BrowserWindow {
	loadHudOverlayCaptureProtectionSetting();

	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { workArea } = primaryDisplay;

	const windowWidth = Math.min(workArea.width, 1200);
	const windowHeight = 200;
	const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
	const y = Math.floor(workArea.y + workArea.height - windowHeight - 20);

	const win = new BrowserWindow({
		width: windowWidth,
		height: windowHeight,
		x,
		y,
		frame: false,
		transparent: true,
		resizable: false,
		movable: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	if (isHudOverlayCaptureProtectionSupported()) {
		win.setContentProtection(hudOverlayHiddenFromCapture);
	}

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
			}
		}, 100);
	});

	hudOverlayWindow = win;

	win.on("closed", () => {
		if (hudOverlayWindow === win) {
			hudOverlayWindow = null;
		}
	});

	// Also clear reference if window is destroyed without 'closed' firing
	// @ts-expect-error Electron types don't expose 'destroyed' but it works at runtime
	win.on("destroyed", () => {
		if (hudOverlayWindow === win) {
			hudOverlayWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=hud-overlay");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "hud-overlay" },
		});
	}

	return win;
}

// --- Camera Bubble Window (separate always-on-top window) ---

export function getCameraBubbleWindow(): BrowserWindow | null {
	return cameraBubbleWindow;
}

export function createCameraBubbleWindow(size = 150): BrowserWindow {
	if (cameraBubbleWindow && !cameraBubbleWindow.isDestroyed()) {
		cameraBubbleWindow.focus();
		return cameraBubbleWindow;
	}

	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { workArea } = primaryDisplay;

	const win = new BrowserWindow({
		width: size,
		height: size,
		x: workArea.x + workArea.width - size - 30,
		y: workArea.y + workArea.height - size - 100,
		frame: false,
		transparent: true,
		resizable: true,
		movable: true,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		minWidth: 60,
		minHeight: 60,
		maxWidth: 400,
		maxHeight: 400,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	if (isHudOverlayCaptureProtectionSupported()) {
		win.setContentProtection(hudOverlayHiddenFromCapture);
	}

	win.webContents.on("did-finish-load", () => {
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
			}
		}, 100);
	});

	cameraBubbleWindow = win;

	win.on("closed", () => {
		if (cameraBubbleWindow === win) {
			cameraBubbleWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=camera-bubble");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "camera-bubble" },
		});
	}

	return win;
}

export function closeCameraBubbleWindow() {
	if (cameraBubbleWindow && !cameraBubbleWindow.isDestroyed()) {
		cameraBubbleWindow.close();
		cameraBubbleWindow = null;
	}
}

ipcMain.handle("open-camera-bubble", (_, size?: number) => {
	createCameraBubbleWindow(size ?? 150);
	return { success: true };
});

ipcMain.handle("close-camera-bubble", () => {
	closeCameraBubbleWindow();
	return { success: true };
});

ipcMain.handle("resize-camera-bubble", (_, size: number) => {
	if (cameraBubbleWindow && !cameraBubbleWindow.isDestroyed()) {
		cameraBubbleWindow.setSize(size, size);
	}
	return { success: true };
});

export function createEditorWindow(): BrowserWindow {
	const isMac = process.platform === "darwin";

	const win = new BrowserWindow({
		width: 1200,
		height: 800,
		minWidth: 800,
		minHeight: 600,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		...(isMac && {
			titleBarStyle: "hiddenInset",
			trafficLightPosition: { x: 12, y: 12 },
		}),
		transparent: false,
		resizable: true,
		alwaysOnTop: false,
		skipTaskbar: false,
		title: "klipt",
		show: false,
		backgroundColor: "#0A0A0F",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
			backgroundThrottling: false,
		},
	});

	win.once("ready-to-show", () => {
		win.show();
		win.maximize();
	});

	win.webContents.on("did-finish-load", () => {
		win?.webContents.send("main-process-message", new Date().toLocaleString());
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=editor");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "editor" },
		});
	}

	return win;
}

export function createSourceSelectorWindow(): BrowserWindow {
	const { width, height } = getScreen().getPrimaryDisplay().workAreaSize;

	const win = new BrowserWindow({
		width: 620,
		height: 420,
		minHeight: 350,
		maxHeight: 500,
		x: Math.round((width - 620) / 2),
		y: Math.round((height - 420) / 2),
		frame: false,
		resizable: false,
		alwaysOnTop: true,
		transparent: true,
		show: false,
		...(process.platform !== "darwin" && {
			icon: WINDOW_ICON_PATH,
		}),
		backgroundColor: "#00000000",
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	win.webContents.on("did-finish-load", () => {
		setTimeout(() => {
			if (!win.isDestroyed()) {
				win.show();
			}
		}, 100);
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=source-selector");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "source-selector" },
		});
	}

	return win;
}

export function createCountdownWindow(): BrowserWindow {
	const primaryDisplay = getScreen().getPrimaryDisplay();
	const { width, height } = primaryDisplay.workAreaSize;

	const windowSize = 200;
	const x = Math.floor((width - windowSize) / 2);
	const y = Math.floor((height - windowSize) / 2);

	const win = new BrowserWindow({
		width: windowSize,
		height: windowSize,
		x: x,
		y: y,
		frame: false,
		transparent: true,
		resizable: false,
		alwaysOnTop: true,
		skipTaskbar: true,
		hasShadow: false,
		focusable: true,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			nodeIntegration: false,
			contextIsolation: true,
		},
	});

	countdownWindow = win;

	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

	win.webContents.on("did-finish-load", () => {
		if (!win.isDestroyed()) {
			win.show();
		}
	});

	win.on("closed", () => {
		if (countdownWindow === win) {
			countdownWindow = null;
		}
	});

	if (VITE_DEV_SERVER_URL) {
		win.loadURL(VITE_DEV_SERVER_URL + "?windowType=countdown");
	} else {
		win.loadFile(path.join(RENDERER_DIST, "index.html"), {
			query: { windowType: "countdown" },
		});
	}

	return win;
}

export function getCountdownWindow(): BrowserWindow | null {
	return countdownWindow;
}

export function closeCountdownWindow(): void {
	if (countdownWindow && !countdownWindow.isDestroyed()) {
		countdownWindow.close();
		countdownWindow = null;
	}
}

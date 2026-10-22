// Preload of the headless export window. Plain CommonJS: the export runs from a source checkout,
// and a preload in CommonJS works with the default sandbox of a window.
const { contextBridge, ipcRenderer } = require("electron");

// The exporter reads a few members of window.electronAPI. These are the members a headless export needs.
contextBridge.exposeInMainWorld("electronAPI", {
	readLocalFile: (filePath) => ipcRenderer.invoke("headless:read-input", filePath),
	getAssetBasePath: async () => null,
	getSystemCursorAssets: async () => ({
		success: false,
		cursors: {},
		error: "there is no cursor in a headless export",
	}),
});

contextBridge.exposeInMainWorld("kliptHeadless", {
	getJob: () => ipcRenderer.invoke("headless:get-job"),
	progress: (current, total) => ipcRenderer.send("headless:progress", current, total),
	log: (message) => ipcRenderer.send("headless:log", message),
	finish: (result) => ipcRenderer.invoke("headless:finish", result),
});

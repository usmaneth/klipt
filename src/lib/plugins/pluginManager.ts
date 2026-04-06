import type { PluginSettings, UploadPlugin } from "./pluginTypes";

// ── Plugin Manager ──────────────────────────────────────────────────────────

class PluginManagerImpl {
	private plugins = new Map<string, UploadPlugin>();

	registerPlugin(plugin: UploadPlugin): void {
		this.plugins.set(plugin.id, plugin);
	}

	getPlugin(id: string): UploadPlugin | undefined {
		return this.plugins.get(id);
	}

	getAllPlugins(): UploadPlugin[] {
		return Array.from(this.plugins.values());
	}

	getEnabledPlugins(settings: PluginSettings): UploadPlugin[] {
		return settings.enabledPlugins
			.map((id) => this.plugins.get(id))
			.filter((p): p is UploadPlugin => p !== undefined);
	}
}

export const pluginManager = new PluginManagerImpl();

// ── Settings Persistence ────────────────────────────────────────────────────

const STORAGE_KEY = "klipt-plugin-settings";

export function loadPluginSettings(): PluginSettings {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) return JSON.parse(raw) as PluginSettings;
	} catch {
		// ignore
	}
	return { enabledPlugins: [], configs: {} };
}

export function savePluginSettings(settings: PluginSettings): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

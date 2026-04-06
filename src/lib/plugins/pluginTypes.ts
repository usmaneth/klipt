// ── Plugin Configuration ────────────────────────────────────────────────────

export interface PluginConfigField {
	type: "text" | "password" | "select" | "toggle";
	label: string;
	placeholder?: string;
	required?: boolean;
	options?: Array<{ value: string; label: string }>; // for select type
	defaultValue?: string;
}

// ── Upload Plugin Interface ─────────────────────────────────────────────────

export interface UploadPlugin {
	id: string;
	name: string;
	icon: string; // lucide icon name
	description: string;
	configSchema: Record<string, PluginConfigField>;
	upload(
		filePath: string,
		config: Record<string, string>,
		onProgress?: (percent: number) => void,
	): Promise<{ url: string }>;
	testConnection?(config: Record<string, string>): Promise<{ success: boolean; error?: string }>;
}

// ── Plugin Settings ─────────────────────────────────────────────────────────

export interface PluginSettings {
	enabledPlugins: string[];
	configs: Record<string, Record<string, string>>; // pluginId -> config values
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
	enabledPlugins: [],
	configs: {},
};

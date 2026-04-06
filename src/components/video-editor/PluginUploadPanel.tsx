import { motion } from "framer-motion";
import { Check, Cloud, FolderOutput, Globe, Loader2, TestTube2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BUILTIN_PLUGINS } from "@/lib/plugins/builtinPlugins";
import { loadPluginSettings, pluginManager, savePluginSettings } from "@/lib/plugins/pluginManager";
import type { PluginSettings } from "@/lib/plugins/pluginTypes";

// Register built-in plugins on module load
for (const p of BUILTIN_PLUGINS) pluginManager.registerPlugin(p);

// ── Icon Map ────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, typeof Cloud> = {
	Cloud,
	Globe,
	FolderOutput,
};

// ── Component ───────────────────────────────────────────────────────────────

interface PluginUploadPanelProps {
	filePath: string | null;
}

export function PluginUploadPanel({ filePath }: PluginUploadPanelProps) {
	const [settings, setSettings] = useState<PluginSettings>(loadPluginSettings);
	const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
	const [configValues, setConfigValues] = useState<Record<string, string>>({});
	const [isUploading, setIsUploading] = useState(false);
	const [uploadProgress, setUploadProgress] = useState(0);
	const [uploadUrl, setUploadUrl] = useState<string | null>(null);
	const [isTesting, setIsTesting] = useState(false);
	const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

	const plugins = pluginManager.getAllPlugins();
	const activePlugin = selectedPlugin ? pluginManager.getPlugin(selectedPlugin) : null;

	// Load saved config when selecting a plugin
	useEffect(() => {
		if (selectedPlugin && settings.configs[selectedPlugin]) {
			setConfigValues(settings.configs[selectedPlugin]);
		} else {
			setConfigValues({});
		}
		setTestResult(null);
		setUploadUrl(null);
	}, [selectedPlugin, settings.configs]);

	const updateConfig = useCallback((key: string, value: string) => {
		setConfigValues((prev) => ({ ...prev, [key]: value }));
	}, []);

	const saveConfig = useCallback(() => {
		if (!selectedPlugin) return;
		const updated: PluginSettings = {
			...settings,
			configs: { ...settings.configs, [selectedPlugin]: configValues },
		};
		setSettings(updated);
		savePluginSettings(updated);
	}, [selectedPlugin, configValues, settings]);

	const handleTestConnection = useCallback(async () => {
		if (!activePlugin?.testConnection) return;
		setIsTesting(true);
		setTestResult(null);
		try {
			const result = await activePlugin.testConnection(configValues);
			setTestResult(result);
		} catch (err) {
			setTestResult({ success: false, error: String(err) });
		} finally {
			setIsTesting(false);
		}
	}, [activePlugin, configValues]);

	const handleUpload = useCallback(async () => {
		if (!activePlugin || !filePath) return;
		saveConfig();
		setIsUploading(true);
		setUploadProgress(0);
		setUploadUrl(null);
		try {
			const result = await activePlugin.upload(filePath, configValues, (pct) => setUploadProgress(pct));
			setUploadUrl(result.url);
		} catch (err) {
			setTestResult({ success: false, error: String(err) });
		} finally {
			setIsUploading(false);
		}
	}, [activePlugin, filePath, configValues, saveConfig]);

	return (
		<div className="space-y-4">
			{/* Plugin Grid */}
			<div className="grid grid-cols-3 gap-2">
				{plugins.map((plugin) => {
					const Icon = ICON_MAP[plugin.icon] ?? Cloud;
					const isSelected = selectedPlugin === plugin.id;
					return (
						<button
							key={plugin.id}
							type="button"
							onClick={() => setSelectedPlugin(isSelected ? null : plugin.id)}
							className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
								isSelected
									? "bg-[#E0000F]/10 border-[#E0000F]/30 text-white"
									: "bg-white/[0.03] border-white/[0.06] text-white/60 hover:bg-white/[0.06]"
							}`}
						>
							<Icon className="w-5 h-5" />
							<span className="text-[11px] text-center leading-tight">{plugin.name}</span>
						</button>
					);
				})}
			</div>

			{/* Plugin Config */}
			{activePlugin && (
				<motion.div
					initial={{ opacity: 0, height: 0 }}
					animate={{ opacity: 1, height: "auto" }}
					className="space-y-3"
				>
					<p className="text-xs text-white/40">{activePlugin.description}</p>

					{Object.entries(activePlugin.configSchema).map(([key, field]) => (
						<div key={key}>
							<label className="text-xs text-white/50 mb-1 block">{field.label}</label>
							{field.type === "select" ? (
								<select
									value={configValues[key] ?? field.defaultValue ?? ""}
									onChange={(e) => updateConfig(key, e.target.value)}
									className="w-full px-3 py-2 rounded-lg bg-black/30 text-sm text-white/80 border border-white/[0.08] outline-none"
								>
									{field.options?.map((opt) => (
										<option key={opt.value} value={opt.value}>{opt.label}</option>
									))}
								</select>
							) : (
								<input
									type={field.type === "password" ? "password" : "text"}
									value={configValues[key] ?? field.defaultValue ?? ""}
									onChange={(e) => updateConfig(key, e.target.value)}
									placeholder={field.placeholder}
									className="w-full px-3 py-2 rounded-lg bg-black/30 text-sm text-white/80 placeholder:text-white/20 border border-white/[0.08] outline-none"
								/>
							)}
						</div>
					))}

					{/* Actions */}
					<div className="flex gap-2">
						{activePlugin.testConnection && (
							<button
								type="button"
								onClick={handleTestConnection}
								disabled={isTesting}
								className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-white/60 text-xs transition-colors disabled:opacity-50"
							>
								{isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <TestTube2 className="w-3.5 h-3.5" />}
								Test
							</button>
						)}
						<button
							type="button"
							onClick={handleUpload}
							disabled={isUploading || !filePath}
							className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#E0000F] hover:bg-[#E0000F]/80 text-white text-xs font-medium transition-colors disabled:opacity-50"
						>
							{isUploading ? (
								<>
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
									{uploadProgress}%
								</>
							) : (
								"Upload"
							)}
						</button>
					</div>

					{/* Test Result */}
					{testResult && (
						<div className={`text-xs px-3 py-2 rounded-lg ${testResult.success ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
							{testResult.success ? "Connection successful!" : testResult.error || "Connection failed"}
						</div>
					)}

					{/* Upload Result */}
					{uploadUrl && (
						<div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20">
							<Check className="w-4 h-4 text-green-400 flex-shrink-0" />
							<input
								type="text"
								value={uploadUrl}
								readOnly
								className="flex-1 bg-transparent text-xs text-green-300 outline-none"
							/>
							<button
								type="button"
								onClick={() => navigator.clipboard.writeText(uploadUrl)}
								className="text-xs text-green-400 hover:text-green-300"
							>
								Copy
							</button>
						</div>
					)}
				</motion.div>
			)}
		</div>
	);
}

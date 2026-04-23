import { ExternalLink, KeyRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { API_PROVIDERS, type ApiProviderId, getAllApiKeys, setApiKey } from "@/lib/ai/apiKeys";

/**
 * Lightweight API-keys settings panel. Users paste their Gemini / ElevenLabs /
 * DeepL / Upload-Post keys here to unlock the corresponding AI backends.
 * Nothing leaves the local machine; keys sit in localStorage only.
 */
export function ApiKeysPanel() {
	const [values, setValues] = useState<Partial<Record<ApiProviderId, string>>>({});

	useEffect(() => {
		setValues(getAllApiKeys());
	}, []);

	const onChange = useCallback((provider: ApiProviderId, next: string) => {
		setValues((prev) => ({ ...prev, [provider]: next }));
	}, []);

	const onSave = useCallback(() => {
		for (const provider of Object.keys(API_PROVIDERS) as ApiProviderId[]) {
			setApiKey(provider, values[provider]);
		}
	}, [values]);

	const onClear = useCallback((provider: ApiProviderId) => {
		setValues((prev) => ({ ...prev, [provider]: "" }));
		setApiKey(provider, undefined);
	}, []);

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2 pb-2 border-b border-white/[0.06]">
				<KeyRound className="w-3.5 h-3.5 text-white/40" />
				<span className="text-[11px] font-medium text-white/50">AI &amp; Publishing API Keys</span>
			</div>

			<p className="text-[11px] text-white/40 leading-relaxed">
				Keys are stored locally on your machine only. They are never sent to klipt
				servers. All AI features keep working without keys — they just fall back to
				on-device or free providers.
			</p>

			{(Object.keys(API_PROVIDERS) as ApiProviderId[]).map((id) => {
				const meta = API_PROVIDERS[id];
				const value = values[id] ?? "";
				return (
					<div key={id} className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 flex flex-col gap-2">
						<div className="flex items-center justify-between gap-2">
							<span className="text-[12px] font-semibold text-white/80">{meta.label}</span>
							<a
								href={meta.docsUrl}
								target="_blank"
								rel="noreferrer noopener"
								className="inline-flex items-center gap-1 text-[10px] text-white/40 hover:text-white/70"
							>
								Get key <ExternalLink className="w-3 h-3" />
							</a>
						</div>
						<p className="text-[11px] text-white/50 leading-relaxed">{meta.description}</p>
						<div className="flex items-center gap-2">
							<input
								type="password"
								value={value}
								onChange={(e) => onChange(id, e.target.value)}
								placeholder="Paste key..."
								className="flex-1 rounded-lg bg-black/30 border border-white/[0.08] px-2 py-1.5 text-[11px] text-white/85 placeholder:text-white/25 focus:outline-none focus:border-white/30"
							/>
							{value && (
								<button
									type="button"
									onClick={() => onClear(id)}
									className="text-[10px] text-white/40 hover:text-white/70 px-2 py-1 rounded-md border border-white/[0.08]"
								>
									Clear
								</button>
							)}
						</div>
					</div>
				);
			})}

			<button
				type="button"
				onClick={onSave}
				className="mt-1 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/[0.12] text-[12px] font-medium text-white/85 transition-colors"
			>
				Save API Keys
			</button>
		</div>
	);
}

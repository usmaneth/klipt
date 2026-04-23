// Unified, user-supplied API key storage for optional AI backends.
// Keys live in localStorage (renderer-only). Each key is optional — all
// features have a local or free fallback when a key is absent.

export type ApiProviderId = "gemini" | "elevenlabs" | "deepl" | "uploadPost";

export interface ApiKeyEntry {
	label: string;
	description: string;
	docsUrl: string;
}

export const API_PROVIDERS: Record<ApiProviderId, ApiKeyEntry> = {
	gemini: {
		label: "Google Gemini",
		description: "Powers AI viral-moment detection, chapter detection, titles, descriptions, and thumbnail ranking.",
		docsUrl: "https://aistudio.google.com/apikey",
	},
	elevenlabs: {
		label: "ElevenLabs",
		description: "High-quality multilingual TTS for dubbing. Falls back to Edge TTS when absent.",
		docsUrl: "https://elevenlabs.io/app/settings/api-keys",
	},
	deepl: {
		label: "DeepL",
		description: "Premium translation for dubbing and subtitles. Falls back to MyMemory when absent.",
		docsUrl: "https://www.deepl.com/your-account/keys",
	},
	uploadPost: {
		label: "Upload-Post",
		description: "One-click publishing to TikTok, Instagram Reels, and YouTube Shorts.",
		docsUrl: "https://upload-post.com/",
	},
};

const STORAGE_KEY = "klipt-api-keys";

type KeyMap = Partial<Record<ApiProviderId, string>>;

function readStore(): KeyMap {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed as KeyMap;
	} catch {
		/* ignore */
	}
	return {};
}

function writeStore(map: KeyMap): void {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

export function getApiKey(provider: ApiProviderId): string | undefined {
	const stored = readStore()[provider];
	if (stored && stored.trim().length > 0) return stored.trim();
	// Support build-time env overrides (useful for CI / dev).
	const envName = `VITE_${provider.toUpperCase()}_API_KEY`;
	const fromEnv = (import.meta as unknown as { env?: Record<string, string> }).env?.[envName];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
	return undefined;
}

export function setApiKey(provider: ApiProviderId, value: string | undefined): void {
	const map = readStore();
	if (!value || value.trim().length === 0) {
		delete map[provider];
	} else {
		map[provider] = value.trim();
	}
	writeStore(map);
}

export function getAllApiKeys(): KeyMap {
	return readStore();
}

export function hasApiKey(provider: ApiProviderId): boolean {
	return getApiKey(provider) !== undefined;
}

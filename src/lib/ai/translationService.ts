// Translation service with DeepL (primary) and MyMemory (fallback) backends

import { getApiKey } from "./apiKeys";

export interface TranslationResult {
	translatedText: string;
	sourceLanguage: string;
	targetLanguage: string;
}

export const TRANSLATION_LANGUAGES = [
	{ code: "es", label: "Spanish" },
	{ code: "fr", label: "French" },
	{ code: "de", label: "German" },
	{ code: "pt", label: "Portuguese" },
	{ code: "ja", label: "Japanese" },
	{ code: "ko", label: "Korean" },
	{ code: "zh", label: "Chinese" },
	{ code: "ar", label: "Arabic" },
	{ code: "hi", label: "Hindi" },
	{ code: "it", label: "Italian" },
	{ code: "ru", label: "Russian" },
	{ code: "nl", label: "Dutch" },
	{ code: "pl", label: "Polish" },
	{ code: "tr", label: "Turkish" },
	{ code: "vi", label: "Vietnamese" },
	{ code: "th", label: "Thai" },
	{ code: "sv", label: "Swedish" },
	{ code: "no", label: "Norwegian" },
	{ code: "da", label: "Danish" },
	{ code: "fi", label: "Finnish" },
	{ code: "cs", label: "Czech" },
	{ code: "el", label: "Greek" },
	{ code: "he", label: "Hebrew" },
	{ code: "hu", label: "Hungarian" },
	{ code: "ro", label: "Romanian" },
	{ code: "sk", label: "Slovak" },
	{ code: "uk", label: "Ukrainian" },
	{ code: "id", label: "Indonesian" },
	{ code: "ms", label: "Malay" },
	{ code: "bg", label: "Bulgarian" },
	{ code: "ca", label: "Catalan" },
	{ code: "bn", label: "Bengali" },
	{ code: "ta", label: "Tamil" },
	{ code: "ur", label: "Urdu" },
	{ code: "fa", label: "Persian" },
] as const;

export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGES)[number]["code"];

/**
 * Map our short codes to DeepL's expected target_lang values. Codes not in
 * this map fall through to MyMemory, which speaks a much broader set.
 */
const DEEPL_LANG_MAP: Record<string, string> = {
	es: "ES",
	fr: "FR",
	de: "DE",
	pt: "PT-BR",
	ja: "JA",
	ko: "KO",
	zh: "ZH",
	ar: "AR",
	hi: "HI",
	it: "IT",
	ru: "RU",
	nl: "NL",
	pl: "PL",
	tr: "TR",
	sv: "SV",
	no: "NB",
	da: "DA",
	fi: "FI",
	cs: "CS",
	el: "EL",
	hu: "HU",
	ro: "RO",
	sk: "SK",
	uk: "UK",
	id: "ID",
	bg: "BG",
};

async function translateWithDeepL(
	text: string,
	targetLang: string,
	sourceLang?: string,
	apiKey?: string,
): Promise<TranslationResult | null> {
	if (!apiKey) return null;

	const deeplTarget = DEEPL_LANG_MAP[targetLang] ?? targetLang.toUpperCase();

	try {
		const body: Record<string, string | string[]> = {
			text: [text],
			target_lang: deeplTarget,
		};
		if (sourceLang && sourceLang !== "auto") {
			body.source_lang = sourceLang.toUpperCase();
		}

		const res = await fetch("https://api-free.deepl.com/v2/translate", {
			method: "POST",
			headers: {
				Authorization: `DeepL-Auth-Key ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			console.warn(`[translationService] DeepL returned ${res.status}`);
			return null;
		}

		const data = (await res.json()) as {
			translations: Array<{
				detected_source_language: string;
				text: string;
			}>;
		};

		const translation = data.translations?.[0];
		if (!translation) return null;

		return {
			translatedText: translation.text,
			sourceLanguage: translation.detected_source_language?.toLowerCase() ?? sourceLang ?? "auto",
			targetLanguage: targetLang,
		};
	} catch (err) {
		console.warn("[translationService] DeepL request failed:", err);
		return null;
	}
}

async function translateWithMyMemory(
	text: string,
	targetLang: string,
	sourceLang?: string,
): Promise<TranslationResult> {
	const source = sourceLang && sourceLang !== "auto" ? sourceLang : "en";
	const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${targetLang}`;

	const res = await fetch(url);

	if (!res.ok) {
		throw new Error(`MyMemory returned ${res.status}: ${await res.text()}`);
	}

	const data = (await res.json()) as {
		responseData: {
			translatedText: string;
			match: number;
		};
		responseStatus: number;
	};

	if (data.responseStatus !== 200) {
		throw new Error(`MyMemory translation error (status ${data.responseStatus})`);
	}

	return {
		translatedText: data.responseData.translatedText,
		sourceLanguage: source,
		targetLanguage: targetLang,
	};
}

/**
 * Translate text using DeepL (if API key available) with MyMemory fallback.
 *
 * The DeepL API key is read from the unified apiKeys store (Settings UI)
 * or, as a fallback, the VITE_DEEPL_API_KEY build-time env var.
 */
export async function translateText(
	text: string,
	targetLang: string,
	sourceLang?: string,
): Promise<TranslationResult> {
	const deeplKey = getApiKey("deepl");

	// Try DeepL first
	const deeplResult = await translateWithDeepL(text, targetLang, sourceLang, deeplKey);
	if (deeplResult) return deeplResult;

	// Fall back to MyMemory (free, no API key required)
	return translateWithMyMemory(text, targetLang, sourceLang);
}

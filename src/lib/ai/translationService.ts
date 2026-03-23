// Translation service with DeepL (primary) and LibreTranslate (fallback) backends

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
] as const;

export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGES)[number]["code"];

/** Map our short codes to DeepL's expected target_lang values. */
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

async function translateWithLibreTranslate(
	text: string,
	targetLang: string,
	sourceLang?: string,
): Promise<TranslationResult> {
	const res = await fetch("https://libretranslate.com/translate", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			q: text,
			source: sourceLang && sourceLang !== "auto" ? sourceLang : "auto",
			target: targetLang,
			format: "text",
		}),
	});

	if (!res.ok) {
		throw new Error(`LibreTranslate returned ${res.status}: ${await res.text()}`);
	}

	const data = (await res.json()) as {
		translatedText: string;
		detectedLanguage?: { language: string };
	};

	return {
		translatedText: data.translatedText,
		sourceLanguage: data.detectedLanguage?.language ?? sourceLang ?? "auto",
		targetLanguage: targetLang,
	};
}

/**
 * Translate text using DeepL (if API key available) with LibreTranslate fallback.
 *
 * The DeepL API key is read from the DEEPL_API_KEY environment variable.
 */
export async function translateText(
	text: string,
	targetLang: string,
	sourceLang?: string,
): Promise<TranslationResult> {
	const deeplKey = process.env.DEEPL_API_KEY ?? process.env["DEEPL_API_KEY"];

	// Try DeepL first
	const deeplResult = await translateWithDeepL(text, targetLang, sourceLang, deeplKey);
	if (deeplResult) return deeplResult;

	// Fall back to LibreTranslate
	return translateWithLibreTranslate(text, targetLang, sourceLang);
}

export interface DubbingResult {
	audioPath: string; // Path to the dubbed audio file
	targetLanguage: string;
	duration: number;
}

export interface DubbingProgress {
	phase: "extracting" | "translating" | "generating" | "syncing";
	percent: number;
	message: string;
}

/**
 * Map of language codes to recommended edge-tts voice names.
 * Each entry picks a natural-sounding neural voice for that locale.
 */
export const DUBBING_VOICES: Record<string, { voice: string; label: string }> = {
	en: { voice: "en-US-AriaNeural", label: "English" },
	es: { voice: "es-ES-ElviraNeural", label: "Spanish" },
	fr: { voice: "fr-FR-DeniseNeural", label: "French" },
	de: { voice: "de-DE-KatjaNeural", label: "German" },
	pt: { voice: "pt-BR-FranciscaNeural", label: "Portuguese" },
	it: { voice: "it-IT-ElsaNeural", label: "Italian" },
	ja: { voice: "ja-JP-NanamiNeural", label: "Japanese" },
	ko: { voice: "ko-KR-SunHiNeural", label: "Korean" },
	zh: { voice: "zh-CN-XiaoxiaoNeural", label: "Chinese" },
	hi: { voice: "hi-IN-SwaraNeural", label: "Hindi" },
	ar: { voice: "ar-SA-ZariyahNeural", label: "Arabic" },
	ru: { voice: "ru-RU-SvetlanaNeural", label: "Russian" },
	nl: { voice: "nl-NL-ColetteNeural", label: "Dutch" },
	pl: { voice: "pl-PL-AgnieszkaNeural", label: "Polish" },
	tr: { voice: "tr-TR-EmelNeural", label: "Turkish" },
	vi: { voice: "vi-VN-HoaiMyNeural", label: "Vietnamese" },
	th: { voice: "th-TH-PremwadeeNeural", label: "Thai" },
	sv: { voice: "sv-SE-SofieNeural", label: "Swedish" },
	da: { voice: "da-DK-ChristelNeural", label: "Danish" },
	fi: { voice: "fi-FI-NooraNeural", label: "Finnish" },
	uk: { voice: "uk-UA-PolinaNeural", label: "Ukrainian" },
	id: { voice: "id-ID-GadisNeural", label: "Indonesian" },
};

/**
 * Target languages available in the dubbing dropdown.
 */
export const DUBBING_LANGUAGES = Object.entries(DUBBING_VOICES).map(([code, { label }]) => ({
	code,
	label,
}));

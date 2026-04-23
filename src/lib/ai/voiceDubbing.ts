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

export type DubbingProviderId = "edge-tts" | "elevenlabs";

/**
 * Map of language codes to recommended edge-tts voice names. Extended to cover
 * 30+ locales so dubbing parity with OpenShorts holds without requiring the
 * ElevenLabs provider.
 */
export const DUBBING_VOICES: Record<string, { voice: string; label: string }> = {
	en: { voice: "en-US-AriaNeural", label: "English (US)" },
	"en-gb": { voice: "en-GB-SoniaNeural", label: "English (UK)" },
	es: { voice: "es-ES-ElviraNeural", label: "Spanish (Spain)" },
	"es-mx": { voice: "es-MX-DaliaNeural", label: "Spanish (Mexico)" },
	fr: { voice: "fr-FR-DeniseNeural", label: "French" },
	de: { voice: "de-DE-KatjaNeural", label: "German" },
	pt: { voice: "pt-BR-FranciscaNeural", label: "Portuguese (BR)" },
	"pt-pt": { voice: "pt-PT-RaquelNeural", label: "Portuguese (PT)" },
	it: { voice: "it-IT-ElsaNeural", label: "Italian" },
	ja: { voice: "ja-JP-NanamiNeural", label: "Japanese" },
	ko: { voice: "ko-KR-SunHiNeural", label: "Korean" },
	zh: { voice: "zh-CN-XiaoxiaoNeural", label: "Chinese (Mandarin)" },
	"zh-tw": { voice: "zh-TW-HsiaoChenNeural", label: "Chinese (Taiwan)" },
	hi: { voice: "hi-IN-SwaraNeural", label: "Hindi" },
	ar: { voice: "ar-SA-ZariyahNeural", label: "Arabic" },
	ru: { voice: "ru-RU-SvetlanaNeural", label: "Russian" },
	nl: { voice: "nl-NL-ColetteNeural", label: "Dutch" },
	pl: { voice: "pl-PL-AgnieszkaNeural", label: "Polish" },
	tr: { voice: "tr-TR-EmelNeural", label: "Turkish" },
	vi: { voice: "vi-VN-HoaiMyNeural", label: "Vietnamese" },
	th: { voice: "th-TH-PremwadeeNeural", label: "Thai" },
	sv: { voice: "sv-SE-SofieNeural", label: "Swedish" },
	no: { voice: "nb-NO-PernilleNeural", label: "Norwegian" },
	da: { voice: "da-DK-ChristelNeural", label: "Danish" },
	fi: { voice: "fi-FI-NooraNeural", label: "Finnish" },
	cs: { voice: "cs-CZ-VlastaNeural", label: "Czech" },
	el: { voice: "el-GR-AthinaNeural", label: "Greek" },
	he: { voice: "he-IL-HilaNeural", label: "Hebrew" },
	hu: { voice: "hu-HU-NoemiNeural", label: "Hungarian" },
	ro: { voice: "ro-RO-AlinaNeural", label: "Romanian" },
	sk: { voice: "sk-SK-ViktoriaNeural", label: "Slovak" },
	uk: { voice: "uk-UA-PolinaNeural", label: "Ukrainian" },
	id: { voice: "id-ID-GadisNeural", label: "Indonesian" },
	ms: { voice: "ms-MY-YasminNeural", label: "Malay" },
	ta: { voice: "ta-IN-PallaviNeural", label: "Tamil" },
	te: { voice: "te-IN-ShrutiNeural", label: "Telugu" },
	bn: { voice: "bn-IN-TanishaaNeural", label: "Bengali" },
	ur: { voice: "ur-PK-UzmaNeural", label: "Urdu" },
	fa: { voice: "fa-IR-DilaraNeural", label: "Persian" },
	bg: { voice: "bg-BG-KalinaNeural", label: "Bulgarian" },
	hr: { voice: "hr-HR-GabrijelaNeural", label: "Croatian" },
	lt: { voice: "lt-LT-OnaNeural", label: "Lithuanian" },
	sl: { voice: "sl-SI-PetraNeural", label: "Slovenian" },
	ca: { voice: "ca-ES-JoanaNeural", label: "Catalan" },
};

/**
 * Target languages available in the dubbing dropdown.
 */
export const DUBBING_LANGUAGES = Object.entries(DUBBING_VOICES).map(([code, { label }]) => ({
	code,
	label,
}));

/**
 * Ordered list of TTS providers. The renderer selects one per dubbing job.
 * ElevenLabs is only usable when the user has configured an API key.
 */
export const DUBBING_PROVIDERS: Array<{
	id: DubbingProviderId;
	label: string;
	requiresKey: boolean;
}> = [
	{ id: "edge-tts", label: "Edge TTS (free, 40+ languages)", requiresKey: false },
	{ id: "elevenlabs", label: "ElevenLabs (multilingual, highest quality)", requiresKey: true },
];

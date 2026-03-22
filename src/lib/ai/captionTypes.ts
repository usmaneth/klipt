export interface TranscriptionWord {
	text: string;
	start: number;
	end: number;
	confidence: number;
}

export interface TranscriptionResult {
	words: TranscriptionWord[];
	fullText: string;
	language: string;
}

export interface CaptionStyle {
	fontFamily: string;
	fontSize: number;
	color: string;
	highlightColor: string;
	backgroundColor: string;
	position: "top" | "center" | "bottom";
	animation: "word-highlight" | "karaoke" | "pop";
}

export interface CaptionRegion {
	id: string;
	words: TranscriptionWord[];
	style: CaptionStyle;
}

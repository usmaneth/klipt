/**
 * The voiceover: one speech clip for each caption, from a TTS endpoint.
 * A voiceover never fails a render. When the endpoint is down or a clip is bad, the render runs without the
 * voice and the result says "skipped: <reason>".
 */

import fs from "node:fs";
import path from "node:path";
import type { Caption, Voiceover } from "./timeline.ts";

export type VoiceClip = { file: string; seconds: number };

export type VoiceDeps = {
	fetch: typeof fetch;
	/** The length in seconds of an audio file, or undefined when it cannot be read. */
	duration: (file: string) => Promise<number | undefined>;
	timeoutMs: number;
};

export type VoiceResult = { clips: VoiceClip[]; status: string };

const EXT_BY_TYPE: Record<string, string> = {
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/wave": "wav",
	"audio/mpeg": "mp3",
	"audio/mp3": "mp3",
	"audio/ogg": "ogg",
	"audio/opus": "opus",
	"audio/flac": "flac",
	"audio/aac": "aac",
	"audio/mp4": "m4a",
};

/** Ask the endpoint for one clip. Return the audio bytes and a file extension, or throw with a reason. */
export async function requestSpeech(
	vo: Voiceover,
	text: string,
	deps: Pick<VoiceDeps, "fetch" | "timeoutMs">,
): Promise<{ bytes: Buffer; ext: string }> {
	let res: Response;
	try {
		res = await deps.fetch(vo.endpoint, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "audio/*, application/json" },
			body: JSON.stringify({ text, ...(vo.voice ? { voice: vo.voice } : {}) }),
			signal: AbortSignal.timeout(deps.timeoutMs),
		});
	} catch (error) {
		const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
		const code =
			cause && typeof cause === "object" && "code" in cause ? String(cause.code) : undefined;
		const why =
			code ??
			(cause instanceof Error
				? cause.message
				: error instanceof Error
					? error.message
					: String(error));
		throw new Error(`${vo.endpoint} did not answer: ${why}`);
	}
	const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
	if (!res.ok) {
		const body = (await res.text().catch(() => "")).trim().slice(0, 200);
		throw new Error(`${vo.endpoint} answered HTTP ${res.status}${body ? `: ${body}` : ""}`);
	}
	if (type === "application/json") {
		const data = (await res.json()) as Record<string, unknown>;
		const b64 =
			typeof data.audio === "string"
				? data.audio
				: typeof data.audio_base64 === "string"
					? data.audio_base64
					: undefined;
		if (b64) {
			const format = typeof data.format === "string" ? data.format : "wav";
			return { bytes: Buffer.from(b64, "base64"), ext: format.replace(/[^a-z0-9]/gi, "") || "wav" };
		}
		const url =
			typeof data.url === "string" ? new URL(data.url, vo.endpoint).toString() : undefined;
		if (url) {
			const audio = await deps.fetch(url, { signal: AbortSignal.timeout(deps.timeoutMs) });
			if (!audio.ok) throw new Error(`${url} answered HTTP ${audio.status}`);
			const audioType = (audio.headers.get("content-type") ?? "")
				.split(";")[0]
				.trim()
				.toLowerCase();
			const ext = EXT_BY_TYPE[audioType] ?? (path.extname(new URL(url).pathname).slice(1) || "wav");
			return { bytes: Buffer.from(await audio.arrayBuffer()), ext };
		}
		throw new Error(`${vo.endpoint} answered JSON with no audio or url field`);
	}
	const bytes = Buffer.from(await res.arrayBuffer());
	if (!bytes.length) throw new Error(`${vo.endpoint} answered with no audio`);
	return { bytes, ext: EXT_BY_TYPE[type] ?? "wav" };
}

/**
 * Make one clip for each caption. All or nothing: a caption without its voice would look like a mistake,
 * so the first failure skips the whole voiceover.
 */
export async function synthesize(
	vo: Voiceover,
	captions: Caption[],
	workDir: string,
	deps: VoiceDeps,
): Promise<VoiceResult> {
	if (!captions.length)
		return { clips: [], status: "skipped: the timeline has no captions to speak" };
	const clips: VoiceClip[] = [];
	for (let i = 0; i < captions.length; i++) {
		try {
			const { bytes, ext } = await requestSpeech(vo, captions[i].text, deps);
			const file = path.join(workDir, `voice-${i}.${ext}`);
			fs.writeFileSync(file, bytes);
			const seconds = await deps.duration(file);
			if (!seconds || seconds <= 0)
				throw new Error(`the audio for caption ${i + 1} cannot be read`);
			clips.push({ file, seconds });
		} catch (error) {
			return {
				clips: [],
				status: `skipped: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
	}
	return { clips, status: `ok: ${clips.length} clips${vo.voice ? `, voice ${vo.voice}` : ""}` };
}

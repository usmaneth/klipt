/**
 * The voiceover: one speech clip for each caption, from a TTS endpoint.
 *
 *   POST <endpoint> {"text", "voice"?, "style"?, "speed"?}  ->  200 with audio bytes (audio/wav or audio/mpeg)
 *   The X-Duration-Ms header, when it is there, gives the clip length. Else ffprobe reads it.
 *   An error is a status other than 200, with a JSON body {"detail": ...} or text.
 *
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

export type Speech = { bytes: Buffer; ext: string; seconds?: number };

const EXT_BY_TYPE: Record<string, string> = {
	"audio/wav": "wav",
	"audio/x-wav": "wav",
	"audio/wave": "wav",
	"audio/mpeg": "mp3",
	"audio/mp3": "mp3",
	"audio/ogg": "ogg",
	"audio/flac": "flac",
};

function describe(error: unknown): string {
	const cause = error instanceof Error && "cause" in error ? error.cause : undefined;
	if (cause && typeof cause === "object" && "code" in cause) return String(cause.code);
	if (error instanceof Error && error.name === "TimeoutError")
		return "no answer before the timeout";
	if (cause instanceof Error) return cause.message;
	return error instanceof Error ? error.message : String(error);
}

/** Ask the endpoint for one clip. Return the audio, or throw with a reason. */
export async function requestSpeech(
	vo: Voiceover,
	text: string,
	deps: Pick<VoiceDeps, "fetch" | "timeoutMs">,
): Promise<Speech> {
	const body: Record<string, unknown> = { text };
	if (vo.voice) body.voice = vo.voice;
	if (vo.style) body.style = vo.style;
	if (vo.speed) body.speed = vo.speed;
	let res: Response;
	let bytes: Buffer;
	try {
		res = await deps.fetch(vo.endpoint, {
			method: "POST",
			headers: { "content-type": "application/json", accept: "audio/*" },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(deps.timeoutMs),
		});
		bytes = Buffer.from(await res.arrayBuffer());
	} catch (error) {
		throw new Error(`${vo.endpoint} did not answer: ${describe(error)}`);
	}
	const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
	if (!res.ok) {
		let detail = bytes.toString("utf8").trim();
		try {
			const data: unknown = JSON.parse(detail);
			if (data && typeof data === "object" && "detail" in data) {
				detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
			}
		} catch {
			// The body is text, not JSON: keep it as it is.
		}
		throw new Error(
			`${vo.endpoint} answered HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
		);
	}
	const ext = EXT_BY_TYPE[type];
	if (!ext) throw new Error(`${vo.endpoint} answered ${type || "no content type"}, not audio`);
	if (!bytes.length) throw new Error(`${vo.endpoint} answered with no audio`);
	const ms = Number(res.headers.get("x-duration-ms"));
	return { bytes, ext, ...(Number.isFinite(ms) && ms > 0 ? { seconds: ms / 1000 } : {}) };
}

/**
 * Make one clip for each caption, one request at a time (the endpoint serves one line at a time).
 * All or nothing: a caption without its voice would look like a mistake, so the first failure skips the voiceover.
 */
export async function synthesize(
	vo: Voiceover,
	captions: Caption[],
	workDir: string,
	deps: VoiceDeps,
): Promise<VoiceResult> {
	if (!captions.length)
		return { clips: [], status: "skipped: the timeline has no captions to speak" };
	if (vo.warmup) {
		// Start a cold engine early. The first line waits for it. A failed warmup is not an error.
		await deps
			.fetch(vo.warmup, { method: "POST", signal: AbortSignal.timeout(10_000) })
			.then((r) => r.arrayBuffer())
			.catch(() => undefined);
	}
	const clips: VoiceClip[] = [];
	for (let i = 0; i < captions.length; i++) {
		try {
			const speech = await requestSpeech(vo, captions[i].text, deps);
			const file = path.join(workDir, `voice-${i}.${speech.ext}`);
			fs.writeFileSync(file, speech.bytes);
			const seconds = speech.seconds ?? (await deps.duration(file));
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

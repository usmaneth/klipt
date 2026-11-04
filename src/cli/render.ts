/**
 * klipt render: a raw recording + timeline.json -> a finished mp4 and a poster.
 * It runs ffmpeg only: no window, no GPU, the same output on every host.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	audioGraph,
	type CaptionLine,
	coverAlphaExpr,
	even,
	FPS,
	fitRect,
	gridArea,
	gridLayout,
	introGraph,
	type Preset,
	presetFor,
	ringAlphaExpr,
	titleLayout,
	videoGraph,
	wrapText,
} from "./graph.ts";
import { isFaststart, mediaDuration, probe, type Runner, runCommand, tail, which } from "./proc.ts";
import {
	effectiveZooms,
	emptyTimeline,
	fitToDuration,
	parseTimeline,
	type Timeline,
	TimelineError,
} from "./timeline.ts";
import { cutSelectExpr, scheduleCaptions } from "./timemap.ts";
import { synthesize, type VoiceClip } from "./voiceover.ts";

export const CRF_LADDER = [23, 27, 31, 35, 38];
export const DEFAULT_MAX_MB = 20;
const MASTER_CRF = 14;

export type RenderOptions = {
	input: string;
	timeline?: string;
	out?: string;
	preset?: string;
	maxMb: number;
	title?: string;
	font?: string;
	ttsTimeoutS?: number;
};

export type RenderResult = {
	ok: boolean;
	mp4: string;
	poster: string;
	seconds: number;
	bytes: number;
	width: number;
	height: number;
	reason: string;
	preset: string;
	crf: number | null;
	warnings: string[];
	voiceover?: string;
	log?: string;
};

export type RenderDeps = { run: Runner; fetch: typeof fetch };

export class RenderError extends Error {}

const FONT_CANDIDATES = [
	"/usr/share/fonts/opentype/inter/Inter-SemiBold.otf",
	"/usr/share/fonts/truetype/inter/Inter-SemiBold.ttf",
	"/usr/share/fonts/opentype/inter/Inter-Bold.otf",
	"/Library/Fonts/Inter-SemiBold.ttf",
	"/Library/Fonts/Inter-SemiBold.otf",
	`${os.homedir()}/Library/Fonts/Inter-SemiBold.ttf`,
	`${os.homedir()}/Library/Fonts/Inter-SemiBold.otf`,
	"/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
	"/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
	"/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
	"/System/Library/Fonts/Supplemental/Arial Bold.ttf",
	"/Library/Fonts/Arial Bold.ttf",
	"/System/Library/Fonts/Helvetica.ttc",
];

export function findFont(
	explicit?: string,
	exists: (p: string) => boolean = fs.existsSync,
): string | undefined {
	if (explicit) return exists(explicit) ? explicit : undefined;
	const env = process.env.KLIPT_FONT;
	if (env && exists(env)) return env;
	return FONT_CANDIDATES.find(exists);
}

export function emptyResult(preset = ""): RenderResult {
	return {
		ok: false,
		mp4: "",
		poster: "",
		seconds: 0,
		bytes: 0,
		width: 0,
		height: 0,
		reason: "",
		preset,
		crf: null,
		warnings: [],
	};
}

/** Encode with a rising crf until the file fits. Each try re-encodes the master, never the last try. */
export async function fitUnderCap(
	encode: (crf: number) => Promise<string>,
	sizeOf: () => number,
	maxBytes: number,
	ladder: number[] = CRF_LADDER,
): Promise<{ ok: boolean; crf: number; bytes: number; reason: string; tries: number[] }> {
	const tries: number[] = [];
	let bytes = 0;
	const steps = maxBytes > 0 ? ladder : ladder.slice(0, 1);
	for (const crf of steps) {
		tries.push(crf);
		const failure = await encode(crf);
		if (failure) return { ok: false, crf, bytes: 0, reason: failure, tries };
		bytes = sizeOf();
		if (maxBytes <= 0 || bytes <= maxBytes) return { ok: true, crf, bytes, reason: "", tries };
	}
	const last = steps[steps.length - 1];
	return {
		ok: false,
		crf: last,
		bytes,
		reason: `cannot fit under ${mb(maxBytes)} MB: ${mb(bytes)} MB at crf ${last}; cut or speed up the recording, or raise --max-mb`,
		tries,
	};
}

export function mb(bytes: number): string {
	return (bytes / 1e6).toFixed(1);
}

function introSeconds(tl: Timeline): number {
	if (tl.overview?.stills.length) return tl.overview.seconds ?? tl.title?.seconds ?? 3.5;
	if (tl.title) return tl.title.seconds ?? 2;
	return 0;
}

function resolvePaths(opts: RenderOptions): { input: string; timeline?: string; out: string } {
	const input = path.resolve(opts.input);
	if (fs.existsSync(input) && fs.statSync(input).isDirectory()) {
		const timeline = opts.timeline ?? path.join(input, "timeline.json");
		return {
			input: path.join(input, "raw.mp4"),
			timeline: fs.existsSync(timeline) ? timeline : opts.timeline,
			out: path.resolve(opts.out ?? path.join(input, "demo.mp4")),
		};
	}
	const stem = path.basename(input).replace(/\.[^.]+$/, "");
	return {
		input,
		timeline: opts.timeline,
		out: path.resolve(opts.out ?? path.join(path.dirname(input), `${stem}.demo.mp4`)),
	};
}

export function loadTimeline(file: string | undefined): Timeline {
	if (!file) return emptyTimeline();
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch {
		throw new RenderError(`timeline not found: ${file}`);
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch (error) {
		throw new RenderError(
			`timeline is not JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	try {
		return parseTimeline(data);
	} catch (error) {
		if (error instanceof TimelineError)
			throw new RenderError(`timeline: ${error.problems.join("; ")}`);
		throw error;
	}
}

export async function render(
	opts: RenderOptions,
	deps: RenderDeps = { run: runCommand, fetch },
): Promise<RenderResult> {
	const result = emptyResult(opts.preset ?? "auto");
	let work: string | undefined;
	let log: string | undefined;
	try {
		const paths = resolvePaths(opts);
		if (!which("ffmpeg") || !which("ffprobe"))
			throw new RenderError("ffmpeg and ffprobe must be on PATH");
		if (!fs.existsSync(paths.input)) throw new RenderError(`input not found: ${paths.input}`);
		const outDir = path.dirname(paths.out);
		if (!fs.existsSync(outDir))
			throw new RenderError(`the folder of --out does not exist: ${outDir}`);
		if (!paths.out.endsWith(".mp4")) throw new RenderError("--out must end in .mp4");
		const info = await probe(paths.input, deps.run);
		if (!info || !info.width || !info.height)
			throw new RenderError(`ffprobe cannot read a video stream in ${paths.input}`);
		if (info.duration < 0.5)
			throw new RenderError(`the input is ${info.duration.toFixed(2)}s long, need at least 0.5s`);

		let tl = loadTimeline(paths.timeline);
		if (opts.title) tl.title = { ...tl.title, text: opts.title.trim().slice(0, 120) };
		const fitted = (() => {
			try {
				return fitToDuration(tl, info.duration);
			} catch (error) {
				if (error instanceof TimelineError) throw new RenderError(`timeline: ${error.message}`);
				throw error;
			}
		})();
		tl = fitted.timeline;
		result.warnings.push(...fitted.warnings);

		const preset = presetFor(opts.preset, info.width, info.height);
		if (!preset)
			throw new RenderError(
				`unknown preset "${opts.preset}": use phone-demo, desktop-demo or auto`,
			);
		result.preset = preset.name;
		const font = findFont(opts.font);
		if (!font)
			throw new RenderError(
				opts.font ? `font not found: ${opts.font}` : "no font found: pass --font or set KLIPT_FONT",
			);

		work = fs.mkdtempSync(path.join(os.tmpdir(), "klipt-render-"));
		log = path.join(work, "render.log");
		const run: Runner = (cmd, o) => deps.run(cmd, { ...o, log });
		const ff = async (args: string[], what: string) => {
			const r = await run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", ...args]);
			if (r.code !== 0) throw new RenderError(`ffmpeg failed (${what}): ${tail(r.out)}`);
		};

		// The voiceover first: its clip lengths decide the holds and the caption times.
		let clips: VoiceClip[] = [];
		if (tl.voiceover) {
			const voice = await synthesize(tl.voiceover, tl.captions, work, {
				fetch: deps.fetch,
				timeoutMs: (opts.ttsTimeoutS ?? 60) * 1000,
				duration: (file) => mediaDuration(file, run),
			});
			clips = voice.clips;
			result.voiceover = voice.status;
			if (!clips.length) result.warnings.push(`voiceover ${voice.status}`);
		}

		const schedule = scheduleCaptions(tl.captions, {
			duration: info.duration,
			cuts: tl.cuts,
			speed: tl.speed,
			audio: clips.length ? clips.map((c) => c.seconds) : undefined,
		});
		for (const c of schedule.dropped)
			result.warnings.push(`caption at ${c.t}s dropped: a cut removes it`);
		const map = schedule.map;
		const intro = introSeconds(tl);

		// Process the raw video at its own size, capped so a 4K source does not slow every filter.
		const cap = Math.max(preset.width, preset.height) * 1.5;
		const shrink = Math.min(1, cap / Math.max(info.width, info.height));
		const raw = { width: even(info.width * shrink), height: even(info.height * shrink) };
		const frame = fitRect(raw.width, raw.height, preset.box);

		// Assets: the cover with the rounded hole, the tap ring, the intro card.
		const cover = path.join(work, "cover.png");
		await ff(
			[
				"-f",
				"lavfi",
				"-i",
				`color=c=${preset.background}:s=${preset.width}x${preset.height}:d=1,format=rgba,` +
					`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${coverAlphaExpr(frame, preset.radius)}'`,
				"-frames:v",
				"1",
				cover,
			],
			"cover",
		);
		const taps = tl.taps;
		const ringSize = even(Math.min(raw.width, raw.height) * 0.09);
		let ring: string | undefined;
		if (taps.length) {
			ring = path.join(work, "ring.png");
			await ff(
				[
					"-f",
					"lavfi",
					"-i",
					`color=c=${preset.accent}:s=${ringSize}x${ringSize}:d=1,format=rgba,` +
						`geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${ringAlphaExpr(ringSize)}'`,
					"-frames:v",
					"1",
					ring,
				],
				"tap ring",
			);
		}

		let introPng: string | undefined;
		const stills = tl.overview?.stills ?? [];
		if (intro > 0) {
			introPng = path.join(work, "intro.png");
			await renderIntro({ tl, preset, font, work, input: paths.input, raw, out: introPng, ff });
		}

		const captionLines: CaptionLine[] = [];
		schedule.captions.forEach((c, i) => {
			const lines = wrapText(c.text, preset.caption.maxChars, 2);
			lines.forEach((line, li) => {
				const file = path.join(work as string, `caption-${i}-${li}.txt`);
				fs.writeFileSync(file, line);
				captionLines.push({ file, line: li, lines: lines.length, start: c.start, end: c.end });
			});
		});

		const inputs: string[] = ["-i", paths.input];
		const index = {
			raw: 0,
			cover: 1,
			ring: undefined as number | undefined,
			intro: undefined as number | undefined,
		};
		inputs.push("-i", cover);
		let next = 2;
		if (ring) {
			inputs.push("-i", ring);
			index.ring = next++;
		}
		if (introPng) {
			inputs.push("-loop", "1", "-framerate", String(FPS), "-t", String(intro), "-i", introPng);
			index.intro = next++;
		}
		const voiceInputs = clips.map((clip, i) => {
			inputs.push("-i", clip.file);
			return { input: next++, start: schedule.captions[i]?.start ?? 0, seconds: clip.seconds };
		});
		const remap = map.pieces.length > 1 || map.pieces.some((p) => p.factor !== 1 || p.out !== 0);
		const vgraph = videoGraph({
			raw,
			preset,
			frame,
			zooms: effectiveZooms(tl),
			taps,
			ringSize,
			cutSelect: cutSelectExpr(tl.cuts),
			map,
			remap,
			captionLines,
			font,
			inputs: index,
		});
		const total = intro + map.total;
		const agraph = audioGraph({
			introSeconds: intro,
			total,
			map,
			rawAudio: info.hasAudio,
			rawIndex: 0,
			voice: voiceInputs,
			duck: tl.voiceover?.duck ?? 0.25,
		});
		const master = path.join(work, "master.mp4");
		await ff(
			[
				...inputs,
				"-filter_complex",
				agraph ? `${vgraph};${agraph}` : vgraph,
				"-map",
				"[vout]",
				...(agraph ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "160k"] : ["-an"]),
				"-c:v",
				"libx264",
				"-preset",
				"veryfast",
				"-crf",
				String(MASTER_CRF),
				"-pix_fmt",
				"yuv420p",
				"-r",
				String(FPS),
				master,
			],
			"render",
		);

		const tmpOut = `${paths.out}.tmp.mp4`;
		const maxBytes = Math.round(opts.maxMb * 1e6);
		const fit = await fitUnderCap(
			async (crf) => {
				const r = await run([
					"ffmpeg",
					"-y",
					"-hide_banner",
					"-loglevel",
					"error",
					"-i",
					master,
					"-map",
					"0",
					"-c:v",
					"libx264",
					"-preset",
					"medium",
					"-profile:v",
					"high",
					"-crf",
					String(crf),
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"copy",
					"-movflags",
					"+faststart",
					tmpOut,
				]);
				return r.code === 0 ? "" : `ffmpeg failed (encode at crf ${crf}): ${tail(r.out)}`;
			},
			() => (fs.existsSync(tmpOut) ? fs.statSync(tmpOut).size : 0),
			maxBytes,
		);
		if (fit.tries.length > 1)
			result.warnings.push(`re-encoded at crf ${fit.tries.join(", ")} to fit ${mb(maxBytes)} MB`);
		if (!fit.ok) {
			fs.rmSync(tmpOut, { force: true });
			throw new RenderError(fit.reason);
		}
		fs.renameSync(tmpOut, paths.out);

		const final = await probe(paths.out, run);
		if (!final) throw new RenderError(`ffprobe cannot read the output ${paths.out}`);
		if (final.codec !== "h264" || final.pixFmt !== "yuv420p") {
			throw new RenderError(`the output is ${final.codec} ${final.pixFmt}, need h264 yuv420p`);
		}
		if (!isFaststart(paths.out)) throw new RenderError("the output is not faststart");

		const poster = paths.out.replace(/\.mp4$/, ".poster.jpg");
		if (introPng && stills.length) {
			await ff(["-i", introPng, "-frames:v", "1", "-q:v", "2", poster], "poster");
		} else {
			const at = intro + map.total * 0.4;
			await ff(
				["-ss", at.toFixed(2), "-i", paths.out, "-frames:v", "1", "-q:v", "2", poster],
				"poster",
			);
		}

		Object.assign(result, {
			ok: true,
			mp4: paths.out,
			poster,
			seconds: Math.round(final.duration * 100) / 100,
			bytes: fs.statSync(paths.out).size,
			width: final.width,
			height: final.height,
			crf: fit.crf,
		});
		return result;
	} catch (error) {
		result.ok = false;
		result.reason =
			error instanceof RenderError
				? error.message
				: `render crashed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
		if (log && fs.existsSync(log)) {
			const kept = path.join(os.tmpdir(), `klipt-render-${Date.now()}.log`);
			fs.copyFileSync(log, kept);
			result.log = kept;
		}
		return result;
	} finally {
		if (work) fs.rmSync(work, { recursive: true, force: true });
	}
}

async function renderIntro(c: {
	tl: Timeline;
	preset: Preset;
	font: string;
	work: string;
	input: string;
	raw: { width: number; height: number };
	out: string;
	ff: (args: string[], what: string) => Promise<void>;
}): Promise<void> {
	const { tl, preset, work } = c;
	const stills = tl.overview?.stills ?? [];
	const inputs: string[] = [];
	const files: string[] = [];
	for (const [i, s] of stills.entries()) {
		if (s.image) {
			if (!fs.existsSync(s.image))
				throw new RenderError(`overview still image not found: ${s.image}`);
			files.push(s.image);
			continue;
		}
		const file = path.join(work, `still-${i}.png`);
		await c.ff(
			["-ss", String(s.t ?? 0), "-i", c.input, "-frames:v", "1", "-update", "1", file],
			`still ${i + 1}`,
		);
		files.push(file);
	}
	for (const f of files) inputs.push("-i", f);
	let title: { files: string[]; subFile?: string } | undefined;
	let titleBottom: number | undefined;
	if (tl.title) {
		const lines = wrapText(tl.title.text, preset.title.maxChars, 3);
		const titleFiles = lines.map((line, i) => {
			const file = path.join(work, `title-${i}.txt`);
			fs.writeFileSync(file, line);
			return file;
		});
		let subFile: string | undefined;
		if (tl.title.subtitle) {
			subFile = path.join(work, "subtitle.txt");
			fs.writeFileSync(subFile, wrapText(tl.title.subtitle, preset.title.maxChars * 2, 1)[0]);
		}
		title = { files: titleFiles, subFile };
		titleBottom = titleLayout(preset, lines.length, Boolean(subFile), stills.length > 0).bottom;
	}
	const area = gridArea(preset, titleBottom);
	const labelH = Math.round(preset.label.size * 1.8);
	const rects = gridLayout(
		stills.length,
		c.raw.width / c.raw.height,
		area,
		Math.round(preset.width * 0.025),
		labelH,
	);
	const cells = stills.map((s, i) => {
		const labelFile = path.join(work, `label-${i}.txt`);
		const chars = Math.max(8, Math.floor(rects[i].w / (preset.label.size * 0.55)));
		fs.writeFileSync(labelFile, `${i + 1}  ${wrapText(s.label, chars, 1)[0]}`);
		return { input: i, rect: rects[i], labelFile };
	});
	const graph = introGraph({ preset, font: c.font, title, stills: cells });
	await c.ff(
		[...inputs, "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-update", "1", c.out],
		"intro card",
	);
}

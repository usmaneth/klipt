/**
 * klipt record: capture a source into <out>/raw.mp4 and turn the markers into <out>/timeline.json.
 *
 *   <out>/session.json   state of the recording: starting, recording, stopping, done, failed
 *   <out>/markers.jsonl  the caller appends markers here (see markers.ts) while the recording runs
 *   <out>/raw.mp4        the recording
 *   <out>/timeline.json  captions, taps, stills, cuts and speed ranges from the markers
 *   <out>/record.json    the result, the same JSON that the command prints
 */

import fs from "node:fs";
import path from "node:path";
import {
	type Marker,
	markersToTimeline,
	markerTime,
	parseMarker,
	type Size,
	type TimedMarker,
} from "./markers.ts";
import { probe, type Runner, runCommand, sleep, tail, which } from "./proc.ts";
import { type AndroidOptions, startAndroidCapture } from "./sources/android.ts";
import { startTabCapture, type TabOptions } from "./sources/tab.ts";
import { type Capture, type CaptureStart, deferred } from "./sources/types.ts";
import { parseX11Spec, startX11Capture, type X11Spec } from "./sources/x11.ts";

export type Source =
	| { kind: "tab"; spec: string }
	| { kind: "android"; serial?: string }
	| { kind: "x11"; x11: X11Spec }
	| { kind: "file"; path: string };

export class SourceError extends Error {}

export function parseSource(spec: string): Source {
	const i = spec.indexOf(":");
	const kind = i === -1 ? spec : spec.slice(0, i);
	const rest = i === -1 ? "" : spec.slice(i + 1);
	switch (kind) {
		case "tab":
			if (!rest) throw new SourceError("tab: needs a DevTools URL, a DevTools port, or a page URL");
			return { kind: "tab", spec: rest };
		case "android":
			return rest ? { kind: "android", serial: rest } : { kind: "android" };
		case "x11": {
			const x11 = parseX11Spec(rest || process.env.DISPLAY || "");
			if (!x11)
				throw new SourceError(
					`x11:${rest} is not a display: use x11::99 or x11::99:<window id or name>`,
				);
			return { kind: "x11", x11 };
		}
		case "file":
			if (!rest) throw new SourceError("file: needs a path");
			return { kind: "file", path: path.resolve(rest) };
		default:
			throw new SourceError(`unknown source "${spec}": use tab:, android:, x11: or file:`);
	}
}

export type RecordOptions = {
	source: Source;
	out: string;
	maxS: number;
	fps: number;
	force: boolean;
	title?: string;
	tapSpace?: Size;
	/** Epoch ms of the first frame of a file source, for markers that carry ts. */
	startedAtMs?: number;
	tab: Omit<TabOptions, "spec">;
	android: Omit<AndroidOptions, "serial">;
};

export type RecordResult = {
	ok: boolean;
	out: string;
	raw: string;
	timeline: string;
	markers: number;
	seconds: number;
	bytes: number;
	width: number;
	height: number;
	reason: string;
	source: string;
	stoppedBy: string;
	warnings: string[];
	session: Record<string, unknown>;
};

export const FILES = {
	session: "session.json",
	markers: "markers.jsonl",
	raw: "raw.mp4",
	timeline: "timeline.json",
	result: "record.json",
	capture: "capture.mkv",
	captureLog: "capture.log",
	log: "record.log",
};

export function writeJson(file: string, data: unknown): void {
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
	fs.renameSync(tmp, file);
}

export function readJson(file: string): Record<string, unknown> | undefined {
	try {
		const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
		return typeof data === "object" && data !== null && !Array.isArray(data)
			? (data as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

export function sourceLabel(s: Source): string {
	switch (s.kind) {
		case "tab":
			return `tab:${s.spec}`;
		case "android":
			return `android:${s.serial ?? ""}`;
		case "x11":
			return `x11:${s.x11.display}${s.x11.window ? `:${s.x11.window}` : ""}`;
		case "file":
			return `file:${s.path}`;
	}
}

/** Fail when out holds a finished or running recording, unless force is set: then remove its files. */
export function prepareOut(out: string, force: boolean): void {
	fs.mkdirSync(out, { recursive: true });
	const owned = [
		FILES.session,
		FILES.raw,
		FILES.timeline,
		FILES.result,
		FILES.capture,
		FILES.captureLog,
	];
	const existing = owned.filter((f) => fs.existsSync(path.join(out, f)));
	if (!existing.length) return;
	const session = readJson(path.join(out, FILES.session));
	const pid = typeof session?.pid === "number" ? session.pid : undefined;
	if (
		pid &&
		pid !== process.pid &&
		session?.state !== "done" &&
		session?.state !== "failed" &&
		isAlive(pid)
	) {
		throw new SourceError(
			`${out} is in use by a running recording (pid ${pid}): run klipt stop --out ${out}`,
		);
	}
	if (!force) {
		throw new SourceError(
			`${out} already holds a recording (${existing.join(", ")}): use a new folder or --force`,
		);
	}
	for (const f of [...owned, FILES.markers]) fs.rmSync(path.join(out, f), { force: true });
}

export function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

type ReadMarker = { marker: Marker; readAtMs?: number; line: number };

/** Reads new lines of markers.jsonl as the caller appends them. */
export class MarkerTail {
	private offset = 0;
	private rest = "";
	private lineNo = 0;
	readonly items: ReadMarker[] = [];
	readonly warnings: string[] = [];
	private readonly file: string;

	constructor(file: string) {
		this.file = file;
	}

	/** Read what is new. Return true when a stop marker came in. */
	poll(now: number | undefined = Date.now()): boolean {
		let fd: number;
		try {
			fd = fs.openSync(this.file, "r");
		} catch {
			return false;
		}
		let stop = false;
		try {
			const size = fs.fstatSync(fd).size;
			if (size <= this.offset) return false;
			const buf = Buffer.alloc(size - this.offset);
			fs.readSync(fd, buf, 0, buf.length, this.offset);
			this.offset = size;
			const text = this.rest + buf.toString("utf8");
			const lines = text.split("\n");
			this.rest = lines.pop() ?? "";
			for (const line of lines) stop = this.take(line, now) || stop;
		} finally {
			fs.closeSync(fd);
		}
		return stop;
	}

	/** Read a last line that has no newline at the end. */
	flush(now: number | undefined = Date.now()): void {
		this.poll(now);
		if (this.rest.trim()) this.take(this.rest, now);
		this.rest = "";
	}

	private take(line: string, now: number | undefined): boolean {
		this.lineNo++;
		if (!line.trim()) return false;
		const m = parseMarker(line);
		if (typeof m === "string") {
			this.warnings.push(`markers.jsonl line ${this.lineNo} ignored: ${m}`);
			return false;
		}
		this.items.push({ marker: m, readAtMs: now, line: this.lineNo });
		return m.kind === "stop";
	}
}

/** Markers with their time in the recording. A marker with no t, no ts and no read time is dropped. */
export function timeMarkers(
	items: ReadMarker[],
	startedAtMs: number | undefined,
	warnings: string[],
): TimedMarker[] {
	const out: TimedMarker[] = [];
	for (const { marker, readAtMs, line } of items) {
		if (
			marker.t === undefined &&
			(startedAtMs === undefined || (marker.ts === undefined && readAtMs === undefined))
		) {
			warnings.push(
				`markers.jsonl line ${line} ignored: it has no t, and the start time of the recording is not known`,
			);
			continue;
		}
		out.push({ ...marker, t: markerTime(marker, startedAtMs ?? 0, readAtMs ?? 0) });
	}
	return out;
}

function emptyResult(opts: RecordOptions): RecordResult {
	return {
		ok: false,
		out: opts.out,
		raw: "",
		timeline: "",
		markers: 0,
		seconds: 0,
		bytes: 0,
		width: 0,
		height: 0,
		reason: "",
		source: sourceLabel(opts.source),
		stoppedBy: "",
		warnings: [],
		session: {},
	};
}

function startCapture(
	opts: RecordOptions,
	onTap: (tap: { x: number; y: number }, atMs: number) => void,
): Capture {
	const env = { out: opts.out, fps: opts.fps, onTap };
	switch (opts.source.kind) {
		case "tab":
			return startTabCapture({ ...opts.tab, spec: opts.source.spec }, env);
		case "android":
			return startAndroidCapture({ ...opts.android, serial: opts.source.serial }, env);
		case "x11":
			return startX11Capture(opts.source.x11, env);
		case "file":
			throw new SourceError("a file source is not captured live");
	}
}

export async function record(opts: RecordOptions, run: Runner = runCommand): Promise<RecordResult> {
	const result = emptyResult(opts);
	const sessionFile = path.join(opts.out, FILES.session);
	const session: Record<string, unknown> = {
		state: "starting",
		pid: process.pid,
		source: result.source,
		out: opts.out,
	};
	const setState = (state: string, extra: Record<string, unknown> = {}) => {
		Object.assign(session, { state }, extra);
		writeJson(sessionFile, session);
	};
	let sessionWritten = false;
	try {
		if (!which("ffmpeg") || !which("ffprobe"))
			throw new SourceError("ffmpeg and ffprobe must be on PATH");
		prepareOut(opts.out, opts.force);
		const markersFile = path.join(opts.out, FILES.markers);
		if (!fs.existsSync(markersFile)) fs.writeFileSync(markersFile, "");
		session.markers = markersFile;
		setState("starting");
		sessionWritten = true;
		const tailer = new MarkerTail(markersFile);
		const rawFile = path.join(opts.out, FILES.raw);
		let startedAtMs: number | undefined;
		let tapSpace = opts.tapSpace;
		let warnings: string[] = [];

		if (opts.source.kind === "file") {
			if (!fs.existsSync(opts.source.path))
				throw new SourceError(`file not found: ${opts.source.path}`);
			const r = await run(
				[
					"ffmpeg",
					"-y",
					"-hide_banner",
					"-loglevel",
					"error",
					"-i",
					opts.source.path,
					"-vf",
					`fps=${opts.fps},scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p`,
					"-c:v",
					"libx264",
					"-preset",
					"veryfast",
					"-crf",
					"18",
					"-c:a",
					"aac",
					"-b:a",
					"160k",
					"-movflags",
					"+faststart",
					rawFile,
				],
				{ log: path.join(opts.out, FILES.captureLog) },
			);
			if (r.code !== 0)
				throw new SourceError(`ffmpeg cannot read ${opts.source.path}: ${tail(r.out)}`);
			tailer.flush(undefined);
			startedAtMs = opts.startedAtMs;
			result.stoppedBy = "end of file";
			setState("stopping");
		} else {
			const capture = startCapture(opts, (tap, atMs) => {
				tailer.items.push({ marker: { kind: "tap", x: tap.x, y: tap.y, ts: atMs }, line: 0 });
			});
			let start: CaptureStart;
			try {
				start = await Promise.race([
					capture.started,
					sleep(45000).then(() => {
						throw new SourceError("the source did not start in 45s");
					}),
				]);
			} catch (error) {
				await capture.stop().catch(() => undefined);
				throw error;
			}
			startedAtMs = start.startedAtMs;
			tapSpace = opts.tapSpace ?? start.tapSpace;
			setState("recording", { startedAtMs: startedAtMs ?? Date.now(), ...start.info, tapSpace });

			const stop = deferred<string>();
			const timer = setTimeout(() => stop.resolve(`max-s (${opts.maxS}s)`), opts.maxS * 1000);
			const poll = setInterval(() => {
				if (tailer.poll()) stop.resolve("stop marker");
			}, 100);
			const onInt = () => stop.resolve("signal SIGINT");
			const onTerm = () => stop.resolve("signal SIGTERM");
			process.once("SIGINT", onInt);
			process.once("SIGTERM", onTerm);
			capture.ended.then((why) => stop.resolve(`source ended: ${why}`));
			const stopped = await stop.promise;
			clearTimeout(timer);
			clearInterval(poll);
			process.off("SIGINT", onInt);
			process.off("SIGTERM", onTerm);
			const stopMs = Date.now();
			result.stoppedBy = stopped;
			setState("stopping", { stoppedBy: stopped });
			tailer.flush();
			const done = await capture.stop();
			warnings = done.warnings;
			if (!fs.existsSync(done.file) || fs.statSync(done.file).size === 0) {
				throw new SourceError(
					`the capture wrote no video${warnings.length ? `: ${warnings.join("; ")}` : ""}`,
				);
			}
			const r = await run(
				[
					"ffmpeg",
					"-y",
					"-hide_banner",
					"-loglevel",
					"error",
					"-i",
					done.file,
					"-map",
					"0:v:0",
					"-c",
					"copy",
					"-movflags",
					"+faststart",
					rawFile,
				],
				{ log: path.join(opts.out, FILES.captureLog) },
			);
			if (r.code !== 0)
				throw new SourceError(`cannot write raw.mp4 from the capture: ${tail(r.out)}`);
			fs.rmSync(done.file, { force: true });
			if (startedAtMs === undefined) {
				// The source cannot say when its first frame came. Align the end of the video with the stop.
				const info = await probe(rawFile, run);
				if (info) startedAtMs = stopMs - info.duration * 1000;
				session.startedAtMs = startedAtMs;
			}
		}

		const info = await probe(rawFile, run);
		if (!info || info.duration <= 0) throw new SourceError("ffprobe cannot read raw.mp4");
		result.warnings.push(...warnings, ...tailer.warnings);
		const timed = timeMarkers(tailer.items, startedAtMs, result.warnings).filter(
			(m) => m.kind !== "stop",
		);
		const { timeline, warnings: tlWarnings } = markersToTimeline(timed, {
			duration: info.duration,
			tapSpace: tapSpace ?? { width: info.width, height: info.height },
		});
		result.warnings.push(...tlWarnings);
		if (opts.title) timeline.title = { text: opts.title.slice(0, 120) };
		const timelineFile = path.join(opts.out, FILES.timeline);
		writeJson(timelineFile, timeline);
		Object.assign(result, {
			ok: true,
			raw: rawFile,
			timeline: timelineFile,
			markers: timed.length,
			seconds: Math.round(info.duration * 100) / 100,
			bytes: fs.statSync(rawFile).size,
			width: info.width,
			height: info.height,
		});
		setState("done");
	} catch (error) {
		result.ok = false;
		result.reason = error instanceof Error ? error.message : String(error);
		if (sessionWritten) setState("failed", { reason: result.reason });
	}
	result.session = { ...session };
	// A folder that another recording owns keeps its own result.
	if (sessionWritten) writeJson(path.join(opts.out, FILES.result), result);
	return result;
}

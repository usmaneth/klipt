/**
 * klipt: a screen recorder and editor that programs can drive.
 *
 *   klipt record --source <tab:...|android:...|x11:...|file:...> --out <dir> [options]
 *   klipt mark   --out <dir> --caption "text" | --tap x,y | --state "label" | --speed N | --cut on|off | --stop
 *   klipt stop   --out <dir>
 *   klipt render --input <raw.mp4 | record dir> [--timeline timeline.json] [--preset phone-demo|desktop-demo|auto]
 *
 * Every command prints exactly one JSON line on stdout. Exit code 0: ok. 1: the work failed. 2: bad usage.
 * See docs/agent-cli.md.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bool, num, type ParsedFlags, parseFlags, requireStr, str, UsageError } from "./args.ts";
import { type Marker, parseMarker } from "./markers.ts";
import {
	FILES,
	isAlive,
	parseSource,
	prepareOut,
	type RecordOptions,
	readJson,
	record,
	SourceError,
} from "./record.ts";
import { DEFAULT_MAX_MB, render } from "./render.ts";
import { parseTimeline, type Timeline, TimelineError } from "./timeline.ts";

export type Outcome = { code: number; json: Record<string, unknown> };

const USAGE = `usage:
  klipt record --source <tab:URL|tab:PORT|android:SERIAL|x11::DISPLAY[:WINDOW]|file:PATH> --out DIR [--detach]
               [--max-s 600] [--title T] [--tab MATCH] [--size 1280x720] [--dpr 1] [--chrome PATH] [--no-auto-taps]
               [--adb PATH] [--android-backend auto|scrcpy|screenrecord] [--tap-space WxH] [--force]
  klipt mark   --out DIR (--caption T | --tap X,Y | --state LABEL | --speed N | --cut on|off | --title T | --stop | --json OBJ) [--t S]
  klipt stop   --out DIR [--timeout-s 120]
  klipt render --input RAW|DIR [--timeline FILE] [--out FILE.mp4] [--preset auto|phone-demo|desktop-demo]
               [--max-mb 20] [--title T] [--font FILE] [--tts-timeout-s 120]
  klipt export --input RAW --output FILE.mp4 [--preset phone-demo] [--title T] [--captions FILE] [--zooms FILE]
every command prints one JSON line. exit 0 ok, 1 failed, 2 bad usage. docs/agent-cli.md has the details.`;

function parseSize(
	text: string | undefined,
	name: string,
): { width: number; height: number } | undefined {
	if (text === undefined) return undefined;
	const m = /^(\d+)x(\d+)$/.exec(text);
	if (!m || Number(m[1]) < 2 || Number(m[2]) < 2)
		throw new UsageError(`--${name} must be WIDTHxHEIGHT, got "${text}"`);
	return { width: Number(m[1]), height: Number(m[2]) };
}

const RECORD_FLAGS = {
	source: "string",
	out: "string",
	"max-s": "number",
	fps: "number",
	force: "boolean",
	title: "string",
	"tap-space": "string",
	"started-at": "number",
	tab: "string",
	size: "string",
	dpr: "number",
	chrome: "string",
	"no-auto-taps": "boolean",
	"max-edge": "number",
	adb: "string",
	"android-backend": "string",
	"bit-rate": "number",
	detach: "boolean",
} as const;

function recordOptions(f: ParsedFlags): RecordOptions {
	const backend = str(f, "android-backend") ?? "auto";
	if (backend !== "auto" && backend !== "scrcpy" && backend !== "screenrecord") {
		throw new UsageError("--android-backend must be auto, scrcpy or screenrecord");
	}
	const maxS = num(f, "max-s") ?? 600;
	if (maxS <= 0) throw new UsageError("--max-s must be more than 0");
	let source: RecordOptions["source"];
	try {
		source = parseSource(requireStr(f, "source"));
	} catch (error) {
		if (error instanceof SourceError) throw new UsageError(error.message);
		throw error;
	}
	return {
		source,
		out: path.resolve(requireStr(f, "out")),
		maxS,
		fps: num(f, "fps") ?? 30,
		force: bool(f, "force"),
		title: str(f, "title"),
		tapSpace: parseSize(str(f, "tap-space"), "tap-space"),
		startedAtMs: num(f, "started-at"),
		tab: {
			match: str(f, "tab"),
			size: parseSize(str(f, "size"), "size"),
			dpr: num(f, "dpr"),
			chrome: str(f, "chrome"),
			autoTaps: !bool(f, "no-auto-taps"),
			maxEdge: num(f, "max-edge") ?? 1920,
		},
		android: { adb: str(f, "adb"), backend, bitRate: num(f, "bit-rate") ?? 8_000_000 },
	};
}

async function cmdRecord(argv: string[]): Promise<Outcome> {
	const f = parseFlags(argv, RECORD_FLAGS);
	const opts = recordOptions(f);
	if (bool(f, "detach")) return detach(argv, opts);
	const result = await record(opts);
	return { code: result.ok ? 0 : 1, json: result };
}

/** Start the recorder in the background. Return when frames flow, with the session facts (pid, cdp, ...). */
async function detach(argv: string[], opts: RecordOptions): Promise<Outcome> {
	try {
		prepareOut(opts.out, opts.force);
	} catch (error) {
		return {
			code: 1,
			json: {
				ok: false,
				state: "failed",
				out: opts.out,
				reason: error instanceof Error ? error.message : String(error),
			},
		};
	}
	const log = fs.openSync(path.join(opts.out, FILES.log), "a");
	const child = spawn(
		process.execPath,
		[
			...process.execArgv,
			process.argv[1],
			"record",
			...argv.filter((a) => a !== "--detach" && a !== "--force"),
		],
		{ detached: true, stdio: ["ignore", log, log] },
	);
	child.unref();
	fs.closeSync(log);
	const sessionFile = path.join(opts.out, FILES.session);
	for (let i = 0; i < 500; i++) {
		const s = readJson(sessionFile);
		if (s?.state === "recording") return { code: 0, json: { ok: true, ...s, out: opts.out } };
		if (s?.state === "failed" || (child.exitCode !== null && child.exitCode !== undefined)) {
			await waitFor(() => fs.existsSync(path.join(opts.out, FILES.result)), 3000);
			const r = readJson(path.join(opts.out, FILES.result));
			return {
				code: 1,
				json: r ?? {
					ok: false,
					state: "failed",
					out: opts.out,
					reason: String(
						s?.reason ?? `the recorder exited: read ${path.join(opts.out, FILES.log)}`,
					),
				},
			};
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	return {
		code: 1,
		json: {
			ok: false,
			state: "starting",
			out: opts.out,
			pid: child.pid,
			reason: "the recorder did not start in 50s",
		},
	};
}

async function waitFor(check: () => boolean, ms: number): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (check()) return true;
		await new Promise((r) => setTimeout(r, 100));
	}
	return check();
}

function cmdMark(argv: string[]): Outcome {
	const f = parseFlags(argv, {
		out: "string",
		caption: "string",
		dur: "number",
		tap: "string",
		state: "string",
		speed: "number",
		cut: "string",
		title: "string",
		stop: "boolean",
		json: "string",
		t: "number",
	});
	const out = path.resolve(requireStr(f, "out"));
	const given = ["caption", "tap", "state", "speed", "cut", "title", "stop", "json"].filter(
		(k) => f.values[k] !== undefined,
	);
	if (given.length !== 1)
		throw new UsageError(
			"mark needs exactly one of --caption, --tap, --state, --speed, --cut, --title, --stop, --json",
		);
	const body: Record<string, unknown> = {};
	const caption = str(f, "caption");
	const tap = str(f, "tap");
	const cut = str(f, "cut");
	const json = str(f, "json");
	if (caption !== undefined) {
		body.caption = caption;
		if (num(f, "dur") !== undefined) body.dur = num(f, "dur");
	} else if (tap !== undefined) {
		const m = /^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/.exec(tap);
		if (!m) throw new UsageError(`--tap must be X,Y, got "${tap}"`);
		body.tap = { x: Number(m[1]), y: Number(m[2]) };
	} else if (str(f, "state") !== undefined) body.state = str(f, "state");
	else if (num(f, "speed") !== undefined) body.speed = num(f, "speed");
	else if (cut !== undefined) {
		if (cut !== "on" && cut !== "off") throw new UsageError("--cut must be on or off");
		body.cut = cut === "on";
	} else if (str(f, "title") !== undefined) body.title = str(f, "title");
	else if (bool(f, "stop")) body.stop = true;
	else if (json !== undefined) {
		try {
			Object.assign(body, JSON.parse(json));
		} catch {
			throw new UsageError("--json must be a JSON object");
		}
	}
	if (num(f, "t") !== undefined) body.t = num(f, "t");
	else if (body.t === undefined && body.ts === undefined) body.ts = Date.now();
	const line = JSON.stringify(body);
	const parsed = parseMarker(line);
	if (typeof parsed === "string") throw new UsageError(`bad marker: ${parsed}`);
	if (!fs.existsSync(out))
		return { code: 1, json: { ok: false, reason: `no recording folder: ${out}` } };
	fs.appendFileSync(path.join(out, FILES.markers), `${line}\n`);
	const session = readJson(path.join(out, FILES.session));
	const startedAt = typeof session?.startedAtMs === "number" ? session.startedAtMs : undefined;
	const marker: Marker = parsed;
	const t =
		marker.t ??
		(startedAt !== undefined && marker.ts !== undefined
			? Math.max(0, (marker.ts - startedAt) / 1000)
			: undefined);
	return {
		code: 0,
		json: {
			ok: true,
			marker: body,
			...(t !== undefined ? { t: Math.round(t * 1000) / 1000 } : {}),
			state: session?.state ?? "none",
		},
	};
}

async function cmdStop(argv: string[]): Promise<Outcome> {
	const f = parseFlags(argv, { out: "string", "timeout-s": "number" });
	const out = path.resolve(requireStr(f, "out"));
	const timeoutMs = (num(f, "timeout-s") ?? 120) * 1000;
	const resultFile = path.join(out, FILES.result);
	const session = readJson(path.join(out, FILES.session));
	if (!session) return { code: 1, json: { ok: false, out, reason: `no recording in ${out}` } };
	if (session.state !== "done" && session.state !== "failed") {
		fs.appendFileSync(
			path.join(out, FILES.markers),
			`${JSON.stringify({ stop: true, ts: Date.now() })}\n`,
		);
		const pid = typeof session.pid === "number" ? session.pid : 0;
		const end = Date.now() + timeoutMs;
		while (Date.now() < end) {
			const s = readJson(path.join(out, FILES.session));
			if ((s?.state === "done" || s?.state === "failed") && fs.existsSync(resultFile)) break;
			if (pid && !isAlive(pid)) {
				await waitFor(() => fs.existsSync(resultFile), 2000);
				break;
			}
			await new Promise((r) => setTimeout(r, 150));
		}
	}
	const result = readJson(resultFile);
	if (!result)
		return {
			code: 1,
			json: {
				ok: false,
				out,
				reason: `the recorder wrote no result in ${timeoutMs / 1000}s: read ${path.join(out, FILES.log)}`,
			},
		};
	return { code: result.ok === true ? 0 : 1, json: result };
}

async function cmdRender(argv: string[]): Promise<Outcome> {
	const f = parseFlags(argv, {
		input: "string",
		timeline: "string",
		out: "string",
		preset: "string",
		"max-mb": "number",
		title: "string",
		font: "string",
		"tts-timeout-s": "number",
		json: "boolean",
	});
	const maxMb = num(f, "max-mb") ?? DEFAULT_MAX_MB;
	if (maxMb < 0) throw new UsageError("--max-mb must be 0 (no cap) or more");
	const result = await render({
		input: requireStr(f, "input"),
		timeline: str(f, "timeline"),
		out: str(f, "out"),
		preset: str(f, "preset"),
		maxMb,
		title: str(f, "title"),
		font: str(f, "font"),
		ttsTimeoutS: num(f, "tts-timeout-s"),
	});
	return { code: result.ok ? 0 : 1, json: result };
}

/**
 * The flags of the old scripts/klipt-export: --input --output [--preset] [--title] [--captions] [--zooms].
 * It prints {"ok","out","bytes","seconds","faststart"} where seconds is the time the render took.
 */
async function cmdExport(argv: string[]): Promise<Outcome> {
	const began = Date.now();
	const f = parseFlags(argv, {
		input: "string",
		output: "string",
		preset: "string",
		title: "string",
		captions: "string",
		zooms: "string",
		"max-mb": "number",
	});
	const fail = (reason: string): Outcome => ({ code: 1, json: { ok: false, out: "", reason } });
	const input = requireStr(f, "input");
	const output = requireStr(f, "output");
	const readList = (file: string | undefined, name: string): unknown[] | string => {
		if (!file) return [];
		try {
			const data: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
			return Array.isArray(data) ? data : `${name} is not a JSON list`;
		} catch (error) {
			return `cannot read ${name}: ${error instanceof Error ? error.message : String(error)}`;
		}
	};
	const captions = readList(str(f, "captions"), "--captions");
	if (typeof captions === "string") return fail(captions);
	const zooms = readList(str(f, "zooms"), "--zooms");
	if (typeof zooms === "string") return fail(zooms);
	let timeline: Timeline;
	try {
		timeline = parseTimeline({
			captions,
			zooms,
			...(str(f, "title") ? { title: str(f, "title") } : {}),
		});
	} catch (error) {
		return fail(
			error instanceof TimelineError ? `timeline: ${error.problems.join("; ")}` : String(error),
		);
	}
	const work = fs.mkdtempSync(path.join(path.dirname(path.resolve(output)), ".klipt-export-"));
	try {
		const timelineFile = path.join(work, "timeline.json");
		fs.writeFileSync(timelineFile, JSON.stringify(timeline));
		const r = await render({
			input,
			timeline: timelineFile,
			out: output,
			preset: str(f, "preset") ?? "phone-demo",
			maxMb: num(f, "max-mb") ?? DEFAULT_MAX_MB,
		});
		if (!r.ok) return fail(r.reason);
		return {
			code: 0,
			json: {
				ok: true,
				out: r.mp4,
				bytes: r.bytes,
				seconds: Math.round((Date.now() - began) / 100) / 10,
				faststart: true,
				poster: r.poster,
			},
		};
	} finally {
		fs.rmSync(work, { recursive: true, force: true });
	}
}

export async function run(argv: string[]): Promise<Outcome> {
	const [command, ...rest] = argv;
	try {
		switch (command) {
			case "record":
				return await cmdRecord(rest);
			case "mark":
				return cmdMark(rest);
			case "stop":
				return await cmdStop(rest);
			case "render":
				return await cmdRender(rest);
			case "export":
				return await cmdExport(rest);
			case "help":
			case "--help":
			case "-h":
			case undefined:
				return { code: command ? 0 : 2, json: { ok: command !== undefined, usage: USAGE } };
			default:
				throw new UsageError(`unknown command "${command}": use record, mark, stop or render`);
		}
	} catch (error) {
		if (error instanceof UsageError)
			return { code: 2, json: { ok: false, reason: error.message, usage: USAGE } };
		return {
			code: 1,
			json: {
				ok: false,
				reason: `klipt crashed: ${error instanceof Error ? error.message : String(error)}`,
			},
		};
	}
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
	run(process.argv.slice(2)).then((outcome) => {
		// Exit once the line is out: a capture library must not keep the process alive.
		process.stdout.write(`${JSON.stringify(outcome.json)}\n`, () => process.exit(outcome.code));
	});
}

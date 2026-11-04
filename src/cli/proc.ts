import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type RunResult = { code: number; out: string };

/** A runner takes argv and returns the exit code and the joined stdout and stderr. Tests replace it. */
export type Runner = (cmd: string[], opts?: { log?: string; input?: string }) => Promise<RunResult>;

export const runCommand: Runner = (cmd, opts = {}) =>
	new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"] });
		} catch (error) {
			resolve({ code: 127, out: String(error) });
			return;
		}
		const chunks: Buffer[] = [];
		const logFd = opts.log ? fs.openSync(opts.log, "a") : undefined;
		if (logFd !== undefined) {
			fs.writeSync(logFd, `$ ${cmd.map(quoteArg).join(" ")}\n`);
		}
		const onData = (d: Buffer) => {
			chunks.push(d);
			if (logFd !== undefined) fs.writeSync(logFd, d);
		};
		child.stdout?.on("data", onData);
		child.stderr?.on("data", onData);
		child.on("error", (error) => {
			chunks.push(Buffer.from(String(error)));
		});
		child.on("close", (code) => {
			if (logFd !== undefined) fs.closeSync(logFd);
			resolve({ code: code ?? 1, out: Buffer.concat(chunks).toString("utf8") });
		});
		if (opts.input !== undefined) child.stdin?.end(opts.input);
		else child.stdin?.end();
	});

export function quoteArg(arg: string): string {
	return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`;
}

/** The last lines of a command output, for a one-sentence reason. */
export function tail(text: string, lines = 3, chars = 400): string {
	const kept = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.slice(-lines)
		.join(" | ");
	return kept.length > chars ? `...${kept.slice(-chars)}` : kept;
}

/** The first executable called name on PATH, or undefined. */
export function which(name: string, envPath = process.env.PATH ?? ""): string | undefined {
	if (name.includes("/")) return isExecutable(name) ? name : undefined;
	for (const dir of envPath.split(path.delimiter)) {
		if (!dir) continue;
		const candidate = path.join(dir, name);
		if (isExecutable(candidate)) return candidate;
	}
	return undefined;
}

export function isExecutable(file: string): boolean {
	try {
		fs.accessSync(file, fs.constants.X_OK);
		return fs.statSync(file).isFile();
	} catch {
		return false;
	}
}

export function expandHome(p: string): string {
	return p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p;
}

export type VideoInfo = {
	width: number;
	height: number;
	duration: number;
	codec: string;
	pixFmt: string;
	bytes: number;
	hasAudio: boolean;
};

/** Parse `ffprobe -print_format json -show_streams -show_format`. The size accounts for a 90 degree rotation. */
export function parseProbe(json: string): VideoInfo | undefined {
	let data: {
		streams?: Array<Record<string, unknown>>;
		format?: Record<string, unknown>;
	};
	try {
		data = JSON.parse(json);
	} catch {
		return undefined;
	}
	const stream = data.streams?.find((s) => s.codec_type === "video");
	if (!stream) return undefined;
	let width = Number(stream.width) || 0;
	let height = Number(stream.height) || 0;
	const tags = (stream.tags ?? {}) as Record<string, unknown>;
	const sideData = (stream.side_data_list ?? []) as Array<Record<string, unknown>>;
	const rotation = Number(
		sideData.find((s) => s.rotation !== undefined)?.rotation ?? tags.rotate ?? 0,
	);
	if (Math.abs(rotation) % 180 === 90) {
		[width, height] = [height, width];
	}
	const duration = Number(data.format?.duration ?? stream.duration);
	return {
		width,
		height,
		duration: Number.isFinite(duration) ? duration : 0,
		codec: String(stream.codec_name ?? ""),
		pixFmt: String(stream.pix_fmt ?? ""),
		bytes: Number(data.format?.size) || 0,
		hasAudio: Boolean(data.streams?.some((s) => s.codec_type === "audio")),
	};
}

export async function probe(
	file: string,
	run: Runner = runCommand,
): Promise<VideoInfo | undefined> {
	const r = await run([
		"ffprobe",
		"-v",
		"error",
		"-print_format",
		"json",
		"-show_streams",
		"-show_format",
		file,
	]);
	return r.code === 0 ? parseProbe(r.out) : undefined;
}

/** The length in seconds of any media file (audio or video), or undefined when ffprobe cannot read it. */
export async function mediaDuration(
	file: string,
	run: Runner = runCommand,
): Promise<number | undefined> {
	const r = await run([
		"ffprobe",
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"csv=p=0",
		file,
	]);
	const seconds = Number(r.out.trim());
	return r.code === 0 && Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** True when the moov atom comes before the mdat atom, so a player can start before the download ends. */
export function isFaststart(file: string): boolean {
	let fd: number | undefined;
	try {
		fd = fs.openSync(file, "r");
		const size = fs.fstatSync(fd).size;
		const header = Buffer.alloc(16);
		let offset = 0;
		while (offset + 8 <= size) {
			fs.readSync(fd, header, 0, 16, offset);
			let boxSize = header.readUInt32BE(0);
			const type = header.toString("latin1", 4, 8);
			if (type === "moov") return true;
			if (type === "mdat") return false;
			if (boxSize === 1) boxSize = Number(header.readBigUInt64BE(8));
			if (boxSize < 8) return false;
			offset += boxSize;
		}
		return false;
	} catch {
		return false;
	} finally {
		if (fd !== undefined) fs.closeSync(fd);
	}
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for a child to exit. Send SIGKILL after graceMs when it has not exited. */
export function waitExit(child: ChildProcess, graceMs: number): Promise<number> {
	return new Promise((resolve) => {
		if (child.exitCode !== null) {
			resolve(child.exitCode);
			return;
		}
		const timer = setTimeout(() => child.kill("SIGKILL"), graceMs);
		child.once("exit", (code, signal) => {
			clearTimeout(timer);
			resolve(code ?? (signal ? 128 : 1));
		});
	});
}

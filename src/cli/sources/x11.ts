/**
 * Record an X display, or one window of it, with ffmpeg x11grab. Linux only.
 * A window is captured at the place and size it has when the recording starts.
 */

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type Runner, runCommand, sleep, tail, waitExit } from "../proc.ts";
import { type Capture, type CaptureEnv, type CaptureStart, deferred } from "./types.ts";

export type X11Spec = { display: string; window?: string };

/** Parse the text after "x11:": ":99", "99", ":99.0", ":99:0x1a00007", ":99:Chromium". */
export function parseX11Spec(rest: string): X11Spec | undefined {
	const m = /^:?(\d+(?:\.\d+)?)(?::(.+))?$/.exec(rest.trim());
	if (!m) return undefined;
	return { display: `:${m[1]}`, ...(m[2] ? { window: m[2] } : {}) };
}

/** Parse `xwininfo`: the absolute place and the size. */
export function parseXwininfo(
	text: string,
): { x: number; y: number; width: number; height: number } | undefined {
	const get = (label: string) => {
		const m = new RegExp(`${label}:\\s*(-?\\d+)`).exec(text);
		return m ? Number(m[1]) : undefined;
	};
	const x = get("Absolute upper-left X");
	const y = get("Absolute upper-left Y");
	const width = get("Width");
	const height = get("Height");
	if (x === undefined || y === undefined || !width || !height) return undefined;
	return { x, y, width, height };
}

export async function resolveX11Area(
	spec: X11Spec,
	run: Runner = runCommand,
): Promise<{ x: number; y: number; width: number; height: number; windowId?: string }> {
	const env = ["env", `DISPLAY=${spec.display}`];
	let id: string | undefined;
	if (spec.window) {
		if (/^(0x[0-9a-f]+|\d+)$/i.test(spec.window)) {
			id = spec.window;
		} else {
			const r = await run([...env, "xdotool", "search", "--onlyvisible", "--name", spec.window]);
			id =
				r.code === 0
					? r.out
							.split("\n")
							.map((l) => l.trim())
							.find(Boolean)
					: undefined;
			if (!id)
				throw new Error(
					`no visible window named "${spec.window}" on ${spec.display} (xdotool: ${tail(r.out, 1) || "no match"})`,
				);
		}
	}
	const r = await run([...env, "xwininfo", ...(id ? ["-id", id] : ["-root"])]);
	const area = r.code === 0 ? parseXwininfo(r.out) : undefined;
	if (!area)
		throw new Error(
			`xwininfo cannot read ${id ? `window ${id}` : "the root window"} of ${spec.display}: ${tail(r.out, 1)}`,
		);
	// x11grab cannot read outside the screen. Clip a window that hangs over an edge.
	const x = Math.max(0, area.x);
	const y = Math.max(0, area.y);
	return {
		x,
		y,
		width: area.width - (x - area.x),
		height: area.height - (y - area.y),
		...(id ? { windowId: id } : {}),
	};
}

export function startX11Capture(spec: X11Spec, env: CaptureEnv, run: Runner = runCommand): Capture {
	const started = deferred<CaptureStart>();
	const ended = deferred<string>();
	const file = path.join(env.out, "capture.mkv");
	const logPath = path.join(env.out, "capture.log");
	let ffmpeg: ChildProcess | undefined;
	let stopping = false;

	(async () => {
		try {
			if (process.platform !== "linux") throw new Error("x11 capture needs Linux");
			const area = await resolveX11Area(spec, run);
			const w = area.width - (area.width % 2);
			const h = area.height - (area.height % 2);
			const fd = fs.openSync(logPath, "a");
			ffmpeg = spawn(
				"ffmpeg",
				[
					"-hide_banner",
					"-loglevel",
					"error",
					"-f",
					"x11grab",
					"-framerate",
					String(env.fps),
					"-draw_mouse",
					"1",
					"-video_size",
					`${w}x${h}`,
					"-i",
					`${spec.display}+${area.x},${area.y}`,
					"-c:v",
					"libx264",
					"-preset",
					"veryfast",
					"-crf",
					"18",
					"-pix_fmt",
					"yuv420p",
					"-y",
					file,
				],
				{ stdio: ["pipe", fd, fd] },
			);
			// The exit handler reports a dead ffmpeg. The "q" write at stop can fail after it.
			ffmpeg.stdin?.on("error", () => undefined);
			ffmpeg.on("exit", (code) => {
				fs.closeSync(fd);
				if (!stopping) ended.resolve(`ffmpeg x11grab exited with code ${code}: read ${logPath}`);
			});
			await sleep(500);
			if (ffmpeg.exitCode !== null)
				throw new Error(`ffmpeg x11grab exited with code ${ffmpeg.exitCode}: read ${logPath}`);
			started.resolve({
				tapSpace: { width: w, height: h },
				info: {
					display: spec.display,
					...(area.windowId ? { window: area.windowId } : {}),
					area: { ...area, width: w, height: h },
				},
			});
		} catch (error) {
			started.reject(error instanceof Error ? error : new Error(String(error)));
		}
	})();

	return {
		started: started.promise,
		ended: ended.promise,
		async stop() {
			stopping = true;
			const warnings: string[] = [];
			if (ffmpeg && ffmpeg.exitCode === null) {
				ffmpeg.stdin?.write("q");
				ffmpeg.stdin?.end();
				const code = await waitExit(ffmpeg, 15000);
				if (code !== 0 && code !== 255) warnings.push(`ffmpeg x11grab exited with code ${code}`);
			}
			return { file, warnings };
		},
	};
}

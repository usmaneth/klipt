/**
 * Record an Android device or emulator over adb.
 * scrcpy is used when it is installed (one continuous file). Else `screenrecord` runs on the device in
 * segments of at most 180 seconds (its limit), and the segments are joined.
 */

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isExecutable, type Runner, runCommand, sleep, tail, waitExit, which } from "../proc.ts";
import { type Capture, type CaptureEnv, type CaptureStart, deferred } from "./types.ts";

export type AndroidOptions = {
	serial?: string;
	adb?: string;
	backend: "auto" | "scrcpy" | "screenrecord";
	bitRate: number;
};

export const SEGMENT_LIMIT_S = 180;

export function findAdb(explicit?: string, home = os.homedir()): string | undefined {
	if (explicit) return isExecutable(explicit) ? explicit : undefined;
	const candidates = [
		process.env.ADB,
		which("adb"),
		process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, "platform-tools", "adb"),
		process.env.ANDROID_SDK_ROOT &&
			path.join(process.env.ANDROID_SDK_ROOT, "platform-tools", "adb"),
		path.join(home, "Android", "Sdk", "platform-tools", "adb"),
		path.join(home, "Library", "Android", "sdk", "platform-tools", "adb"),
	];
	return candidates.find((c): c is string => typeof c === "string" && c !== "" && isExecutable(c));
}

/** Parse `adb devices`: the serials in the "device" state. */
export function parseDevices(text: string): string[] {
	return text
		.split("\n")
		.slice(1)
		.map((l) => l.trim().split(/\s+/))
		.filter((cols) => cols.length >= 2 && cols[1] === "device")
		.map((cols) => cols[0]);
}

/** Parse `adb shell wm size`. An override size wins over the physical size. */
export function parseWmSize(text: string): { width: number; height: number } | undefined {
	const override = /Override size:\s*(\d+)x(\d+)/.exec(text);
	const physical = /Physical size:\s*(\d+)x(\d+)/.exec(text);
	const m = override ?? physical;
	return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/** The scrcpy flag that turns off the window: --no-playback from 2.1, --no-display before. */
export function scrcpyNoWindowFlag(versionText: string): string {
	const m = /scrcpy\s+v?(\d+)\.(\d+)/.exec(versionText);
	if (!m) return "--no-playback";
	const [major, minor] = [Number(m[1]), Number(m[2])];
	return major > 2 || (major === 2 && minor >= 1) ? "--no-playback" : "--no-display";
}

export async function resolveDevice(
	opts: AndroidOptions,
	run: Runner = runCommand,
): Promise<{ adb: string; serial: string; size?: { width: number; height: number } }> {
	const adb = findAdb(opts.adb);
	if (!adb)
		throw new Error("adb not found: pass --adb, set ADB or ANDROID_HOME, or put adb on PATH");
	let serial = opts.serial;
	if (!serial) {
		const r = await run([adb, "devices"]);
		const devices = parseDevices(r.out);
		if (devices.length !== 1) {
			throw new Error(
				devices.length
					? `${devices.length} devices are connected (${devices.join(", ")}): name one with android:<serial>`
					: "no Android device is connected",
			);
		}
		serial = devices[0];
	}
	const state = await run([adb, "-s", serial, "get-state"]);
	if (state.code !== 0 || state.out.trim() !== "device") {
		throw new Error(
			`device ${serial} is not ready: ${tail(state.out) || `adb exited with code ${state.code}`}`,
		);
	}
	const size = parseWmSize((await run([adb, "-s", serial, "shell", "wm", "size"])).out);
	return { adb, serial, size };
}

export function startAndroidCapture(
	opts: AndroidOptions,
	env: CaptureEnv,
	run: Runner = runCommand,
): Capture {
	const started = deferred<CaptureStart>();
	const ended = deferred<string>();
	const file = path.join(env.out, "capture.mkv");
	const logPath = path.join(env.out, "capture.log");
	const warnings: string[] = [];
	let stopping = false;
	let device: { adb: string; serial: string } | undefined;
	let scrcpy: ChildProcess | undefined;
	let segment: ChildProcess | undefined;
	const segments: string[] = [];
	const tag = `klipt-${process.pid}-${Date.now()}`;
	const startMs = Date.now();

	const adbSpawn = (d: { adb: string; serial: string }, args: string[]) => {
		const fd = fs.openSync(logPath, "a");
		const child = spawn(d.adb, ["-s", d.serial, ...args], { stdio: ["ignore", fd, fd] });
		child.on("exit", () => fs.closeSync(fd));
		return child;
	};

	const nextSegment = (d: { adb: string; serial: string }) => {
		if (stopping) return;
		const remote = `/sdcard/${tag}-${segments.length}.mp4`;
		segments.push(remote);
		segment = adbSpawn(d, [
			"shell",
			"screenrecord",
			"--time-limit",
			String(SEGMENT_LIMIT_S),
			"--bit-rate",
			String(opts.bitRate),
			remote,
		]);
		segment.on("exit", (code) => {
			if (stopping) return;
			if (code !== 0 && segments.length === 1 && Date.now() - startMs < 3000) {
				ended.resolve(`screenrecord exited with code ${code}: read ${logPath}`);
				return;
			}
			nextSegment(d);
		});
	};

	(async () => {
		try {
			const d = await resolveDevice(opts, run);
			device = d;
			const scrcpyBin = opts.backend === "screenrecord" ? undefined : which("scrcpy");
			if (opts.backend === "scrcpy" && !scrcpyBin) throw new Error("scrcpy not found on PATH");
			if (scrcpyBin) {
				const version = await run([scrcpyBin, "--version"]);
				const fd = fs.openSync(logPath, "a");
				scrcpy = spawn(
					scrcpyBin,
					[
						"-s",
						d.serial,
						scrcpyNoWindowFlag(version.out),
						"--no-audio",
						"--no-control",
						`--max-fps=${env.fps}`,
						`--record=${file}`,
						"--record-format=mkv",
					],
					{ stdio: ["ignore", fd, fd], env: { ...process.env, ADB: d.adb } },
				);
				scrcpy.on("exit", (code) => {
					fs.closeSync(fd);
					if (!stopping) ended.resolve(`scrcpy exited with code ${code}: read ${logPath}`);
				});
			} else {
				nextSegment(d);
			}
			await sleep(800);
			if (scrcpy && scrcpy.exitCode !== null)
				throw new Error(`scrcpy exited with code ${scrcpy.exitCode}: read ${logPath}`);
			started.resolve({
				tapSpace: d.size,
				info: { serial: d.serial, backend: scrcpy ? "scrcpy" : "screenrecord", adb: d.adb },
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
			if (!device) return { file, warnings: ["the device never started recording"] };
			if (scrcpy) {
				scrcpy.kill("SIGINT");
				const code = await waitExit(scrcpy, 15000);
				if (code !== 0 && code !== 2) warnings.push(`scrcpy exited with code ${code}`);
				return { file, warnings };
			}
			// SIGINT lets screenrecord write the mp4 index. Killing the local adb process does not stop it.
			await run([device.adb, "-s", device.serial, "shell", "pkill", "-2", "screenrecord"], {
				log: logPath,
			});
			if (segment) await waitExit(segment, 10000);
			await sleep(500);
			const local: string[] = [];
			for (const [i, remote] of segments.entries()) {
				const dest = path.join(env.out, `segment-${i}.mp4`);
				const r = await run([device.adb, "-s", device.serial, "pull", remote, dest], {
					log: logPath,
				});
				await run([device.adb, "-s", device.serial, "shell", "rm", "-f", remote], { log: logPath });
				if (r.code === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0) local.push(dest);
				else warnings.push(`segment ${i + 1} could not be pulled: ${tail(r.out, 1)}`);
			}
			if (!local.length) return { file, warnings: [...warnings, "no segment was recorded"] };
			const list = path.join(env.out, "segments.txt");
			fs.writeFileSync(list, local.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
			const r = await run(
				[
					"ffmpeg",
					"-y",
					"-hide_banner",
					"-loglevel",
					"error",
					"-f",
					"concat",
					"-safe",
					"0",
					"-i",
					list,
					"-c",
					"copy",
					file,
				],
				{ log: logPath },
			);
			if (r.code !== 0) warnings.push(`joining the segments failed: ${tail(r.out)}`);
			for (const f of [...local, list]) fs.rmSync(f, { force: true });
			return { file, warnings };
		},
	};
}

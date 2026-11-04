/**
 * Record one Chrome tab with the DevTools screencast. No window and no screen are needed:
 * it works on a headless Chrome, on a tab that another program drives, and on a tab that klipt opens.
 */

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { CdpSession, devtoolsHttpBase, isDevtools, jpegSize, listPages, pickPage } from "../cdp.ts";
import { even } from "../graph.ts";
import { expandHome, isExecutable, sleep, waitExit, which } from "../proc.ts";
import { type Capture, type CaptureEnv, type CaptureStart, deferred } from "./types.ts";

export type TabOptions = {
	/** ws://.../devtools/page/<id>, ws://.../devtools/browser/<id>, http://host:port, host:port, a port, or a page URL. */
	spec: string;
	/** Pick the tab whose URL or title contains this text. */
	match?: string;
	/** Viewport of a tab that klipt opens. */
	size?: { width: number; height: number };
	dpr?: number;
	chrome?: string;
	autoTaps: boolean;
	maxEdge: number;
};

const TAP_BINDING = "__kliptTap";
const TAP_SCRIPT = `(() => {
	if (window.__kliptTapHooked) return;
	window.__kliptTapHooked = true;
	addEventListener("pointerdown", (e) => {
		try { ${TAP_BINDING}(JSON.stringify({ x: e.clientX / innerWidth, y: e.clientY / innerHeight })); } catch {}
	}, true);
})()`;

export function findChrome(explicit?: string, home = os.homedir()): string | undefined {
	if (explicit) return isExecutable(expandHome(explicit)) ? expandHome(explicit) : undefined;
	for (const env of [process.env.KLIPT_CHROME, process.env.CHROME]) {
		if (env && isExecutable(env)) return env;
	}
	const caches = [
		path.join(home, ".cache", "ms-playwright"),
		path.join(home, "Library", "Caches", "ms-playwright"),
	];
	const inCache = [
		"chrome-linux-arm64/chrome",
		"chrome-linux/chrome",
		"chrome-linux64/chrome",
		"chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
		"chrome-mac/Chromium.app/Contents/MacOS/Chromium",
		"chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium",
	];
	for (const cache of caches) {
		let dirs: string[] = [];
		try {
			dirs = fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d));
		} catch {
			continue;
		}
		dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
		for (const d of dirs) {
			for (const rel of inCache) {
				const file = path.join(cache, d, rel);
				if (isExecutable(file)) return file;
			}
		}
	}
	for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
		const found = which(name);
		if (found) return found;
	}
	const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
	return isExecutable(mac) ? mac : undefined;
}

type Target = {
	session: CdpSession;
	launched?: { proc: ChildProcess; dir: string };
	info: Record<string, unknown>;
};

async function launchChrome(
	opts: TabOptions,
	logFd: number,
): Promise<{ base: string; proc: ChildProcess; dir: string }> {
	const chrome = findChrome(opts.chrome);
	if (!chrome) throw new Error("no Chrome or Chromium found: pass --chrome or set KLIPT_CHROME");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klipt-chrome-"));
	const size = opts.size ?? { width: 1280, height: 720 };
	const args = [
		"--headless=new",
		"--remote-debugging-port=0",
		`--user-data-dir=${dir}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--hide-scrollbars",
		"--mute-audio",
		`--window-size=${size.width},${size.height}`,
		...(process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : []),
		"about:blank",
	];
	const proc = spawn(chrome, args, { stdio: ["ignore", logFd, logFd] });
	const portFile = path.join(dir, "DevToolsActivePort");
	for (let i = 0; i < 150; i++) {
		if (proc.exitCode !== null)
			throw new Error(`Chrome exited with code ${proc.exitCode} before it opened DevTools`);
		if (fs.existsSync(portFile)) {
			const port = fs.readFileSync(portFile, "utf8").split("\n")[0].trim();
			if (port) return { base: `http://127.0.0.1:${port}`, proc, dir };
		}
		await sleep(100);
	}
	proc.kill("SIGKILL");
	throw new Error("Chrome did not open DevTools in 15s");
}

async function connect(opts: TabOptions, logFd: number): Promise<Target> {
	const spec = opts.spec;
	if (/^wss?:\/\//.test(spec)) {
		const session = await CdpSession.open(spec);
		if (spec.includes("/devtools/browser/")) {
			const r = await session.send("Target.getTargets");
			const infos = Array.isArray(r.targetInfos)
				? (r.targetInfos as Array<Record<string, unknown>>)
				: [];
			const pages = infos
				.filter((t) => t.type === "page")
				.map((t) => ({
					id: String(t.targetId),
					url: String(t.url),
					title: String(t.title),
					webSocketDebuggerUrl: "",
				}));
			const page = pickPage(pages, opts.match);
			if (!page)
				throw new Error(
					opts.match ? `no tab matches "${opts.match}"` : "the browser has no open tab",
				);
			await session.attach(page.id);
			return { session, info: { cdp: spec, targetId: page.id, url: page.url, title: page.title } };
		}
		return { session, info: { cdp: spec } };
	}
	const base = devtoolsHttpBase(spec);
	if (base && (/^\d+$/.test(spec) || /^[\w.-]+:\d+$/.test(spec) || (await isDevtools(base)))) {
		const pages = await listPages(base);
		const page = pickPage(pages, opts.match);
		if (!page)
			throw new Error(
				opts.match ? `no tab at ${base} matches "${opts.match}"` : `no open tab at ${base}`,
			);
		const session = await CdpSession.open(page.webSocketDebuggerUrl);
		return {
			session,
			info: { cdp: page.webSocketDebuggerUrl, targetId: page.id, url: page.url, title: page.title },
		};
	}
	if (!/^(https?|file|about|data):/.test(spec)) {
		throw new Error(`tab source "${spec}" is not a DevTools URL, a DevTools port or a page URL`);
	}
	const launched = await launchChrome(opts, logFd);
	try {
		const pages = await listPages(launched.base);
		const page = pages[0];
		if (!page) throw new Error("the new Chrome has no tab");
		const session = await CdpSession.open(page.webSocketDebuggerUrl);
		const size = opts.size ?? { width: 1280, height: 720 };
		await session.send("Emulation.setDeviceMetricsOverride", {
			width: size.width,
			height: size.height,
			deviceScaleFactor: opts.dpr ?? 1,
			mobile: false,
		});
		await session.send("Page.enable");
		await session.send("Page.navigate", { url: spec });
		const version = (await (await fetch(`${launched.base}/json/version`)).json()) as Record<
			string,
			unknown
		>;
		return {
			session,
			launched: { proc: launched.proc, dir: launched.dir },
			info: {
				cdp: page.webSocketDebuggerUrl,
				browserCdp: String(version.webSocketDebuggerUrl ?? ""),
				devtools: launched.base,
				url: spec,
			},
		};
	} catch (error) {
		launched.proc.kill("SIGKILL");
		throw error;
	}
}

export function startTabCapture(opts: TabOptions, env: CaptureEnv): Capture {
	const started = deferred<CaptureStart>();
	const ended = deferred<string>();
	const file = path.join(env.out, "capture.mkv");
	const logFd = fs.openSync(path.join(env.out, "capture.log"), "a");
	const warnings: string[] = [];
	let target: Target | undefined;
	let encoder: ChildProcess | undefined;
	let latest: Buffer | undefined;
	let t0 = 0;
	let written = 0;
	let pump: NodeJS.Timeout | undefined;
	let stopping = false;

	const writeUpTo = (now: number) => {
		if (!encoder?.stdin || !latest) return;
		const due = Math.floor(((now - t0) / 1000) * env.fps) + 1;
		while (written < due) {
			encoder.stdin.write(latest);
			written++;
		}
	};

	const startEncoder = (first: Buffer) => {
		const dims = jpegSize(first) ?? { width: 1280, height: 720 };
		const w = even(dims.width);
		const h = even(dims.height);
		encoder = spawn(
			"ffmpeg",
			[
				"-hide_banner",
				"-loglevel",
				"error",
				"-f",
				"image2pipe",
				"-framerate",
				String(env.fps),
				"-c:v",
				"mjpeg",
				"-i",
				"-",
				"-vf",
				`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
				"-c:v",
				"libx264",
				"-preset",
				"veryfast",
				"-crf",
				"18",
				"-g",
				String(env.fps * 2),
				"-y",
				file,
			],
			{ stdio: ["pipe", logFd, logFd] },
		);
		// The encoder exit handler reports a dead encoder. A write after it died is not a second error.
		encoder.stdin?.on("error", () => undefined);
		encoder.on("exit", (code) => {
			if (!stopping) ended.resolve(`the encoder exited with code ${code}`);
		});
		latest = first;
		t0 = Date.now();
		writeUpTo(t0);
		pump = setInterval(() => writeUpTo(Date.now()), Math.max(5, Math.floor(500 / env.fps)));
	};

	(async () => {
		try {
			target = await connect(opts, logFd);
			const s = target.session;
			s.onClose = () => {
				if (!stopping) ended.resolve("the tab or the DevTools connection closed");
			};
			await s.send("Page.enable");
			if (opts.autoTaps) {
				await s.send("Runtime.enable");
				await s.send("Runtime.addBinding", { name: TAP_BINDING });
				s.on("Runtime.bindingCalled", (p) => {
					if (p.name !== TAP_BINDING) return;
					try {
						const tap = JSON.parse(String(p.payload)) as { x?: unknown; y?: unknown };
						if (typeof tap.x === "number" && typeof tap.y === "number")
							env.onTap({ x: tap.x, y: tap.y }, Date.now());
					} catch {
						// A page can call the binding too. A bad payload is not a tap.
					}
				});
				await s.send("Page.addScriptToEvaluateOnNewDocument", { source: TAP_SCRIPT });
				await s.send("Runtime.evaluate", { expression: TAP_SCRIPT });
			}
			const viewport = await s.send("Runtime.evaluate", {
				expression: "JSON.stringify({ width: innerWidth, height: innerHeight })",
				returnByValue: true,
			});
			const vr = viewport.result;
			const vpText = vr && typeof vr === "object" && "value" in vr ? String(vr.value) : "{}";
			const vp: { width?: number; height?: number } = JSON.parse(vpText);
			s.on("Page.screencastFrame", (p) => {
				s.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => undefined);
				const frame = Buffer.from(String(p.data), "base64");
				if (!encoder) startEncoder(frame);
				else latest = frame;
			});
			const shot = await s.send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
			startEncoder(Buffer.from(String(shot.data), "base64"));
			await s.send("Page.startScreencast", {
				format: "jpeg",
				quality: 85,
				maxWidth: opts.maxEdge,
				maxHeight: opts.maxEdge,
				everyNthFrame: 1,
			});
			started.resolve({
				startedAtMs: t0,
				tapSpace: vp.width && vp.height ? { width: vp.width, height: vp.height } : undefined,
				info: target.info,
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
			clearInterval(pump);
			if (target && !target.session.closed) {
				await target.session.send("Page.stopScreencast").catch(() => undefined);
			}
			if (encoder) {
				writeUpTo(Date.now());
				encoder.stdin?.end();
				const code = await waitExit(encoder, 20000);
				if (code !== 0) warnings.push(`the encoder exited with code ${code}`);
			}
			target?.session.close();
			if (target?.launched) {
				target.launched.proc.kill("SIGTERM");
				await waitExit(target.launched.proc, 5000);
				fs.rmSync(target.launched.dir, { recursive: true, force: true });
			}
			fs.closeSync(logFd);
			return { file, warnings };
		},
	};
}

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { buildJob, type HeadlessJob, parseArgs } from "../../src/headless/job";

/**
 * Headless export. It runs the same exporter as the editor, in a hidden window, and writes one file.
 *
 *   electron --no-sandbox dist-electron/headless-main.js --klipt-export --input a.mp4 --output b.mp4
 *
 * It prints exactly one JSON line on stdout: {"ok":true,...} or {"ok":false,"reason":"..."}.
 * The exit code is 0 only when the file is written.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** The export is stuck when the renderer sends no progress and no log line for this long. It is not a time limit. */
const STALL_MS = Number(process.env.KLIPT_HEADLESS_STALL_MS) || 180_000;

if (process.env.KLIPT_HEADLESS_SOFTWARE_GL !== "0") {
	// There is no GPU on the host that runs this. SwiftShader draws the PixiJS scene on the CPU.
	app.commandLine.appendSwitch("ignore-gpu-blocklist");
	app.commandLine.appendSwitch("use-gl", "angle");
	app.commandLine.appendSwitch("use-angle", "swiftshader");
	app.commandLine.appendSwitch("enable-unsafe-swiftshader");
	// The exporter reads every frame back from a canvas. A GPU-backed 2D canvas on SwiftShader makes that
	// read-back stall for minutes (measured: 105 frames never finished). A CPU canvas finishes them in seconds.
	app.commandLine.appendSwitch("disable-accelerated-2d-canvas");
}

interface RendererJob extends HeadlessJob {
	inputUrl: string;
}

type Finish = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

let finished = false;

function report(payload: Record<string, unknown>, code: number): void {
	if (finished) return;
	finished = true;
	process.stdout.write(`${JSON.stringify(payload)}\n`);
	app.exit(code);
}

function fail(reason: string): void {
	report({ ok: false, reason }, 1);
}

async function readJson(file: string): Promise<unknown> {
	return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeOutput(outputPath: string, bytes: Uint8Array): Promise<void> {
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	const partial = `${outputPath}.partial`;
	await fs.writeFile(partial, bytes);
	await fs.rename(partial, outputPath);
}

async function main(): Promise<void> {
	const parsed = parseArgs(process.argv);
	if (!parsed.ok) return fail(parsed.error);

	// The two JSON files are read here so a bad file fails before a window opens.
	const files = new Map<string, unknown>();
	for (const name of [parsed.args.captions, parsed.args.zooms]) {
		if (!name) continue;
		const resolved = path.resolve(name);
		try {
			files.set(resolved, await readJson(resolved));
		} catch (error) {
			return fail(`cannot read ${resolved}: ${error instanceof Error ? error.message : error}`);
		}
	}
	const built = buildJob(parsed.args, {
		resolvePath: (value) => path.resolve(value),
		readJson: (file) => {
			if (!files.has(file)) throw new Error("file was not loaded");
			return files.get(file);
		},
	});
	if (!built.ok) return fail(built.error);
	const job = built.job;

	let inputReal: string;
	try {
		inputReal = await fs.realpath(job.inputPath);
	} catch {
		return fail(`input video not found: ${job.inputPath}`);
	}
	const rendererJob: RendererJob = { ...job, inputUrl: pathToFileURL(inputReal).href };

	await app.whenReady();

	let lastSignal = Date.now();
	let lastProgress = "no frame yet";
	const startedAt = Date.now();
	const touch = () => {
		lastSignal = Date.now();
	};

	// The renderer may read the input video and nothing else.
	ipcMain.handle("headless:read-input", async (_event, requested: string) => {
		touch();
		try {
			if ((await fs.realpath(requested)) !== inputReal) {
				return { success: false, error: "only the input video can be read" };
			}
			return { success: true, data: await fs.readFile(inputReal) };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	});
	ipcMain.handle("headless:get-job", () => rendererJob);
	ipcMain.on("headless:progress", (_event, current: number, total: number) => {
		touch();
		lastProgress = `frame ${current} of ${total}`;
	});
	ipcMain.on("headless:log", (_event, message: string) => {
		touch();
		process.stderr.write(`[headless] ${message}\n`);
	});
	ipcMain.handle("headless:finish", async (_event, result: Finish) => {
		if (!result.ok) return fail(result.error);
		try {
			await writeOutput(job.outputPath, result.bytes);
		} catch (error) {
			return fail(
				`cannot write ${job.outputPath}: ${error instanceof Error ? error.message : error}`,
			);
		}
		report(
			{
				ok: true,
				out: job.outputPath,
				bytes: result.bytes.byteLength,
				seconds: Math.round((Date.now() - startedAt) / 100) / 10,
			},
			0,
		);
	});

	const win = new BrowserWindow({
		show: false,
		width: 1280,
		height: 720,
		webPreferences: {
			preload: path.join(__dirname, "..", "electron", "headless", "preload.cjs"),
			nodeIntegration: false,
			contextIsolation: true,
			// A hidden window slows its timers to one tick a second. The exporter waits on short timers.
			backgroundThrottling: false,
		},
	});
	win.webContents.on("render-process-gone", (_event, details) => {
		fail(`the renderer stopped: ${details.reason}`);
	});
	win.webContents.on("did-fail-load", (_event, code, description) => {
		fail(`the export page did not load: ${description} (${code})`);
	});

	const watchdog = setInterval(() => {
		if (Date.now() - lastSignal > STALL_MS) {
			clearInterval(watchdog);
			fail(
				`the export is stuck: no progress for ${Math.round(STALL_MS / 1000)}s after ${lastProgress}`,
			);
		}
	}, 5000);
	watchdog.unref();

	await win.loadFile(path.join(__dirname, "..", "dist", "headless.html"));
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));

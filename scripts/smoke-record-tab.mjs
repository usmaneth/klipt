#!/usr/bin/env node
// Smoke test of the klipt CLI on a real headless Chrome tab.
//
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME=/path/to/chrome \
//     node scripts/smoke-record-tab.mjs [out-dir]
//
// It starts Chromium with a DevTools port, opens a small page, and runs:
//   klipt record --source tab:127.0.0.1:<port> --tab "klipt smoke" --detach
//   klipt mark (3 markers) while Playwright clicks the page (the clicks become taps by themselves)
//   klipt stop after 10 s
//   klipt render --preset desktop-demo
// Then it writes 3 stills: the poster (the overview grid), a caption frame and a zoom frame.
// It prints one JSON line. The exit code is 0 only when every step is ok.

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KLIPT = path.join(ROOT, "scripts", "klipt");
const out = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "klipt-smoke-")));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? "playwright-core");

const PAGE = `<!doctype html><html><head><title>klipt smoke</title><style>
body{margin:0;font:28px system-ui,sans-serif;background:#f4f1ea;color:#1d1d1d}
header{padding:28px 48px;background:#1d1d1d;color:#fff;font-size:34px}
main{padding:40px 48px} button{font-size:28px;padding:18px 34px;margin-right:24px;border-radius:12px;border:0;background:#e0000f;color:#fff}
ul{margin-top:36px} li{padding:10px 0} #sent{margin-top:30px;font-size:40px;color:#0a7d32;display:none}
</style></head><body><header>Shopping list</header><main>
<button id="add">Add item</button><button id="send">Send list</button><ul id="list"></ul><div id="sent">List sent</div>
</main><script>
let n = 0;
document.getElementById("add").onclick = () => { const li = document.createElement("li"); li.textContent = "Item " + (++n); document.getElementById("list").appendChild(li); };
document.getElementById("send").onclick = () => { document.getElementById("sent").style.display = "block"; };
</script></body></html>`;

function klipt(...args) {
	const r = spawnSync(KLIPT, args, { encoding: "utf8" });
	const line = r.stdout.trim().split("\n").pop() ?? "";
	try {
		return JSON.parse(line);
	} catch {
		return {
			ok: false,
			reason: `klipt ${args[0]} printed no JSON (exit ${r.status}): ${r.stderr.slice(-300)}`,
		};
	}
}

function freePort() {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const summary = { ok: false, out, steps: {} };
let browser;
try {
	const port = await freePort();
	browser = await chromium.launch({
		executablePath: process.env.CHROME,
		headless: true,
		args: [`--remote-debugging-port=${port}`],
	});
	const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
	await page.setContent(PAGE);

	const rec = klipt(
		"record",
		"--source",
		`tab:127.0.0.1:${port}`,
		"--tab",
		"klipt smoke",
		"--out",
		out,
		"--detach",
		"--max-s",
		"60",
		"--title",
		"klipt smoke: record a tab by CDP",
	);
	summary.steps.record = rec;
	if (!rec.ok) throw new Error(`record: ${rec.reason}`);
	const t0 = Date.now();
	const at = async (s) => {
		const wait = t0 + s * 1000 - Date.now();
		if (wait > 0) await sleep(wait);
	};

	await at(0.5);
	summary.steps.mark1 = klipt("mark", "--out", out, "--state", "Empty list");
	await at(1);
	summary.steps.mark2 = klipt("mark", "--out", out, "--caption", "Add three items to the list");
	for (const s of [2, 3, 4]) {
		await at(s);
		await page.click("#add");
	}
	await at(6);
	await page.click("#send");
	await at(8);
	summary.steps.mark3 = klipt("mark", "--out", out, "--state", "List sent");
	await at(10);
	const stop = klipt("stop", "--out", out);
	summary.steps.stop = stop;
	if (!stop.ok) throw new Error(`stop: ${stop.reason}`);

	const rendered = klipt(
		"render",
		"--input",
		out,
		"--preset",
		"desktop-demo",
		"--max-mb",
		"20",
		"--json",
	);
	summary.steps.render = rendered;
	if (!rendered.ok) throw new Error(`render: ${rendered.reason}`);

	// Stills: the poster is the overview grid. Times in the mp4 = intro (3.5 s) + raw time.
	const timeline = JSON.parse(fs.readFileSync(path.join(out, "timeline.json"), "utf8"));
	const intro = 3.5;
	const still = (name, t) => {
		const file = path.join(out, name);
		execFileSync("ffmpeg", [
			"-y",
			"-loglevel",
			"error",
			"-ss",
			t.toFixed(2),
			"-i",
			rendered.mp4,
			"-frames:v",
			"1",
			file,
		]);
		return { file, t: Number(t.toFixed(2)) };
	};
	summary.stills = {
		poster: { file: rendered.poster },
		caption: still("still-caption.png", intro + timeline.captions[0].t + 0.8),
		zoom: still("still-zoom.png", intro + timeline.taps[0].t + 0.4),
	};
	summary.ffprobe = execFileSync(
		"ffprobe",
		[
			"-v",
			"error",
			"-show_entries",
			"stream=codec_name,profile,width,height,pix_fmt,r_frame_rate:format=duration,size",
			"-of",
			"compact",
			rendered.mp4,
		],
		{ encoding: "utf8" },
	).trim();
	summary.timeline = {
		captions: timeline.captions,
		taps: timeline.taps,
		stills: timeline.overview?.stills,
	};
	summary.ok =
		[summary.steps.mark1, summary.steps.mark2, summary.steps.mark3].every((m) => m.ok) &&
		timeline.taps.length >= 4;
	if (!summary.ok) summary.reason = "a mark failed or the 4 clicks did not become taps";
} catch (error) {
	summary.reason = error instanceof Error ? error.message : String(error);
} finally {
	await browser?.close();
}
process.stdout.write(`${JSON.stringify(summary)}\n`);
process.exit(summary.ok ? 0 : 1);

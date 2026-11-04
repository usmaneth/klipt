import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	audioGraph,
	fitRect,
	gridLayout,
	PRESETS,
	presetFor,
	videoGraph,
	wrapText,
	zoomExprs,
} from "./graph.ts";
import { parseProbe } from "./proc.ts";
import { CRF_LADDER, fitUnderCap, render } from "./render.ts";
import { buildTimeMap } from "./timemap.ts";
import { synthesize } from "./voiceover.ts";

describe("fitUnderCap", () => {
	it("climbs the crf ladder until the file fits", async () => {
		const sizes: Record<number, number> = { 23: 30e6, 27: 22e6, 31: 18e6 };
		let last = 0;
		const fit = await fitUnderCap(
			async (crf) => {
				last = crf;
				return "";
			},
			() => sizes[last] ?? 0,
			20e6,
		);
		expect(fit).toEqual({ ok: true, crf: 31, bytes: 18e6, reason: "", tries: [23, 27, 31] });
	});

	it("fails with the size at the last crf when nothing fits", async () => {
		const fit = await fitUnderCap(
			async () => "",
			() => 25e6,
			20e6,
		);
		expect(fit.ok).toBe(false);
		expect(fit.tries).toEqual(CRF_LADDER);
		expect(fit.reason).toBe(
			"cannot fit under 20.0 MB: 25.0 MB at crf 38; cut or speed up the recording, or raise --max-mb",
		);
	});

	it("stops at the first encoder failure", async () => {
		const fit = await fitUnderCap(
			async (crf) => (crf === 27 ? "ffmpeg failed" : ""),
			() => 25e6,
			20e6,
		);
		expect(fit).toMatchObject({ ok: false, crf: 27, reason: "ffmpeg failed", tries: [23, 27] });
	});

	it("encodes once when there is no cap", async () => {
		const fit = await fitUnderCap(
			async () => "",
			() => 99e6,
			0,
		);
		expect(fit).toMatchObject({ ok: true, crf: 23, tries: [23] });
	});
});

describe("layout", () => {
	it("picks the preset from the aspect when it is auto", () => {
		expect(presetFor("auto", 1080, 2400)?.name).toBe("phone-demo");
		expect(presetFor(undefined, 1280, 720)?.name).toBe("desktop-demo");
		expect(presetFor("nope", 1, 1)).toBeUndefined();
	});

	it("fits a video into the preset box with even sizes", () => {
		const r = fitRect(1280, 720, PRESETS["desktop-demo"].box);
		expect(r.w % 2).toBe(0);
		expect(r.h % 2).toBe(0);
		expect(r.w).toBeLessThanOrEqual(1792);
		expect(r.h).toBeLessThanOrEqual(984);
		expect(Math.abs(r.w / r.h - 16 / 9)).toBeLessThan(0.01);
	});

	it("lays 4 landscape stills out as 2 by 2 and 3 portrait stills in one row on a wide card", () => {
		const four = gridLayout(4, 16 / 9, { x: 0, y: 0, w: 1800, h: 900 }, 40, 50);
		expect(new Set(four.map((r) => r.y)).size).toBe(2);
		const three = gridLayout(3, 9 / 19.5, { x: 0, y: 0, w: 1800, h: 900 }, 30, 50);
		expect(new Set(three.map((r) => r.y)).size).toBe(1);
		for (const r of [...four, ...three]) {
			expect(r.x).toBeGreaterThanOrEqual(0);
			expect(r.x + r.w).toBeLessThanOrEqual(1800);
		}
	});

	it("wraps text into lines and marks a cut-off end", () => {
		expect(wrapText("open the invite sheet and send it", 12)).toEqual([
			"open the",
			"invite sheet",
			"and send it",
		]);
		expect(wrapText("one two three four five six", 9, 2)).toEqual(["one two", "three..."]);
	});
});

describe("filter graphs", () => {
	it("eases each zoom in and out and keeps the focus inside the frame", () => {
		const z = zoomExprs([{ t: 1, x: 0.2, y: 0.8, scale: 1.6, dur: 1.2 }]);
		expect(z.z).toContain("st(0,clip(min((it-1)/0.4,(2.2-it)/0.4),0,1))");
		expect(z.x).toMatch(/^clip\(.*,0,iw-iw\/zoom\)$/);
		expect(zoomExprs([]).z).toBe("1");
	});

	it("chains rings, zoom, cuts, remap, frame, captions and the intro", () => {
		const map = buildTimeMap(10, [{ from: 2, to: 3 }], []);
		const g = videoGraph({
			raw: { width: 1280, height: 720 },
			preset: PRESETS["desktop-demo"],
			frame: fitRect(1280, 720, PRESETS["desktop-demo"].box),
			zooms: [{ t: 4, x: 0.5, y: 0.5, scale: 1.6, dur: 1.2 }],
			taps: [{ t: 4.3, x: 0.5, y: 0.5 }],
			ringSize: 64,
			cutSelect: "not(between(t,2,2.999999))",
			map,
			remap: true,
			captionLines: [{ file: "/tmp/c.txt", line: 0, lines: 1, start: 1, end: 2 }],
			font: "/tmp/font.ttf",
			inputs: { raw: 0, cover: 1, ring: 2, intro: 3 },
		});
		for (const part of [
			"[2:v]null[ring0]",
			"overlay=x=608:y=328",
			"zoompan=",
			"select=",
			"setpts=",
			"tpad",
			"drawtext",
			"concat=n=2",
		]) {
			if (part === "tpad") expect(g).not.toContain(part);
			else expect(g).toContain(part);
		}
		expect(g.endsWith("[vout]")).toBe(true);
	});

	it("has no audio graph when there is no audio, and delays each voice clip past the intro", () => {
		const map = buildTimeMap(10, [], []);
		expect(
			audioGraph({
				introSeconds: 3,
				total: 13,
				map,
				rawAudio: false,
				rawIndex: 0,
				voice: [],
				duck: 0.25,
			}),
		).toBeUndefined();
		const a = audioGraph({
			introSeconds: 3,
			total: 13,
			map,
			rawAudio: true,
			rawIndex: 0,
			voice: [{ input: 4, start: 1.5, seconds: 2 }],
			duck: 0.25,
		});
		expect(a).toContain("[4:a]");
		expect(a).toContain("adelay=4500|4500");
		expect(a).toContain("volume=0.25:enable='between(t,4.5,6.5)'");
		expect(a).toContain("amix=inputs=2");
		expect(a?.endsWith("[aout]")).toBe(true);
	});
});

describe("synthesize", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klipt-voice-test-"));
	afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
	const vo = { endpoint: "http://tts.test/tts", voice: "ava" };
	const captions = [
		{ t: 1, text: "one" },
		{ t: 3, text: "two" },
	];

	it("writes one clip per caption with its length", async () => {
		const bodies: unknown[] = [];
		const fakeFetch = (async (_url: string, init?: RequestInit) => {
			bodies.push(JSON.parse(String(init?.body)));
			return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/wav" } });
		}) as typeof fetch;
		const r = await synthesize(vo, captions, dir, {
			fetch: fakeFetch,
			timeoutMs: 1000,
			duration: async () => 1.25,
		});
		expect(r.status).toBe("ok: 2 clips, voice ava");
		expect(r.clips.map((c) => [path.basename(c.file), c.seconds])).toEqual([
			["voice-0.wav", 1.25],
			["voice-1.wav", 1.25],
		]);
		expect(bodies).toEqual([
			{ text: "one", voice: "ava" },
			{ text: "two", voice: "ava" },
		]);
	});

	it("reads base64 audio from a JSON answer", async () => {
		const fakeFetch = (async () =>
			Response.json({
				audio: Buffer.from("abc").toString("base64"),
				format: "mp3",
			})) as typeof fetch;
		const r = await synthesize(vo, captions.slice(0, 1), dir, {
			fetch: fakeFetch,
			timeoutMs: 1000,
			duration: async () => 2,
		});
		expect(path.extname(r.clips[0].file)).toBe(".mp3");
		expect(fs.readFileSync(r.clips[0].file, "utf8")).toBe("abc");
	});

	it("skips the whole voiceover when the endpoint is down or answers an error", async () => {
		const down = (async () => {
			throw Object.assign(new TypeError("fetch failed"), {
				cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
			});
		}) as typeof fetch;
		const r1 = await synthesize(vo, captions, dir, {
			fetch: down,
			timeoutMs: 1000,
			duration: async () => 1,
		});
		expect(r1).toEqual({
			clips: [],
			status: "skipped: http://tts.test/tts did not answer: ECONNREFUSED",
		});
		const error = (async () => new Response("model not loaded", { status: 503 })) as typeof fetch;
		const r2 = await synthesize(vo, captions, dir, {
			fetch: error,
			timeoutMs: 1000,
			duration: async () => 1,
		});
		expect(r2.status).toBe("skipped: http://tts.test/tts answered HTTP 503: model not loaded");
	});

	it("skips when there is nothing to speak", async () => {
		const r = await synthesize(vo, [], dir, {
			fetch: fetch,
			timeoutMs: 1000,
			duration: async () => 1,
		});
		expect(r.status).toBe("skipped: the timeline has no captions to speak");
	});
});

describe("render result on failure", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klipt-render-fail-"));
	afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

	it("returns every result field with ok false and a reason", async () => {
		const r = await render({ input: path.join(dir, "missing.mp4"), maxMb: 20 });
		expect(Object.keys(r).sort()).toEqual(
			[
				"bytes",
				"crf",
				"height",
				"mp4",
				"ok",
				"poster",
				"preset",
				"reason",
				"seconds",
				"warnings",
				"width",
			].sort(),
		);
		expect(r.ok).toBe(false);
		expect(r.mp4).toBe("");
		expect(r.reason).toMatch(/input not found|ffmpeg and ffprobe must be on PATH/);
	});
});

const ffmpegReady =
	spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout?.includes(
		"drawtext",
	) ?? false;

function ff(args: string[]): void {
	const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], {
		encoding: "utf8",
	});
	if (r.status !== 0) throw new Error(r.stderr);
}

function probeFile(file: string) {
	const r = spawnSync(
		"ffprobe",
		["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file],
		{
			encoding: "utf8",
		},
	);
	return parseProbe(r.stdout);
}

describe.skipIf(!ffmpegReady)("render with ffmpeg", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "klipt-render-test-"));
	const clip = path.join(dir, "raw.mp4");
	const noisy = path.join(dir, "noisy.mp4");
	let server: http.Server | undefined;
	let wav = "";

	beforeAll(() => {
		ff([
			"-f",
			"lavfi",
			"-i",
			"testsrc2=s=640x360:r=30:d=6",
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-pix_fmt",
			"yuv420p",
			clip,
		]);
		ff([
			"-f",
			"lavfi",
			"-i",
			"testsrc2=s=1280x720:r=30:d=3",
			"-vf",
			"noise=alls=90:allf=t+u",
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-crf",
			"10",
			"-pix_fmt",
			"yuv420p",
			noisy,
		]);
		wav = path.join(dir, "voice.wav");
		ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=2.5", wav]);
	});
	afterAll(() => {
		server?.close();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("renders title, overview grid, captions, taps, a cut and a speed-up into a Slack-ready mp4", async () => {
		const timeline = path.join(dir, "timeline.json");
		fs.writeFileSync(
			timeline,
			JSON.stringify({
				title: { text: "Render test", subtitle: "testsrc2" },
				overview: {
					seconds: 2,
					stills: [
						{ t: 0.5, label: "Start" },
						{ t: 5, label: "End" },
					],
				},
				captions: [{ t: 0.5, text: "First step" }],
				taps: [{ t: 1.5, x: 0.3, y: 0.3 }],
				cuts: [{ from: 2, to: 3 }],
				speed: [{ from: 3, to: 5, factor: 2 }],
			}),
		);
		const r = await render({ input: clip, timeline, out: path.join(dir, "demo.mp4"), maxMb: 20 });
		expect(r.reason).toBe("");
		expect(r.ok).toBe(true);
		expect(r.preset).toBe("desktop-demo");
		expect([r.width, r.height]).toEqual([1920, 1080]);
		// 2 s intro + 2 s + (6 - 3) s with 2 s at double speed = 2 + 2 + 1 + 1 = 6 s.
		expect(r.seconds).toBeGreaterThan(5.7);
		expect(r.seconds).toBeLessThan(6.3);
		expect(fs.existsSync(r.poster)).toBe(true);
		const info = probeFile(r.mp4);
		expect(info?.codec).toBe("h264");
		expect(info?.pixFmt).toBe("yuv420p");
		expect(info?.hasAudio).toBe(false);
	}, 180_000);

	it("re-encodes at a higher crf to fit the size cap", async () => {
		const free = await render({ input: noisy, out: path.join(dir, "free.mp4"), maxMb: 0 });
		expect(free.ok).toBe(true);
		expect(free.crf).toBe(23);
		const capMb = (free.bytes * 0.6) / 1e6;
		const capped = await render({ input: noisy, out: path.join(dir, "capped.mp4"), maxMb: capMb });
		expect(capped.reason).toBe("");
		expect(capped.ok).toBe(true);
		expect(capped.crf).toBeGreaterThan(23);
		expect(capped.bytes).toBeLessThanOrEqual(capMb * 1e6);
		expect(capped.warnings.join(" ")).toContain("re-encoded at crf 23, 27");
	}, 240_000);

	it("fails with a reason when the cap cannot be met", async () => {
		const r = await render({ input: noisy, out: path.join(dir, "tiny.mp4"), maxMb: 0.001 });
		expect(r.ok).toBe(false);
		expect(r.reason).toContain("cannot fit under 0.0 MB");
		expect(fs.existsSync(path.join(dir, "tiny.mp4"))).toBe(false);
	}, 240_000);

	it("renders without the voice when the TTS endpoint is down, and says so", async () => {
		const timeline = path.join(dir, "vo-down.json");
		fs.writeFileSync(
			timeline,
			JSON.stringify({
				captions: [{ t: 1, text: "Hello" }],
				voiceover: { endpoint: "http://127.0.0.1:9/tts", voice: "x" },
			}),
		);
		const r = await render({
			input: clip,
			timeline,
			out: path.join(dir, "vo-down.mp4"),
			maxMb: 20,
			ttsTimeoutS: 5,
		});
		expect(r.ok).toBe(true);
		expect(r.voiceover).toMatch(/^skipped: http:\/\/127\.0\.0\.1:9\/tts did not answer/);
		expect(probeFile(r.mp4)?.hasAudio).toBe(false);
	}, 180_000);

	it("speaks each caption, freezes the frame while the voice runs long, and writes AAC", async () => {
		const requests: unknown[] = [];
		server = http.createServer((req, res) => {
			let body = "";
			req.on("data", (d) => {
				body += d;
			});
			req.on("end", () => {
				requests.push(JSON.parse(body));
				res.writeHead(200, { "content-type": "audio/wav" });
				res.end(fs.readFileSync(wav));
			});
		});
		await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
		const port = (server.address() as AddressInfo).port;
		const timeline = path.join(dir, "vo.json");
		fs.writeFileSync(
			timeline,
			JSON.stringify({
				captions: [
					{ t: 1, text: "First" },
					{ t: 2, text: "Second" },
				],
				voiceover: { endpoint: `http://127.0.0.1:${port}/tts`, voice: "ava" },
			}),
		);
		const r = await render({ input: clip, timeline, out: path.join(dir, "vo.mp4"), maxMb: 20 });
		expect(r.reason).toBe("");
		expect(r.voiceover).toBe("ok: 2 clips, voice ava");
		expect(requests).toEqual([
			{ text: "First", voice: "ava" },
			{ text: "Second", voice: "ava" },
		]);
		const info = probeFile(r.mp4);
		expect(info?.hasAudio).toBe(true);
		// Clip 1 needs 2.5 + 0.3 s from t=1, so the frame before t=2 freezes for 1.8 s. Clip 2 ends before the video.
		expect(r.seconds).toBeGreaterThan(6 + 1.8 - 0.2);
		expect(r.seconds).toBeLessThan(6 + 1.8 + 0.3);
		const audio = spawnSync(
			"ffprobe",
			[
				"-v",
				"error",
				"-select_streams",
				"a",
				"-show_entries",
				"stream=codec_name",
				"-of",
				"csv=p=0",
				r.mp4,
			],
			{
				encoding: "utf8",
			},
		);
		expect(audio.stdout.trim()).toBe("aac");
	}, 180_000);
});

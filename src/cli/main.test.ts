import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { devtoolsHttpBase, jpegSize, pickPage } from "./cdp.ts";
import { run } from "./main.ts";
import { FILES, MarkerTail, parseSource, prepareOut, timeMarkers } from "./record.ts";
import { parseDevices, parseWmSize, scrcpyNoWindowFlag } from "./sources/android.ts";
import { parseX11Spec, parseXwininfo } from "./sources/x11.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "klipt-cli-test-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function freshDir(name: string): string {
	const dir = path.join(tmp, name);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

describe("result JSON and exit codes", () => {
	it("exits 2 with a reason and the usage on bad usage", async () => {
		const r = await run(["render", "--inptu", "x.mp4"]);
		expect(r.code).toBe(2);
		expect(r.json).toMatchObject({ ok: false, reason: "unknown option --inptu" });
		expect(String(r.json.usage)).toContain("klipt render");
		expect((await run(["record", "--out", tmp])).json.reason).toBe("--source is required");
		expect((await run(["record", "--source", "vnc:1", "--out", tmp])).json.reason).toContain(
			'unknown source "vnc:1"',
		);
		expect((await run(["frobnicate"])).code).toBe(2);
		expect((await run(["render", "--input", "a", "--max-mb", "big"])).json.reason).toBe(
			'--max-mb must be a number, got "big"',
		);
	});

	it("exits 1 with the full render result when the render fails", async () => {
		const r = await run(["render", "--input", path.join(tmp, "nope.mp4"), "--json"]);
		expect(r.code).toBe(1);
		expect(r.json).toMatchObject({
			ok: false,
			mp4: "",
			poster: "",
			seconds: 0,
			bytes: 0,
			width: 0,
			height: 0,
		});
		expect(String(r.json.reason)).toMatch(/input not found|ffmpeg and ffprobe/);
	});

	it("names the bad field of a timeline", async () => {
		const timeline = path.join(tmp, "bad.json");
		fs.writeFileSync(timeline, JSON.stringify({ captions: [{ t: "1", text: "a" }] }));
		const clip = path.join(tmp, "clip.mp4");
		fs.writeFileSync(clip, "not a video");
		const r = await run(["render", "--input", clip, "--timeline", timeline]);
		expect(r.code).toBe(1);
		expect(String(r.json.reason)).toMatch(
			/timeline: captions\[0\]\.t must be a number|ffprobe cannot read|ffmpeg and ffprobe/,
		);
	});

	it("fails a record cleanly when the DevTools port does not answer", async () => {
		const out = freshDir("no-devtools");
		const r = await run(["record", "--source", "tab:127.0.0.1:9", "--out", out, "--max-s", "5"]);
		expect(r.code).toBe(1);
		expect(r.json.ok).toBe(false);
		expect(String(r.json.reason)).toMatch(
			/no DevTools at http:\/\/127\.0\.0\.1:9|ffmpeg and ffprobe/,
		);
		if (fs.existsSync(path.join(out, FILES.session))) {
			expect(JSON.parse(fs.readFileSync(path.join(out, FILES.session), "utf8")).state).toBe(
				"failed",
			);
		}
	});

	it("fails stop when the folder has no recording", async () => {
		const r = await run(["stop", "--out", freshDir("empty")]);
		expect(r).toMatchObject({ code: 1, json: { ok: false } });
	});
});

describe("klipt mark", () => {
	it("appends one marker line with a timestamp", async () => {
		const out = freshDir("mark");
		fs.writeFileSync(
			path.join(out, FILES.session),
			JSON.stringify({ state: "recording", startedAtMs: Date.now() - 2000 }),
		);
		const r = await run(["mark", "--out", out, "--caption", "Open the sheet"]);
		expect(r.code).toBe(0);
		expect(Number(r.json.t)).toBeGreaterThanOrEqual(2);
		await run(["mark", "--out", out, "--tap", "0.5, 0.25"]);
		await run(["mark", "--out", out, "--state", "Done", "--t", "4"]);
		const lines = fs
			.readFileSync(path.join(out, FILES.markers), "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines[0]).toMatchObject({ caption: "Open the sheet" });
		expect(typeof lines[0].ts).toBe("number");
		expect(lines[1].tap).toEqual({ x: 0.5, y: 0.25 });
		expect(lines[2]).toEqual({ state: "Done", t: 4 });
	});

	it("needs exactly one marker", async () => {
		const out = freshDir("mark2");
		expect((await run(["mark", "--out", out])).code).toBe(2);
		expect((await run(["mark", "--out", out, "--caption", "a", "--state", "b"])).code).toBe(2);
		expect((await run(["mark", "--out", out, "--json", '{"cut":"x"}'])).json.reason).toBe(
			"bad marker: cut must be true or false",
		);
	});
});

describe("record helpers", () => {
	it("parses each source", () => {
		expect(parseSource("tab:ws://127.0.0.1:9222/devtools/page/AB")).toEqual({
			kind: "tab",
			spec: "ws://127.0.0.1:9222/devtools/page/AB",
		});
		expect(parseSource("android:emulator-5554")).toEqual({
			kind: "android",
			serial: "emulator-5554",
		});
		expect(parseSource("android")).toEqual({ kind: "android" });
		expect(parseSource("x11::99:0x1a00007")).toEqual({
			kind: "x11",
			x11: { display: ":99", window: "0x1a00007" },
		});
		expect(parseSource("file:raw.webm")).toEqual({ kind: "file", path: path.resolve("raw.webm") });
		expect(() => parseSource("tab:")).toThrow("tab: needs");
	});

	it("reads markers as they are appended, stamps lines with no time, and sees the stop marker", () => {
		const file = path.join(freshDir("tail"), FILES.markers);
		fs.writeFileSync(file, '{"caption":"a"}\n{"tap":{"x":0.1');
		const tail = new MarkerTail(file);
		expect(tail.poll(1000)).toBe(false);
		expect(tail.items).toHaveLength(1);
		fs.appendFileSync(file, ',"y":0.2}}\nnot json\n{"stop":true}\n');
		expect(tail.poll(2000)).toBe(true);
		expect(tail.items.map((i) => [i.marker.kind, i.readAtMs])).toEqual([
			["caption", 1000],
			["tap", 2000],
			["stop", 2000],
		]);
		expect(tail.warnings).toEqual(["markers.jsonl line 3 ignored: is not JSON"]);
		const timed = timeMarkers(tail.items, 500, []);
		expect(timed.map((m) => m.t)).toEqual([0.5, 1.5, 1.5]);
	});

	it("drops markers with no time when the start is not known", () => {
		const warnings: string[] = [];
		const timed = timeMarkers(
			[
				{ marker: { kind: "caption", text: "a" }, line: 1 },
				{ marker: { kind: "caption", text: "b", t: 2 }, line: 2 },
			],
			undefined,
			warnings,
		);
		expect(timed).toEqual([{ kind: "caption", text: "b", t: 2 }]);
		expect(warnings[0]).toContain("line 1 ignored");
	});

	it("refuses a folder with a recording unless forced", () => {
		const out = freshDir("prepare");
		fs.writeFileSync(path.join(out, FILES.raw), "x");
		expect(() => prepareOut(out, false)).toThrow("already holds a recording");
		fs.writeFileSync(path.join(out, FILES.markers), "{}\n");
		prepareOut(out, true);
		expect(fs.readdirSync(out)).toEqual([]);
	});
});

describe("source parsers", () => {
	it("parses adb output", () => {
		expect(
			parseDevices("List of devices attached\nemulator-5554\tdevice\nR58M\tunauthorized\n\n"),
		).toEqual(["emulator-5554"]);
		expect(parseWmSize("Physical size: 1080x2400\nOverride size: 720x1600\n")).toEqual({
			width: 720,
			height: 1600,
		});
		expect(parseWmSize("Physical size: 1080x2400")).toEqual({ width: 1080, height: 2400 });
		expect(scrcpyNoWindowFlag("scrcpy 2.0 <https://github.com/Genymobile/scrcpy>")).toBe(
			"--no-display",
		);
		expect(scrcpyNoWindowFlag("scrcpy 3.1")).toBe("--no-playback");
	});

	it("parses x11 specs and xwininfo", () => {
		expect(parseX11Spec(":99")).toEqual({ display: ":99" });
		expect(parseX11Spec("99.0:Chromium")).toEqual({ display: ":99.0", window: "Chromium" });
		expect(parseX11Spec("nope")).toBeUndefined();
		const info =
			"  Absolute upper-left X:  10\n  Absolute upper-left Y:  -4\n  Width: 801\n  Height: 600\n";
		expect(parseXwininfo(info)).toEqual({ x: 10, y: -4, width: 801, height: 600 });
	});

	it("reads DevTools endpoints, picks a tab, and reads a JPEG size", () => {
		expect(devtoolsHttpBase("9222")).toBe("http://127.0.0.1:9222");
		expect(devtoolsHttpBase("spark1:9222")).toBe("http://spark1:9222");
		expect(devtoolsHttpBase("http://127.0.0.1:9222/json")).toBe("http://127.0.0.1:9222");
		const pages = [
			{ id: "1", url: "devtools://x", title: "DevTools", webSocketDebuggerUrl: "" },
			{ id: "2", url: "https://app.slack.com/client", title: "Slack", webSocketDebuggerUrl: "" },
			{ id: "3", url: "http://localhost:3000/admin", title: "Admin", webSocketDebuggerUrl: "" },
		];
		expect(pickPage(pages)?.id).toBe("2");
		expect(pickPage(pages, "admin")?.id).toBe("3");
		expect(pickPage(pages, "nothing")).toBeUndefined();
		// SOI, APP0 of 16 bytes, SOF0 with height 720 and width 1280.
		const jpeg = Buffer.from([
			0xff,
			0xd8,
			0xff,
			0xe0,
			0x00,
			0x10,
			...new Array(14).fill(0),
			0xff,
			0xc0,
			0x00,
			0x11,
			0x08,
			0x02,
			0xd0,
			0x05,
			0x00,
			0x03,
			0,
			0,
			0,
		]);
		expect(jpegSize(jpeg)).toEqual({ width: 1280, height: 720 });
	});
});

const ffmpegReady = spawnSync("ffmpeg", ["-version"]).status === 0;

describe.skipIf(!ffmpegReady)("record from a file", () => {
	it("normalizes the file and turns timed markers into timeline.json", async () => {
		const clip = path.join(tmp, "in.mp4");
		spawnSync("ffmpeg", [
			"-y",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=s=641x361:r=24:d=4",
			"-pix_fmt",
			"yuv420p",
			clip,
		]);
		const out = freshDir("from-file");
		fs.writeFileSync(
			path.join(out, FILES.markers),
			[
				'{"title":"File demo","t":0}',
				'{"caption":"Step one","t":0.5}',
				'{"tap":{"x":320,"y":180},"t":1}',
				'{"state":"Done","t":3}',
				'{"caption":"no time"}',
			].join("\n"),
		);
		const r = await run(["record", "--source", `file:${clip}`, "--out", out]);
		expect(r.json.reason).toBe("");
		expect(r.code).toBe(0);
		expect(r.json).toMatchObject({
			ok: true,
			width: 640,
			height: 360,
			markers: 4,
			stoppedBy: "end of file",
		});
		const tl = JSON.parse(fs.readFileSync(path.join(out, FILES.timeline), "utf8"));
		expect(tl.title).toEqual({ text: "File demo" });
		expect(tl.captions).toEqual([{ t: 0.5, text: "Step one" }]);
		expect(tl.taps[0].x).toBeCloseTo(0.5, 2);
		expect(tl.overview.stills).toEqual([{ t: 3, label: "Done" }]);
		expect((r.json.warnings as string[]).join(" ")).toContain("line 5 ignored");
		const again = await run(["record", "--source", `file:${clip}`, "--out", out]);
		expect(again.code).toBe(1);
		expect(String(again.json.reason)).toContain("already holds a recording");
	}, 60_000);
});

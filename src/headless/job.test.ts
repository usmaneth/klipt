import { describe, expect, it } from "vitest";
import { ARGS_MARKER, buildJob, MAX_TITLE_CHARS, parseArgs } from "./job";

const base = ["electron", "main.js", "--no-sandbox", ARGS_MARKER];

describe("parseArgs", () => {
	it("reads every option after the marker and ignores the Chromium switches before it", () => {
		const result = parseArgs([
			...base,
			"--input",
			"in.mp4",
			"--output=out.mp4",
			"--preset",
			"phone-demo",
			"--title",
			"group chat picks",
			"--captions",
			"c.json",
			"--zooms",
			"z.json",
		]);
		expect(result).toEqual({
			ok: true,
			args: {
				input: "in.mp4",
				output: "out.mp4",
				preset: "phone-demo",
				title: "group chat picks",
				captions: "c.json",
				zooms: "z.json",
			},
		});
	});

	it("fails without the marker", () => {
		expect(parseArgs(["electron", "main.js", "--input", "a"])).toMatchObject({ ok: false });
	});

	it("fails on a missing required option", () => {
		expect(parseArgs([...base, "--output", "o.mp4"])).toEqual({
			ok: false,
			error: "--input is required",
		});
		expect(parseArgs([...base, "--input", "i.mp4"])).toEqual({
			ok: false,
			error: "--output is required",
		});
	});

	it("fails on an unknown option instead of ignoring a typo", () => {
		expect(parseArgs([...base, "--input", "i", "--output", "o", "--captons", "c.json"])).toEqual({
			ok: false,
			error: "unknown option: --captons",
		});
	});

	it("fails on a repeated option, a bare word and a missing value", () => {
		expect(parseArgs([...base, "--input", "a", "--input", "b", "--output", "o"])).toMatchObject({
			ok: false,
			error: "--input is given twice",
		});
		expect(parseArgs([...base, "stray"])).toMatchObject({ ok: false });
		expect(parseArgs([...base, "--input"])).toEqual({ ok: false, error: "--input needs a value" });
		expect(parseArgs([...base, "--input", "--output", "o"])).toEqual({
			ok: false,
			error: "--input needs a value",
		});
	});
});

const deps = (files: Record<string, unknown> = {}) => ({
	resolvePath: (value: string) => (value.startsWith("/") ? value : `/work/${value}`),
	readJson: (path: string) => {
		if (!(path in files)) throw new Error(`ENOENT ${path}`);
		return files[path];
	},
});

describe("buildJob", () => {
	it("builds a job with absolute paths and the default preset", () => {
		const result = buildJob({ input: "in.mp4", output: "/out/o.mp4" }, deps());
		expect(result).toEqual({
			ok: true,
			job: {
				inputPath: "/work/in.mp4",
				outputPath: "/out/o.mp4",
				preset: "phone-demo",
				title: undefined,
				captions: [],
				zooms: [],
			},
		});
	});

	it("reads the caption and zoom files", () => {
		const captions = [{ t: 0, text: "hello" }];
		const zooms = [{ t: 1, x: 0.5, y: 0.5, scale: 1.5, dur: 2 }];
		const result = buildJob(
			{ input: "i", output: "o", captions: "c.json", zooms: "z.json" },
			deps({ "/work/c.json": captions, "/work/z.json": zooms }),
		);
		expect(result).toMatchObject({ ok: true, job: { captions, zooms } });
	});

	it("rejects an unknown preset", () => {
		expect(buildJob({ input: "i", output: "o", preset: "wide" }, deps())).toEqual({
			ok: false,
			error: "unknown preset: wide (known: phone-demo)",
		});
	});

	it("rejects a file that is missing or is not a list", () => {
		const missing = buildJob({ input: "i", output: "o", captions: "c.json" }, deps());
		expect(missing).toMatchObject({ ok: false });
		expect((missing as { error: string }).error).toMatch(/captions file cannot be read/);
		const notList = buildJob(
			{ input: "i", output: "o", zooms: "z.json" },
			deps({ "/work/z.json": { t: 1 } }),
		);
		expect(notList).toEqual({ ok: false, error: "zooms file must hold a JSON array" });
	});

	it("rejects a bad caption or zoom entry before any window opens", () => {
		const result = buildJob(
			{ input: "i", output: "o", zooms: "z.json" },
			deps({ "/work/z.json": [{ t: "soon", x: 0.5, y: 0.5, scale: 1.5, dur: 2 }] }),
		);
		expect(result).toMatchObject({ ok: false });
		expect((result as { error: string }).error).toMatch(/zooms\[0\]\.t/);
	});

	it("collapses white space in the title and limits its length", () => {
		const ok = buildJob({ input: "i", output: "o", title: "  group \n chat  " }, deps());
		expect(ok).toMatchObject({ ok: true, job: { title: "group chat" } });
		const long = buildJob(
			{ input: "i", output: "o", title: "x".repeat(MAX_TITLE_CHARS + 1) },
			deps(),
		);
		expect(long).toMatchObject({ ok: false });
	});
});

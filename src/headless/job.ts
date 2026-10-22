import {
	type CaptionInput,
	captionsToCues,
	ScheduleError,
	type ZoomInput,
	zoomsToRegions,
} from "./schedule";

/** The command line marks where the export options start. Chromium switches come before it. */
export const ARGS_MARKER = "--klipt-export";

export const PRESET_NAMES = ["phone-demo"] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

const OPTION_NAMES = ["input", "output", "preset", "title", "captions", "zooms"] as const;
type OptionName = (typeof OPTION_NAMES)[number];

export const MAX_TITLE_CHARS = 120;

export type RawArgs = Partial<Record<OptionName, string>>;

export type ParseResult = { ok: true; args: RawArgs } | { ok: false; error: string };

/**
 * Read the export options from the process arguments.
 * An unknown option is an error: a typo must never be ignored without a word.
 */
export function parseArgs(argv: string[]): ParseResult {
	const start = argv.indexOf(ARGS_MARKER);
	if (start < 0) return { ok: false, error: `${ARGS_MARKER} is missing` };

	const args: RawArgs = {};
	const rest = argv.slice(start + 1);
	for (let i = 0; i < rest.length; i++) {
		const token = rest[i];
		if (!token.startsWith("--")) return { ok: false, error: `unexpected argument: ${token}` };
		const eq = token.indexOf("=");
		const name = eq > 0 ? token.slice(2, eq) : token.slice(2);
		if (!(OPTION_NAMES as readonly string[]).includes(name)) {
			return { ok: false, error: `unknown option: --${name}` };
		}
		let value: string | undefined;
		if (eq > 0) {
			value = token.slice(eq + 1);
		} else {
			value = rest[i + 1];
			if (value === undefined || value.startsWith("--")) {
				return { ok: false, error: `--${name} needs a value` };
			}
			i++;
		}
		if (args[name as OptionName] !== undefined) {
			return { ok: false, error: `--${name} is given twice` };
		}
		args[name as OptionName] = value;
	}

	if (!args.input) return { ok: false, error: "--input is required" };
	if (!args.output) return { ok: false, error: "--output is required" };
	return { ok: true, args };
}

export interface HeadlessJob {
	inputPath: string;
	outputPath: string;
	preset: PresetName;
	title?: string;
	captions: CaptionInput[];
	zooms: ZoomInput[];
}

export type JobResult = { ok: true; job: HeadlessJob } | { ok: false; error: string };

export interface JobDeps {
	/** Make a path absolute against the working directory. */
	resolvePath: (value: string) => string;
	/** Read and parse a JSON file. It throws when the file is missing or not JSON. */
	readJson: (path: string) => unknown;
}

function readList(deps: JobDeps, label: string, file: string | undefined): unknown[] | string {
	if (!file) return [];
	let data: unknown;
	try {
		data = deps.readJson(deps.resolvePath(file));
	} catch (error) {
		return `${label} file cannot be read: ${error instanceof Error ? error.message : String(error)}`;
	}
	if (!Array.isArray(data)) return `${label} file must hold a JSON array`;
	return data;
}

/** Check the options and the two JSON files, and build the job. Nothing is rendered here. */
export function buildJob(args: RawArgs, deps: JobDeps): JobResult {
	const presetName = args.preset ?? "phone-demo";
	if (!(PRESET_NAMES as readonly string[]).includes(presetName)) {
		return {
			ok: false,
			error: `unknown preset: ${presetName} (known: ${PRESET_NAMES.join(", ")})`,
		};
	}

	const title = args.title?.replace(/\s+/g, " ").trim();
	if (title && title.length > MAX_TITLE_CHARS) {
		return { ok: false, error: `--title is longer than ${MAX_TITLE_CHARS} characters` };
	}

	const captions = readList(deps, "captions", args.captions);
	if (typeof captions === "string") return { ok: false, error: captions };
	const zooms = readList(deps, "zooms", args.zooms);
	if (typeof zooms === "string") return { ok: false, error: zooms };

	try {
		captionsToCues(captions as CaptionInput[]);
		zoomsToRegions(zooms as ZoomInput[]);
	} catch (error) {
		if (error instanceof ScheduleError) return { ok: false, error: error.message };
		throw error;
	}

	return {
		ok: true,
		job: {
			inputPath: deps.resolvePath(args.input as string),
			outputPath: deps.resolvePath(args.output as string),
			preset: presetName as PresetName,
			title: title || undefined,
			captions: captions as CaptionInput[],
			zooms: zooms as ZoomInput[],
		},
	};
}

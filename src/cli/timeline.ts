/**
 * timeline.json: what `klipt render` adds to a raw recording.
 * All times are seconds in the raw recording. Parsing is strict: an unknown key or a bad value is an error
 * that names the field, so a caller sees its typo at once.
 */

export type Title = { text: string; subtitle?: string; seconds?: number };
export type Still = { t?: number; image?: string; label: string };
export type Caption = { t: number; text: string; dur?: number };
export type Zoom = { t: number; x: number; y: number; scale: number; dur: number };
export type Tap = { t: number; x: number; y: number };
export type Cut = { from: number; to: number };
export type Speed = { from: number; to: number; factor: number };
export type Voiceover = {
	endpoint: string;
	voice?: string;
	/** An acting direction for the TTS, for example "warm, upbeat product demo narrator". */
	style?: string;
	speed?: number;
	/** Video audio gain while a clip plays. */
	duck?: number;
	/** A URL to POST once before the first line, to start a cold TTS engine. */
	warmup?: string;
};

export type Timeline = {
	version: 1;
	title?: Title;
	overview?: { seconds?: number; stills: Still[] };
	captions: Caption[];
	zooms: Zoom[];
	taps: Tap[];
	cuts: Cut[];
	speed: Speed[];
	voiceover?: Voiceover;
};

export const LIMITS = {
	titleChars: 120,
	captionChars: 160,
	labelChars: 60,
	stills: 9,
	zoomScale: [1.05, 3] as const,
	zoomDur: [0.3, 10] as const,
	speedFactor: [1.25, 16] as const,
	overviewSeconds: [1, 10] as const,
	titleSeconds: [1, 10] as const,
	captionDur: [0.5, 15] as const,
	duck: [0, 1] as const,
	voiceSpeed: [0.25, 4] as const,
};

/** Tap zoom: the zoom starts a little before the tap, so the tap happens inside the zoom. */
export const TAP_ZOOM = { scale: 1.6, dur: 1.6, lead: 0.3 };

export class TimelineError extends Error {
	readonly problems: string[];
	constructor(problems: string[]) {
		super(problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more)`);
		this.problems = problems;
	}
}

export function emptyTimeline(): Timeline {
	return { version: 1, captions: [], zooms: [], taps: [], cuts: [], speed: [] };
}

type Obj = Record<string, unknown>;

class Checker {
	problems: string[] = [];

	fail(where: string, what: string): undefined {
		this.problems.push(`${where} ${what}`);
		return undefined;
	}

	object(value: unknown, where: string, keys: string[]): Obj | undefined {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return this.fail(where, "must be an object");
		}
		for (const key of Object.keys(value)) {
			if (!keys.includes(key))
				this.fail(`${where}.${key}`, `is not a known key (known: ${keys.join(", ")})`);
		}
		return value as Obj;
	}

	list(value: unknown, where: string): unknown[] {
		if (value === undefined) return [];
		if (!Array.isArray(value)) {
			this.fail(where, "must be a list");
			return [];
		}
		return value;
	}

	number(
		value: unknown,
		where: string,
		range: readonly [number, number] = [0, Number.MAX_SAFE_INTEGER],
	): number | undefined {
		if (typeof value !== "number" || !Number.isFinite(value))
			return this.fail(where, "must be a number");
		if (value < range[0] || value > range[1]) {
			return this.fail(where, `must be from ${range[0]} to ${range[1]}, got ${value}`);
		}
		return value;
	}

	text(value: unknown, where: string, max: number): string | undefined {
		if (typeof value !== "string" || !value.trim())
			return this.fail(where, "must be a text that is not empty");
		const text = value.trim();
		if (text.length > max)
			return this.fail(where, `has ${text.length} characters, the most is ${max}`);
		return text;
	}
}

const UNIT: readonly [number, number] = [0, 1];

/** Parse and check a timeline. Throw TimelineError with every problem found. */
export function parseTimeline(input: unknown): Timeline {
	const c = new Checker();
	const root = c.object(input, "timeline", [
		"version",
		"title",
		"overview",
		"captions",
		"zooms",
		"taps",
		"cuts",
		"speed",
		"voiceover",
	]);
	if (!root) throw new TimelineError(c.problems);
	const tl = emptyTimeline();

	if (root.version !== undefined && root.version !== 1) c.fail("version", "must be 1");

	if (typeof root.title === "string") {
		const text = c.text(root.title, "title", LIMITS.titleChars);
		if (text) tl.title = { text };
	} else if (root.title !== undefined) {
		const o = c.object(root.title, "title", ["text", "subtitle", "seconds"]);
		if (o) {
			const text = c.text(o.text, "title.text", LIMITS.titleChars);
			const subtitle =
				o.subtitle === undefined
					? undefined
					: c.text(o.subtitle, "title.subtitle", LIMITS.titleChars);
			const seconds =
				o.seconds === undefined
					? undefined
					: c.number(o.seconds, "title.seconds", LIMITS.titleSeconds);
			if (text) tl.title = { text, subtitle, seconds };
		}
	}

	if (root.overview !== undefined) {
		const o = c.object(root.overview, "overview", ["seconds", "stills"]);
		if (o) {
			const seconds =
				o.seconds === undefined
					? undefined
					: c.number(o.seconds, "overview.seconds", LIMITS.overviewSeconds);
			const stills: Still[] = [];
			const items = c.list(o.stills, "overview.stills");
			if (items.length > LIMITS.stills)
				c.fail("overview.stills", `has ${items.length} stills, the most is ${LIMITS.stills}`);
			items.forEach((item, i) => {
				const where = `overview.stills[${i}]`;
				const s = c.object(item, where, ["t", "image", "label"]);
				if (!s) return;
				const label = c.text(s.label, `${where}.label`, LIMITS.labelChars);
				if ((s.t === undefined) === (s.image === undefined)) {
					c.fail(where, "must have exactly one of t or image");
					return;
				}
				const t = s.t === undefined ? undefined : c.number(s.t, `${where}.t`);
				const image = s.image === undefined ? undefined : c.text(s.image, `${where}.image`, 4096);
				if (label && (t !== undefined || image)) stills.push({ t, image, label });
			});
			tl.overview = { seconds, stills };
		}
	}

	c.list(root.captions, "captions").forEach((item, i) => {
		const where = `captions[${i}]`;
		const o = c.object(item, where, ["t", "text", "dur"]);
		if (!o) return;
		const t = c.number(o.t, `${where}.t`);
		const text = c.text(o.text, `${where}.text`, LIMITS.captionChars);
		const dur =
			o.dur === undefined ? undefined : c.number(o.dur, `${where}.dur`, LIMITS.captionDur);
		if (t !== undefined && text)
			tl.captions.push(dur === undefined ? { t, text } : { t, text, dur });
	});

	c.list(root.zooms, "zooms").forEach((item, i) => {
		const where = `zooms[${i}]`;
		const o = c.object(item, where, ["t", "x", "y", "scale", "dur"]);
		if (!o) return;
		const t = c.number(o.t, `${where}.t`);
		const x = c.number(o.x, `${where}.x`, UNIT);
		const y = c.number(o.y, `${where}.y`, UNIT);
		const scale = c.number(o.scale ?? TAP_ZOOM.scale, `${where}.scale`, LIMITS.zoomScale);
		const dur = c.number(o.dur ?? TAP_ZOOM.dur, `${where}.dur`, LIMITS.zoomDur);
		if (
			t !== undefined &&
			x !== undefined &&
			y !== undefined &&
			scale !== undefined &&
			dur !== undefined
		) {
			tl.zooms.push({ t, x, y, scale, dur });
		}
	});

	c.list(root.taps, "taps").forEach((item, i) => {
		const where = `taps[${i}]`;
		const o = c.object(item, where, ["t", "x", "y"]);
		if (!o) return;
		const t = c.number(o.t, `${where}.t`);
		const x = c.number(o.x, `${where}.x`, UNIT);
		const y = c.number(o.y, `${where}.y`, UNIT);
		if (t !== undefined && x !== undefined && y !== undefined) tl.taps.push({ t, x, y });
	});

	c.list(root.cuts, "cuts").forEach((item, i) => {
		const where = `cuts[${i}]`;
		const o = c.object(item, where, ["from", "to"]);
		if (!o) return;
		const from = c.number(o.from, `${where}.from`);
		const to = c.number(o.to, `${where}.to`);
		if (from === undefined || to === undefined) return;
		if (to <= from) c.fail(where, `must end after it starts (from ${from}, to ${to})`);
		else tl.cuts.push({ from, to });
	});

	c.list(root.speed, "speed").forEach((item, i) => {
		const where = `speed[${i}]`;
		const o = c.object(item, where, ["from", "to", "factor"]);
		if (!o) return;
		const from = c.number(o.from, `${where}.from`);
		const to = c.number(o.to, `${where}.to`);
		const factor = c.number(o.factor, `${where}.factor`, LIMITS.speedFactor);
		if (from === undefined || to === undefined || factor === undefined) return;
		if (to <= from) c.fail(where, `must end after it starts (from ${from}, to ${to})`);
		else tl.speed.push({ from, to, factor });
	});

	const ranges = [
		...tl.cuts.map((r, i) => ({ ...r, name: `cuts[${i}]` })),
		...tl.speed.map((r, i) => ({ ...r, name: `speed[${i}]` })),
	].sort((a, b) => a.from - b.from);
	for (let i = 1; i < ranges.length; i++) {
		if (ranges[i].from < ranges[i - 1].to) {
			c.fail(
				ranges[i].name,
				`overlaps ${ranges[i - 1].name}: cuts and speed ranges must not overlap`,
			);
		}
	}

	if (root.voiceover !== undefined) {
		const o = c.object(root.voiceover, "voiceover", [
			"endpoint",
			"voice",
			"style",
			"speed",
			"duck",
			"warmup",
		]);
		if (o) {
			const url = (value: unknown, where: string) => {
				const text = c.text(value, where, 2048);
				if (text && !/^https?:\/\//.test(text))
					return c.fail(where, "must be an http or https URL");
				return text;
			};
			const endpoint = url(o.endpoint, "voiceover.endpoint");
			const warmup = o.warmup === undefined ? undefined : url(o.warmup, "voiceover.warmup");
			const voice = o.voice === undefined ? undefined : c.text(o.voice, "voiceover.voice", 200);
			const style = o.style === undefined ? undefined : c.text(o.style, "voiceover.style", 300);
			const speed =
				o.speed === undefined ? undefined : c.number(o.speed, "voiceover.speed", LIMITS.voiceSpeed);
			const duck =
				o.duck === undefined ? undefined : c.number(o.duck, "voiceover.duck", LIMITS.duck);
			if (endpoint) {
				tl.voiceover = { endpoint };
				if (voice) tl.voiceover.voice = voice;
				if (style) tl.voiceover.style = style;
				if (speed !== undefined) tl.voiceover.speed = speed;
				if (duck !== undefined) tl.voiceover.duck = duck;
				if (warmup) tl.voiceover.warmup = warmup;
			}
		}
	}

	if (c.problems.length) throw new TimelineError(c.problems);
	tl.captions.sort((a, b) => a.t - b.t);
	tl.taps.sort((a, b) => a.t - b.t);
	tl.zooms.sort((a, b) => a.t - b.t);
	tl.cuts.sort((a, b) => a.from - b.from);
	tl.speed.sort((a, b) => a.from - b.from);
	return tl;
}

/**
 * The zooms to draw: the explicit zooms plus one zoom for each tap that no zoom covers.
 * A burst of taps makes one zoom. A zoom that runs into the next one ends where the next one starts.
 */
export function effectiveZooms(tl: Pick<Timeline, "zooms" | "taps">): Zoom[] {
	const zooms = [...tl.zooms];
	const covered = (t: number) => zooms.some((z) => t >= z.t && t <= z.t + z.dur);
	for (const tap of tl.taps) {
		if (covered(tap.t)) continue;
		zooms.push({
			t: Math.max(0, round3(tap.t - TAP_ZOOM.lead)),
			x: tap.x,
			y: tap.y,
			scale: TAP_ZOOM.scale,
			dur: TAP_ZOOM.dur,
		});
	}
	zooms.sort((a, b) => a.t - b.t);
	const out: Zoom[] = [];
	for (let i = 0; i < zooms.length; i++) {
		const z = { ...zooms[i] };
		const next = zooms[i + 1];
		if (next && z.t + z.dur > next.t) z.dur = round3(next.t - z.t);
		if (z.dur >= LIMITS.zoomDur[0]) out.push(z);
	}
	return out;
}

/** Drop or clip what lies after the end of the video. Return the warnings. */
export function fitToDuration(
	tl: Timeline,
	duration: number,
): { timeline: Timeline; warnings: string[] } {
	const warnings: string[] = [];
	const keep = <T extends { t: number }>(items: T[], name: string) =>
		items.filter((item) => {
			if (item.t < duration) return true;
			warnings.push(`${name} at ${item.t}s dropped: the video is ${duration.toFixed(2)}s long`);
			return false;
		});
	const clip = <T extends { from: number; to: number }>(items: T[], name: string) =>
		items.flatMap((r) => {
			if (r.from >= duration) {
				warnings.push(`${name} from ${r.from}s dropped: the video is ${duration.toFixed(2)}s long`);
				return [];
			}
			return [{ ...r, to: Math.min(r.to, duration) }];
		});
	const out: Timeline = {
		...tl,
		captions: keep(tl.captions, "caption"),
		zooms: keep(tl.zooms, "zoom"),
		taps: keep(tl.taps, "tap"),
		cuts: clip(tl.cuts, "cut"),
		speed: clip(tl.speed, "speed range"),
	};
	if (tl.overview) {
		const lastFrame = Math.max(0, duration - 0.05);
		out.overview = {
			...tl.overview,
			stills: tl.overview.stills.map((s) => {
				if (s.t === undefined || s.t <= lastFrame) return s;
				warnings.push(
					`still "${s.label}" at ${s.t}s moved to the last frame: the video is ${duration.toFixed(2)}s long`,
				);
				return { ...s, t: lastFrame };
			}),
		};
	}
	const cutTotal = out.cuts.reduce((sum, r) => sum + r.to - r.from, 0);
	if (cutTotal >= duration - 0.5) throw new TimelineError(["cuts remove the whole video"]);
	return { timeline: out, warnings };
}

export function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

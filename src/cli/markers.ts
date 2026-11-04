/**
 * markers.jsonl: the caller appends one JSON object per line while `klipt record` runs.
 *
 *   {"caption": "Open the invite sheet"}        a step caption
 *   {"tap": {"x": 0.42, "y": 0.8}}             a tap: a zoom and a tap ring (x, y in 0..1, or pixels of the source)
 *   {"state": "Invite sent"}                    a still for the overview grid
 *   {"speed": 4} ... {"speed": 1}               a speed-up range
 *   {"cut": true} ... {"cut": false}            a cut range
 *   {"title": "Invite a friend"}                the title card
 *   {"stop": true}                              stop the recording
 *
 * The time of a marker is, in this order: "t" (seconds in the recording), "ts" (epoch milliseconds),
 * or the moment the recorder read the line.
 */

import { type Caption, emptyTimeline, round3, type Timeline } from "./timeline.ts";

export type MarkerBody =
	| { kind: "caption"; text: string; dur?: number }
	| { kind: "tap"; x: number; y: number }
	| { kind: "state"; label: string }
	| { kind: "speed"; factor: number }
	| { kind: "cut"; on: boolean }
	| { kind: "title"; text: string }
	| { kind: "stop" };

export type Marker = MarkerBody & { t?: number; ts?: number };
export type TimedMarker = MarkerBody & { t: number };

export type Size = { width: number; height: number };

const KEYS = ["caption", "tap", "state", "speed", "cut", "title", "stop"] as const;

/** Parse one line of markers.jsonl. Return the marker or a sentence that says what is wrong. */
export function parseMarker(line: string): Marker | string {
	let data: unknown;
	try {
		data = JSON.parse(line);
	} catch {
		return "is not JSON";
	}
	if (typeof data !== "object" || data === null || Array.isArray(data))
		return "is not a JSON object";
	const o = data as Record<string, unknown>;
	const kinds = KEYS.filter((k) => o[k] !== undefined);
	if (kinds.length !== 1) return `must have exactly one of ${KEYS.join(", ")}`;
	const time: { t?: number; ts?: number } = {};
	if (o.t !== undefined) {
		if (typeof o.t !== "number" || !Number.isFinite(o.t) || o.t < 0)
			return "t must be a number of seconds, 0 or more";
		time.t = o.t;
	}
	if (o.ts !== undefined) {
		if (typeof o.ts !== "number" || !Number.isFinite(o.ts)) return "ts must be epoch milliseconds";
		time.ts = o.ts;
	}
	const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
	switch (kinds[0]) {
		case "caption": {
			const t = text(o.caption);
			if (!t) return "caption must be a text that is not empty";
			const dur = typeof o.dur === "number" && o.dur > 0 ? o.dur : undefined;
			return { kind: "caption", text: t, ...(dur ? { dur } : {}), ...time };
		}
		case "tap": {
			const tap = o.tap as Record<string, unknown> | null;
			const x = tap?.x;
			const y = tap?.y;
			if (
				typeof x !== "number" ||
				typeof y !== "number" ||
				!Number.isFinite(x) ||
				!Number.isFinite(y) ||
				x < 0 ||
				y < 0
			) {
				return "tap must be {x, y} with numbers, 0 or more";
			}
			return { kind: "tap", x, y, ...time };
		}
		case "state": {
			const label = text(o.state);
			return label ? { kind: "state", label, ...time } : "state must be a text that is not empty";
		}
		case "speed": {
			const f = o.speed;
			if (typeof f !== "number" || !Number.isFinite(f) || f < 1)
				return "speed must be a number, 1 or more (1 ends a speed-up)";
			return { kind: "speed", factor: f, ...time };
		}
		case "cut":
			return typeof o.cut === "boolean"
				? { kind: "cut", on: o.cut, ...time }
				: "cut must be true or false";
		case "title": {
			const t = text(o.title);
			return t ? { kind: "title", text: t, ...time } : "title must be a text that is not empty";
		}
		default:
			return o.stop === true ? { kind: "stop", ...time } : "stop must be true";
	}
}

/** The time of a marker in seconds of the recording, from t, ts, or the time the recorder read it. */
export function markerTime(m: Marker, startedAtMs: number, readAtMs: number): number {
	if (m.t !== undefined) return m.t;
	const ms = m.ts ?? readAtMs;
	return Math.max(0, (ms - startedAtMs) / 1000);
}

/** Reading time of a caption when the caller gives no dur and the next caption does not end it first. */
export function readingTime(text: string): number {
	return Math.min(5, Math.max(2, 1.2 + text.length * 0.05));
}

/**
 * Convert timed markers to a timeline. Taps in pixels are converted to 0..1 with tapSpace
 * (the CSS viewport of a tab, the screen of a device, the size of an X window).
 */
export function markersToTimeline(
	markers: TimedMarker[],
	opts: { duration: number; tapSpace?: Size },
): { timeline: Timeline; warnings: string[] } {
	const tl = emptyTimeline();
	const warnings: string[] = [];
	const sorted = [...markers].sort((a, b) => a.t - b.t);
	let speedFrom: { t: number; factor: number } | undefined;
	let cutFrom: number | undefined;
	const captions: Caption[] = [];
	const stills: Array<{ t: number; label: string }> = [];

	const closeSpeed = (t: number) => {
		if (speedFrom && t > speedFrom.t)
			tl.speed.push({ from: round3(speedFrom.t), to: round3(t), factor: speedFrom.factor });
		speedFrom = undefined;
	};
	const closeCut = (t: number) => {
		if (cutFrom !== undefined && t > cutFrom)
			tl.cuts.push({ from: round3(cutFrom), to: round3(t) });
		cutFrom = undefined;
	};

	for (const m of sorted) {
		const t = round3(Math.min(m.t, opts.duration));
		switch (m.kind) {
			case "caption":
				captions.push(m.dur ? { t, text: m.text, dur: m.dur } : { t, text: m.text });
				break;
			case "tap": {
				let { x, y } = m;
				if (x > 1 || y > 1) {
					if (!opts.tapSpace) {
						warnings.push(`tap at ${t}s dropped: it is in pixels and the source size is not known`);
						break;
					}
					x /= opts.tapSpace.width;
					y /= opts.tapSpace.height;
				}
				tl.taps.push({ t, x: round4(clamp01(x)), y: round4(clamp01(y)) });
				break;
			}
			case "state":
				stills.push({ t, label: m.label });
				break;
			case "speed":
				if (cutFrom !== undefined) {
					warnings.push(`speed marker at ${t}s ignored: a cut is open`);
					break;
				}
				closeSpeed(t);
				if (m.factor > 1) speedFrom = { t, factor: Math.min(16, Math.max(1.25, m.factor)) };
				break;
			case "cut":
				if (m.on) {
					closeSpeed(t);
					if (cutFrom === undefined) cutFrom = t;
				} else {
					closeCut(t);
				}
				break;
			case "title":
				tl.title = { text: m.text.slice(0, 120) };
				break;
			case "stop":
				break;
		}
	}
	closeSpeed(opts.duration);
	closeCut(opts.duration);
	tl.captions = captions.map((c) => ({ ...c, text: c.text.slice(0, 160) }));
	if (stills.length > 9) {
		warnings.push(`${stills.length} state markers: the overview grid keeps the first 9`);
	}
	if (stills.length)
		tl.overview = {
			stills: stills.slice(0, 9).map((s) => ({ t: s.t, label: s.label.slice(0, 60) })),
		};
	return { timeline: tl, warnings };
}

function clamp01(n: number): number {
	return Math.min(1, Math.max(0, n));
}

function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}

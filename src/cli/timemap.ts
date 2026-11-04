/**
 * The time map from the raw recording to the rendered body (the video after the intro card).
 * Cuts remove raw time, speed ranges compress it, and holds freeze the frame at a raw time for some seconds.
 * The voiceover adds holds when a spoken caption runs longer than the gap to the next caption.
 */

import { readingTime } from "./markers.ts";
import { type Caption, type Cut, round3, type Speed } from "./timeline.ts";

export type Hold = { at: number; seconds: number };
export type Piece = { from: number; to: number; factor: number; out: number };
export type TimeMap = { duration: number; pieces: Piece[]; endHold: number; total: number };

export const FRAME = 1 / 30;
/** Silence after a spoken caption before the next one starts. */
export const VOICE_GAP = 0.3;

export function buildTimeMap(
	duration: number,
	cuts: Cut[],
	speed: Speed[],
	holds: Hold[] = [],
): TimeMap {
	// Kept raw intervals, then split at the edges of the speed ranges and at the hold points.
	const edges = new Set<number>([0, duration]);
	for (const r of [...cuts, ...speed]) {
		edges.add(clamp(r.from, 0, duration));
		edges.add(clamp(r.to, 0, duration));
	}
	const sortedCuts = [...cuts].sort((a, b) => a.from - b.from);
	const nextKept = (t: number) => {
		let at = t;
		for (const c of sortedCuts) if (at >= c.from && at < c.to) at = c.to;
		return at;
	};
	const holdAt = new Map<number, number>();
	let endHold = 0;
	for (const h of holds) {
		if (h.seconds <= 0) continue;
		const at = nextKept(clamp(h.at, 0, duration));
		if (at >= duration) {
			endHold += h.seconds;
			continue;
		}
		edges.add(at);
		holdAt.set(at, (holdAt.get(at) ?? 0) + h.seconds);
	}
	const points = [...edges].sort((a, b) => a - b);
	const pieces: Piece[] = [];
	let out = 0;
	for (let i = 0; i < points.length - 1; i++) {
		const from = points[i];
		const to = points[i + 1];
		if (to - from <= 1e-9) continue;
		const mid = (from + to) / 2;
		if (cuts.some((c) => mid >= c.from && mid < c.to)) continue;
		out += holdAt.get(from) ?? 0;
		const factor = speed.find((s) => mid >= s.from && mid < s.to)?.factor ?? 1;
		pieces.push({ from, to, factor, out });
		out += (to - from) / factor;
	}
	return { duration, pieces, endHold, total: out + endHold };
}

/** The body time of a raw time, or undefined when a cut removes it. */
export function toOutput(map: TimeMap, t: number): number | undefined {
	for (const p of map.pieces) {
		if (t >= p.from && t < p.to) return p.out + (t - p.from) / p.factor;
	}
	const last = map.pieces[map.pieces.length - 1];
	if (last && t >= last.to) return last.out + (last.to - last.from) / last.factor;
	return undefined;
}

/** A setpts expression that maps the raw time T to the body time. Frames in cuts are removed before it. */
export function setptsExpr(map: TimeMap): string {
	const terms = map.pieces.map((p) => `${num(p.out)}+(T-${num(p.from)})/${num(p.factor)}`);
	if (!terms.length) return "PTS";
	let expr = terms[terms.length - 1];
	for (let i = map.pieces.length - 2; i >= 0; i--) {
		expr = `if(lt(T,${num(map.pieces[i].to)}),${terms[i]},${expr})`;
	}
	return `(${expr})/TB`;
}

/** A select expression that keeps the frames outside the cuts. */
export function cutSelectExpr(cuts: Cut[]): string | undefined {
	if (!cuts.length) return undefined;
	return cuts.map((c) => `not(between(t,${num(c.from)},${num(c.to - 1e-6)}))`).join("*");
}

export type ScheduledCaption = { text: string; start: number; end: number; audio?: number };

/**
 * Place the captions in body time. audio[i] is the length of the spoken caption i (or undefined).
 * A spoken caption stays on screen until its audio ends. When it runs into the next caption, the frame
 * before the next caption freezes for the missing time, so the voice and the screen stay in step.
 */
export function scheduleCaptions(
	captions: Caption[],
	opts: { duration: number; cuts: Cut[]; speed: Speed[]; audio?: Array<number | undefined> },
): { map: TimeMap; captions: ScheduledCaption[]; holds: Hold[]; dropped: Caption[] } {
	const audio = opts.audio ?? [];
	const dropped: Caption[] = [];
	const base = buildTimeMap(opts.duration, opts.cuts, opts.speed);
	// A caption inside a cut is not shown. Two captions keep at least one frame between them.
	const kept: Array<{ caption: Caption; audio?: number; t: number }> = [];
	captions.forEach((caption, i) => {
		if (toOutput(base, caption.t) === undefined) {
			dropped.push(caption);
			return;
		}
		const prev = kept[kept.length - 1];
		const t = prev && caption.t < prev.t + FRAME ? prev.t + FRAME : caption.t;
		kept.push({ caption, audio: audio[i], t: Math.min(t, opts.duration) });
	});

	const holds: Hold[] = [];
	let map = base;
	for (let i = 0; i < kept.length; i++) {
		const spoken = kept[i].audio;
		if (!spoken) continue;
		const start = toOutput(map, kept[i].t) ?? 0;
		const needEnd = start + spoken + VOICE_GAP;
		const next = kept[i + 1];
		const limit = next ? (toOutput(map, next.t) ?? map.total) : map.total;
		if (needEnd > limit + 1e-6) {
			holds.push({ at: next ? next.t : opts.duration, seconds: round3(needEnd - limit) });
			map = buildTimeMap(opts.duration, opts.cuts, opts.speed, holds);
		}
	}

	const scheduled: ScheduledCaption[] = kept.map((k, i) => {
		const start = toOutput(map, k.t) ?? 0;
		const next = kept[i + 1];
		const nextStart = next ? (toOutput(map, next.t) ?? map.total) : map.total;
		const natural = start + (k.caption.dur ?? readingTime(k.caption.text));
		const spokenEnd = k.audio ? start + k.audio + VOICE_GAP : 0;
		const end = Math.min(Math.max(natural, spokenEnd), nextStart, map.total);
		return {
			text: k.caption.text,
			start: round3(start),
			end: round3(end),
			...(k.audio ? { audio: round3(k.audio) } : {}),
		};
	});
	return { map, captions: scheduled, holds, dropped };
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, n));
}

/** A number for an ffmpeg expression: no exponent, at most 6 decimals. */
export function num(n: number): string {
	return String(Math.round(n * 1e6) / 1e6);
}

/**
 * Pure builders for the ffmpeg work of `klipt render`: presets, layout, filter expressions and graphs.
 * No file or process access here, so the tests can check every string.
 */

import type { Tap, Zoom } from "./timeline.ts";
import { num, setptsExpr, type TimeMap } from "./timemap.ts";

export const FPS = 30;

export type Rect = { x: number; y: number; w: number; h: number };

export type Preset = {
	name: "phone-demo" | "desktop-demo";
	width: number;
	height: number;
	/** The area the video fits in. */
	box: Rect;
	radius: number;
	background: string;
	accent: string;
	caption: { size: number; maxChars: number; baseY: number };
	title: { size: number; maxChars: number };
	label: { size: number };
};

export const PRESETS: Record<Preset["name"], Preset> = {
	"phone-demo": {
		name: "phone-demo",
		width: 1080,
		height: 1920,
		box: { x: 72, y: 140, w: 936, h: 1640 },
		radius: 44,
		background: "0x0D0D0D",
		accent: "0xE0000F",
		caption: { size: 50, maxChars: 30, baseY: 1540 },
		title: { size: 72, maxChars: 24 },
		label: { size: 34 },
	},
	"desktop-demo": {
		name: "desktop-demo",
		width: 1920,
		height: 1080,
		box: { x: 64, y: 48, w: 1792, h: 984 },
		radius: 28,
		background: "0x0D0D0D",
		accent: "0xE0000F",
		caption: { size: 44, maxChars: 60, baseY: 930 },
		title: { size: 76, maxChars: 40 },
		label: { size: 30 },
	},
};

export function presetFor(
	name: string | undefined,
	width: number,
	height: number,
): Preset | undefined {
	if (!name || name === "auto") return PRESETS[height > width ? "phone-demo" : "desktop-demo"];
	return PRESETS[name as Preset["name"]];
}

export function even(n: number): number {
	return Math.max(2, Math.round(n / 2) * 2);
}

/** Fit a w x h picture into a box, centered, with even sizes. */
export function fitRect(w: number, h: number, box: Rect): Rect {
	const scale = Math.min(box.w / w, box.h / h);
	const fw = even(w * scale);
	const fh = even(h * scale);
	return { x: even(box.x + (box.w - fw) / 2), y: even(box.y + (box.h - fh) / 2), w: fw, h: fh };
}

/**
 * The overview grid: n cells of the given aspect (w / h) in an area, each with a label row under it.
 * It tries every column count and keeps the one with the largest cells.
 */
export function gridLayout(
	n: number,
	aspect: number,
	area: Rect,
	gap: number,
	labelH: number,
): Rect[] {
	let best: { cols: number; w: number; h: number } | undefined;
	for (let cols = 1; cols <= n; cols++) {
		const rows = Math.ceil(n / cols);
		const cellW = (area.w - gap * (cols - 1)) / cols;
		const cellH = (area.h - gap * (rows - 1)) / rows - labelH;
		if (cellW <= 0 || cellH <= 0) continue;
		const w = Math.min(cellW, cellH * aspect);
		if (!best || w > best.w) best = { cols, w, h: w / aspect };
	}
	if (!best) return [];
	const { cols } = best;
	const w = even(best.w);
	const h = even(best.h);
	const rows = Math.ceil(n / cols);
	const totalH = rows * (h + labelH) + gap * (rows - 1);
	const top = area.y + (area.h - totalH) / 2;
	const rects: Rect[] = [];
	for (let i = 0; i < n; i++) {
		const row = Math.floor(i / cols);
		const inRow = Math.min(cols, n - row * cols);
		const rowW = inRow * w + gap * (inRow - 1);
		const left = area.x + (area.w - rowW) / 2;
		const col = i - row * cols;
		rects.push({ x: even(left + col * (w + gap)), y: even(top + row * (h + labelH + gap)), w, h });
	}
	return rects;
}

/** Break a text into lines of at most maxChars. A word longer than a line is cut. */
export function wrapText(text: string, maxChars: number, maxLines = 3): string[] {
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(/\s+/).filter(Boolean)) {
		let w = word;
		while (w.length > maxChars) {
			if (line) {
				lines.push(line);
				line = "";
			}
			lines.push(w.slice(0, maxChars));
			w = w.slice(maxChars);
		}
		if (!line) line = w;
		else if (line.length + 1 + w.length <= maxChars) line = `${line} ${w}`;
		else {
			lines.push(line);
			line = w;
		}
	}
	if (line) lines.push(line);
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		kept[maxLines - 1] = `${kept[maxLines - 1].slice(0, Math.max(1, maxChars - 3))}...`;
		return kept;
	}
	return lines;
}

/** Quote a value for a filter option. The quotes protect , ; : [ ] and spaces. */
export function q(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

const RAMP = 0.4;

/** zoompan expressions for the zooms. The zoom eases in and out (smoothstep); it is 1 between zooms. */
export function zoomExprs(zooms: Zoom[]): { z: string; x: string; y: string } {
	if (!zooms.length) return { z: "1", x: "0", y: "0" };
	const zTerms = zooms.map((zm) => {
		const a = zm.t;
		const b = zm.t + zm.dur;
		const r = Math.min(RAMP, zm.dur / 3);
		return `(st(0,clip(min((it-${num(a)})/${num(r)},(${num(b)}-it)/${num(r)}),0,1));${num(zm.scale - 1)}*ld(0)*ld(0)*(3-2*ld(0)))`;
	});
	const gate = (zm: Zoom) => `gte(it,${num(zm.t)})*lt(it,${num(zm.t + zm.dur)})`;
	const anyGate = zooms.map(gate).join("+");
	const focus = (key: "x" | "y") =>
		`(${zooms.map((zm) => `${gate(zm)}*${num(zm[key])}`).join("+")}+(1-(${anyGate}))*0.5)`;
	return {
		z: `1+${zTerms.join("+")}`,
		x: `clip(${focus("x")}*iw-iw/zoom/2,0,iw-iw/zoom)`,
		y: `clip(${focus("y")}*ih-ih/zoom/2,0,ih-ih/zoom)`,
	};
}

export const RING_SECONDS = 0.7;

/**
 * geq expressions of a tap ring: a white ring with a dark outer edge and a light white fill.
 * The white and the dark edge show on a light page, a dark page and a colored button.
 */
export function ringExprs(size: number): { rgb: string; alpha: string } {
	const c = size / 2;
	const d = `hypot(X+0.5-${num(c)},Y+0.5-${num(c)})`;
	const outer = c - 1;
	const edge = outer - Math.max(2, size * 0.05);
	const inner = c * 0.7;
	return {
		rgb: `if(gt(${d},${num(edge)}),24,255)`,
		alpha: `255*clip(${num(outer)}-${d},0,1)*(0.3+0.65*clip(${d}-${num(inner)},0,1))`,
	};
}

/** geq alpha of the cover: opaque outside the rounded video frame, clear inside it. */
export function coverAlphaExpr(frame: Rect, radius: number): string {
	const cx = frame.x + frame.w / 2;
	const cy = frame.y + frame.h / 2;
	const dx = `max(abs(X+0.5-${num(cx)})-${num(frame.w / 2 - radius)},0)`;
	const dy = `max(abs(Y+0.5-${num(cy)})-${num(frame.h / 2 - radius)},0)`;
	return `255*clip(hypot(${dx},${dy})-${num(radius)}+0.5,0,1)`;
}

export type CaptionLine = { file: string; line: number; lines: number; start: number; end: number };

export type BodyGraphInput = {
	raw: { width: number; height: number };
	preset: Preset;
	frame: Rect;
	zooms: Zoom[];
	taps: Tap[];
	ringSize: number;
	cutSelect?: string;
	map: TimeMap;
	remap: boolean;
	captionLines: CaptionLine[];
	font: string;
	/** Input indexes. */
	inputs: { raw: number; cover: number; ring?: number; intro?: number };
};

/** The video filter graph. The output pad is [vout]. */
export function videoGraph(g: BodyGraphInput): string {
	const parts: string[] = [];
	const { width: W, height: H } = g.raw;
	parts.push(
		`[${g.inputs.raw}:v]fps=${FPS},setpts=PTS-STARTPTS,scale=${W}:${H},format=yuv420p[r0]`,
	);
	let cur = "r0";
	if (g.taps.length && g.inputs.ring !== undefined) {
		const names = g.taps.map((_, i) => `ring${i}`);
		parts.push(
			g.taps.length === 1
				? `[${g.inputs.ring}:v]null[ring0]`
				: `[${g.inputs.ring}:v]split=${g.taps.length}${names.map((n) => `[${n}]`).join("")}`,
		);
		g.taps.forEach((tap, i) => {
			const x = Math.round(tap.x * W - g.ringSize / 2);
			const y = Math.round(tap.y * H - g.ringSize / 2);
			const next = `rt${i}`;
			parts.push(
				`[${cur}][${names[i]}]overlay=x=${x}:y=${y}:enable=${q(`between(t,${num(tap.t)},${num(tap.t + RING_SECONDS)})`)}[${next}]`,
			);
			cur = next;
		});
	}
	const chain: string[] = [];
	if (g.zooms.length) {
		const z = zoomExprs(g.zooms);
		chain.push(`zoompan=z=${q(z.z)}:x=${q(z.x)}:y=${q(z.y)}:d=1:s=${W}x${H}:fps=${FPS}`);
	}
	if (g.cutSelect) chain.push(`select=${q(g.cutSelect)}`);
	if (g.remap) {
		chain.push(`setpts=${q(setptsExpr(g.map))}`, `fps=${FPS}`);
	}
	if (g.map.endHold > 0) chain.push(`tpad=stop_mode=clone:stop_duration=${num(g.map.endHold)}`);
	const p = g.preset;
	chain.push(
		`scale=${g.frame.w}:${g.frame.h}:flags=lanczos`,
		`pad=${p.width}:${p.height}:${g.frame.x}:${g.frame.y}:color=${p.background}`,
	);
	parts.push(`[${cur}]${chain.join(",")}[framed]`);
	const after: string[] = [];
	// One box per line. The line height keeps the boxes from overlapping (box = text + 2 x border).
	const lineH = Math.round(p.caption.size * 1.85);
	for (const c of g.captionLines) {
		const y = p.caption.baseY - (c.lines - 1 - c.line) * lineH;
		after.push(
			`drawtext=fontfile=${q(g.font)}:textfile=${q(c.file)}:fontsize=${p.caption.size}:fontcolor=white` +
				`:box=1:boxcolor=black@0.78:boxborderw=${Math.round(p.caption.size * 0.38)}` +
				`:x=(w-text_w)/2:y=${y}:enable=${q(`between(t,${num(c.start)},${num(c.end)})`)}`,
		);
	}
	after.push("format=yuv420p", "setsar=1");
	parts.push(`[framed][${g.inputs.cover}:v]overlay=0:0,${after.join(",")}[body]`);
	if (g.inputs.intro !== undefined) {
		parts.push(`[${g.inputs.intro}:v]fps=${FPS},format=yuv420p,setsar=1[intro]`);
		parts.push("[intro][body]concat=n=2:v=1:a=0[vout]");
	} else {
		parts.push("[body]null[vout]");
	}
	return parts.join(";");
}

export type AudioGraphInput = {
	introSeconds: number;
	total: number;
	map: TimeMap;
	/** The raw recording has an audio track. */
	rawAudio: boolean;
	rawIndex: number;
	voice: Array<{ input: number; start: number; seconds: number }>;
	/** Video audio gain while a voice clip plays. */
	duck: number;
};

/** The audio filter graph, or undefined when the render has no audio. The output pad is [aout]. */
export function audioGraph(a: AudioGraphInput): string | undefined {
	if (!a.rawAudio && !a.voice.length) return undefined;
	const parts: string[] = [];
	const mix: string[] = [];
	const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
	if (a.rawAudio) {
		const pieces = a.map.pieces;
		const names = pieces.map((_, i) => `ap${i}`);
		parts.push(
			pieces.length === 1
				? `[${a.rawIndex}:a]${fmt}[ap0]`
				: `[${a.rawIndex}:a]${fmt},asplit=${pieces.length}${names.map((n) => `[${n}]`).join("")}`,
		);
		const segs: string[] = [];
		let cursor = 0;
		pieces.forEach((p, i) => {
			if (p.out > cursor + 0.001) {
				parts.push(
					`aevalsrc=0:c=stereo:s=48000:d=${num(p.out - cursor)},aformat=sample_fmts=fltp[ah${i}]`,
				);
				segs.push(`[ah${i}]`);
			}
			parts.push(
				`[${names[i]}]atrim=${num(p.from)}:${num(p.to)},asetpts=PTS-STARTPTS${atempo(p.factor)}[as${i}]`,
			);
			segs.push(`[as${i}]`);
			cursor = p.out + (p.to - p.from) / p.factor;
		});
		parts.push(`${segs.join("")}concat=n=${segs.length}:v=0:a=1[araw0]`);
		const delay = Math.round(a.introSeconds * 1000);
		let rawChain = `adelay=${delay}|${delay}`;
		if (a.voice.length && a.duck < 1) {
			const windows = a.voice
				.map(
					(v) =>
						`between(t,${num(a.introSeconds + v.start)},${num(a.introSeconds + v.start + v.seconds)})`,
				)
				.join("+");
			rawChain += `,volume=${num(a.duck)}:enable=${q(windows)}`;
		}
		parts.push(`[araw0]${rawChain}[araw]`);
		mix.push("[araw]");
	}
	a.voice.forEach((v, i) => {
		const delay = Math.round((a.introSeconds + v.start) * 1000);
		parts.push(`[${v.input}:a]${fmt},adelay=${delay}|${delay}[vo${i}]`);
		mix.push(`[vo${i}]`);
	});
	const end = `apad=whole_dur=${num(a.total)},atrim=0:${num(a.total)}`;
	parts.push(
		mix.length === 1
			? `${mix[0]}${end}[aout]`
			: `${mix.join("")}amix=inputs=${mix.length}:normalize=0:dropout_transition=0,${end}[aout]`,
	);
	return parts.join(";");
}

/** atempo takes 0.5 to 100 in one step on ffmpeg 6. Chain steps of 2 to stay inside the range on older builds. */
function atempo(factor: number): string {
	if (factor === 1) return "";
	const steps: number[] = [];
	let f = factor;
	while (f > 2) {
		steps.push(2);
		f /= 2;
	}
	steps.push(f);
	return steps.map((s) => `,atempo=${num(s)}`).join("");
}

export type TitleLayout = {
	size: number;
	lineH: number;
	y: number;
	barY: number;
	subY: number;
	bottom: number;
};

/** Where the title goes: on top of a card with a grid, in the middle of a card without one. */
export function titleLayout(
	p: Preset,
	lines: number,
	subtitle: boolean,
	grid: boolean,
): TitleLayout {
	const size = grid ? Math.round(p.title.size * 0.8) : p.title.size;
	const lineH = Math.round(size * 1.25);
	const subSize = Math.round(size * 0.5);
	const blockH =
		lines * lineH + Math.round(size * 0.6) + (subtitle ? Math.round(subSize * 1.6) : 0);
	const y = grid ? Math.round(p.height * 0.04) : Math.round((p.height - blockH) / 2);
	const barY = y + lines * lineH + Math.round(size * 0.15);
	const subY = barY + Math.round(size * 0.45);
	return { size, lineH, y, barY, subY, bottom: y + blockH };
}

export type IntroInput = {
	preset: Preset;
	font: string;
	/** One text file per title line, so each line is centered by itself. dy moves the title down. */
	title?: { files: string[]; subFile?: string; dy: number };
	stills: Array<{ input: number; rect: Rect; labelFile: string }>;
};

/** One-frame graph for the intro card: the title, and the overview grid when there are stills. */
export function introGraph(c: IntroInput): string {
	const p = c.preset;
	const parts: string[] = [
		`color=c=${p.background}:s=${p.width}x${p.height}:d=1,format=rgb24[bg0]`,
	];
	let cur = "bg0";
	c.stills.forEach((s, i) => {
		parts.push(
			`[${s.input}:v]scale=${s.rect.w}:${s.rect.h}:force_original_aspect_ratio=decrease,` +
				`pad=${s.rect.w}:${s.rect.h}:(ow-iw)/2:(oh-ih)/2:color=0x1A1A1A,format=rgb24[s${i}]`,
		);
		parts.push(`[${cur}][s${i}]overlay=${s.rect.x}:${s.rect.y}[g${i}]`);
		cur = `g${i}`;
	});
	const draw: string[] = [];
	c.stills.forEach((s) => {
		draw.push(
			`drawbox=x=${s.rect.x - 2}:y=${s.rect.y - 2}:w=${s.rect.w + 4}:h=${s.rect.h + 4}:color=0x2A2A2A:t=2`,
			`drawtext=fontfile=${q(c.font)}:textfile=${q(s.labelFile)}:fontsize=${p.label.size}:fontcolor=white` +
				`:x=${s.rect.x}+(${s.rect.w}-text_w)/2:y=${s.rect.y + s.rect.h + Math.round(p.label.size * 0.5)}`,
		);
	});
	if (c.title) {
		const base = titleLayout(
			p,
			c.title.files.length,
			Boolean(c.title.subFile),
			c.stills.length > 0,
		);
		const dy = c.title.dy;
		const t = { ...base, y: base.y + dy, barY: base.barY + dy, subY: base.subY + dy };
		c.title.files.forEach((file, i) => {
			draw.push(
				`drawtext=fontfile=${q(c.font)}:textfile=${q(file)}:fontsize=${t.size}:fontcolor=white` +
					`:x=(w-text_w)/2:y=${t.y + i * t.lineH}`,
			);
		});
		const barW = Math.round(t.size * 1.6);
		draw.push(
			`drawbox=x=(iw-${barW})/2:y=${t.barY}:w=${barW}:h=${Math.max(4, Math.round(t.size / 12))}:color=${p.accent}:t=fill`,
		);
		if (c.title.subFile) {
			draw.push(
				`drawtext=fontfile=${q(c.font)}:textfile=${q(c.title.subFile)}:fontsize=${Math.round(t.size * 0.5)}:fontcolor=0xB0B0B0` +
					`:x=(w-text_w)/2:y=${t.subY}`,
			);
		}
	}
	parts.push(`[${cur}]${draw.length ? draw.join(",") : "null"}[out]`);
	return parts.join(";");
}

/** The area of the overview grid: under the title block, or the whole card. */
export function gridArea(p: Preset, titleBottom: number | undefined): Rect {
	const top =
		titleBottom === undefined
			? Math.round(p.height * 0.05)
			: titleBottom + Math.round(p.height * 0.025);
	const side = Math.round(p.width * 0.05);
	return {
		x: side,
		y: top,
		w: p.width - 2 * side,
		h: p.height - top - Math.round(p.height * 0.04),
	};
}

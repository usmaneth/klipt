import { BRAND } from "./preset";

/** Break `text` into lines that are at most `maxWidth` wide. A word that is too long gets a line of its own. */
export function wrapLines(
	measure: (value: string) => number,
	text: string,
	maxWidth: number,
	maxLines = 4,
): string[] {
	const words = text.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const candidate = line ? `${line} ${word}` : word;
		if (line && measure(candidate) > maxWidth) {
			lines.push(line);
			line = word;
		} else {
			line = candidate;
		}
	}
	if (line) lines.push(line);
	if (lines.length > maxLines) {
		const kept = lines.slice(0, maxLines);
		kept[maxLines - 1] = `${kept[maxLines - 1]}…`;
		return kept;
	}
	return lines;
}

/** Paint the title card: brand background, a short accent rule, the title in white. */
export function drawTitleCard(
	ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
	width: number,
	height: number,
	title: string,
): void {
	ctx.fillStyle = BRAND.background;
	ctx.fillRect(0, 0, width, height);

	const fontSize = Math.round(width * 0.075);
	const lineHeight = Math.round(fontSize * 1.25);
	ctx.font = `700 ${fontSize}px ${BRAND.font}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";

	const lines = wrapLines((value) => ctx.measureText(value).width, title, width * 0.8);
	const blockHeight = lines.length * lineHeight;
	const ruleWidth = Math.round(width * 0.09);
	const ruleHeight = Math.max(4, Math.round(width * 0.008));
	const gap = Math.round(fontSize * 0.7);
	const top = Math.round((height - (blockHeight + gap + ruleHeight)) / 2);

	ctx.fillStyle = BRAND.accent;
	ctx.fillRect(Math.round((width - ruleWidth) / 2), top, ruleWidth, ruleHeight);

	ctx.fillStyle = BRAND.text;
	lines.forEach((line, index) => {
		ctx.fillText(line, width / 2, top + ruleHeight + gap + index * lineHeight + lineHeight / 2);
	});
}

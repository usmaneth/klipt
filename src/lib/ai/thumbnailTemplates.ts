/**
 * Thumbnail template renderer — produces MrBeast / YouTube-style thumbnails
 * using Canvas 2D. No external dependencies needed.
 */

// ── Template definitions ────────────────────────────────────────────────────

export interface ThumbnailTextLayer {
	text: string;
	/** Percentage-based position (0–100) */
	x: number;
	y: number;
	fontSize: number;
	fontFamily: string;
	fontWeight: string;
	color: string;
	outlineColor: string;
	outlineWidth: number;
	/** Shadow / glow radius (0 = off) */
	glowRadius: number;
	glowColor: string;
	rotation: number;
	textAlign: CanvasTextAlign;
	maxWidth?: number;
	letterSpacing?: number;
}

export interface ThumbnailOverlay {
	type: "gradient" | "vignette" | "color";
	/** For gradient: CSS color stops */
	colors?: string[];
	/** For gradient: angle in degrees */
	angle?: number;
	/** For color overlay: single colour */
	color?: string;
	opacity: number;
}

export interface ThumbnailEmojiLayer {
	emoji: string;
	x: number;
	y: number;
	fontSize: number;
	rotation: number;
}

export interface ThumbnailTemplate {
	id: string;
	name: string;
	category: string;
	/** Output dimensions */
	width: number;
	height: number;
	/** Background treatment (applied on top of the selected frame) */
	overlays: ThumbnailOverlay[];
	textLayers: ThumbnailTextLayer[];
	emojiLayers: ThumbnailEmojiLayer[];
}

// ── Built-in templates ──────────────────────────────────────────────────────

export const THUMBNAIL_TEMPLATES: ThumbnailTemplate[] = [
	{
		id: "mrbeast-bold",
		name: "MrBeast Bold",
		category: "YouTube",
		width: 1280,
		height: 720,
		overlays: [
			{ type: "gradient", colors: ["rgba(0,0,0,0)", "rgba(0,0,0,0.7)"], angle: 180, opacity: 1 },
		],
		textLayers: [
			{
				text: "YOUR TITLE HERE",
				x: 50,
				y: 78,
				fontSize: 72,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#FFFFFF",
				outlineColor: "#000000",
				outlineWidth: 6,
				glowRadius: 0,
				glowColor: "",
				rotation: 0,
				textAlign: "center",
				maxWidth: 90,
			},
		],
		emojiLayers: [],
	},
	{
		id: "mrbeast-money",
		name: "MrBeast $$$",
		category: "YouTube",
		width: 1280,
		height: 720,
		overlays: [
			{
				type: "gradient",
				colors: ["rgba(34,197,94,0.4)", "rgba(0,0,0,0.8)"],
				angle: 180,
				opacity: 1,
			},
		],
		textLayers: [
			{
				text: "$1,000,000",
				x: 50,
				y: 25,
				fontSize: 96,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#22C55E",
				outlineColor: "#000000",
				outlineWidth: 8,
				glowRadius: 20,
				glowColor: "rgba(34,197,94,0.6)",
				rotation: -3,
				textAlign: "center",
			},
			{
				text: "CHALLENGE",
				x: 50,
				y: 82,
				fontSize: 64,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#FFFFFF",
				outlineColor: "#000000",
				outlineWidth: 5,
				glowRadius: 0,
				glowColor: "",
				rotation: 0,
				textAlign: "center",
			},
		],
		emojiLayers: [
			{ emoji: "💰", x: 8, y: 20, fontSize: 80, rotation: -15 },
			{ emoji: "💰", x: 92, y: 20, fontSize: 80, rotation: 15 },
		],
	},
	{
		id: "shocked-reaction",
		name: "Shocked Face",
		category: "YouTube",
		width: 1280,
		height: 720,
		overlays: [
			{
				type: "gradient",
				colors: ["rgba(224,0,15,0.3)", "rgba(0,0,0,0.85)"],
				angle: 180,
				opacity: 1,
			},
		],
		textLayers: [
			{
				text: "NO WAY...",
				x: 50,
				y: 20,
				fontSize: 84,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#FFD700",
				outlineColor: "#000000",
				outlineWidth: 7,
				glowRadius: 15,
				glowColor: "rgba(255,215,0,0.5)",
				rotation: 0,
				textAlign: "center",
			},
		],
		emojiLayers: [{ emoji: "😱", x: 85, y: 65, fontSize: 100, rotation: 10 }],
	},
	{
		id: "red-alert",
		name: "Red Alert",
		category: "Drama",
		width: 1280,
		height: 720,
		overlays: [
			{ type: "color", color: "#E0000F", opacity: 0.25 },
			{ type: "vignette", opacity: 0.8 },
		],
		textLayers: [
			{
				text: "GONE WRONG",
				x: 50,
				y: 75,
				fontSize: 80,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#E0000F",
				outlineColor: "#FFFFFF",
				outlineWidth: 5,
				glowRadius: 25,
				glowColor: "rgba(224,0,15,0.6)",
				rotation: -2,
				textAlign: "center",
			},
		],
		emojiLayers: [
			{ emoji: "🔴", x: 10, y: 12, fontSize: 50, rotation: 0 },
			{ emoji: "⚠️", x: 90, y: 12, fontSize: 50, rotation: 0 },
		],
	},
	{
		id: "clean-minimal",
		name: "Clean Minimal",
		category: "Professional",
		width: 1280,
		height: 720,
		overlays: [
			{ type: "gradient", colors: ["rgba(0,0,0,0)", "rgba(0,0,0,0.6)"], angle: 180, opacity: 1 },
		],
		textLayers: [
			{
				text: "Video Title",
				x: 50,
				y: 82,
				fontSize: 52,
				fontFamily: "'Segoe UI', Helvetica, Arial, sans-serif",
				fontWeight: "bold",
				color: "#FFFFFF",
				outlineColor: "rgba(0,0,0,0.6)",
				outlineWidth: 3,
				glowRadius: 0,
				glowColor: "",
				rotation: 0,
				textAlign: "center",
			},
		],
		emojiLayers: [],
	},
	{
		id: "neon-glow",
		name: "Neon Glow",
		category: "Gaming",
		width: 1280,
		height: 720,
		overlays: [
			{ type: "color", color: "#0F0025", opacity: 0.5 },
			{ type: "vignette", opacity: 0.7 },
		],
		textLayers: [
			{
				text: "EPIC WIN",
				x: 50,
				y: 50,
				fontSize: 90,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#00FFFF",
				outlineColor: "#001122",
				outlineWidth: 4,
				glowRadius: 40,
				glowColor: "rgba(0,255,255,0.7)",
				rotation: 0,
				textAlign: "center",
			},
		],
		emojiLayers: [
			{ emoji: "🎮", x: 10, y: 45, fontSize: 70, rotation: -10 },
			{ emoji: "🏆", x: 90, y: 45, fontSize: 70, rotation: 10 },
		],
	},
	{
		id: "countdown",
		name: "Countdown",
		category: "YouTube",
		width: 1280,
		height: 720,
		overlays: [
			{
				type: "gradient",
				colors: ["rgba(147,51,234,0.4)", "rgba(0,0,0,0.85)"],
				angle: 135,
				opacity: 1,
			},
		],
		textLayers: [
			{
				text: "TOP 10",
				x: 50,
				y: 25,
				fontSize: 96,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#FBBF24",
				outlineColor: "#000000",
				outlineWidth: 7,
				glowRadius: 20,
				glowColor: "rgba(251,191,36,0.5)",
				rotation: 0,
				textAlign: "center",
			},
			{
				text: "You Won't Believe #1",
				x: 50,
				y: 80,
				fontSize: 48,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#FFFFFF",
				outlineColor: "#000000",
				outlineWidth: 4,
				glowRadius: 0,
				glowColor: "",
				rotation: 0,
				textAlign: "center",
			},
		],
		emojiLayers: [],
	},
	{
		id: "before-after",
		name: "Before & After",
		category: "Tutorial",
		width: 1280,
		height: 720,
		overlays: [
			{ type: "gradient", colors: ["rgba(0,0,0,0.3)", "rgba(0,0,0,0.7)"], angle: 90, opacity: 1 },
		],
		textLayers: [
			{
				text: "BEFORE",
				x: 25,
				y: 50,
				fontSize: 56,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#EF4444",
				outlineColor: "#000000",
				outlineWidth: 5,
				glowRadius: 12,
				glowColor: "rgba(239,68,68,0.5)",
				rotation: 0,
				textAlign: "center",
			},
			{
				text: "AFTER",
				x: 75,
				y: 50,
				fontSize: 56,
				fontFamily: "Impact, Arial Black, sans-serif",
				fontWeight: "bold",
				color: "#22C55E",
				outlineColor: "#000000",
				outlineWidth: 5,
				glowRadius: 12,
				glowColor: "rgba(34,197,94,0.5)",
				rotation: 0,
				textAlign: "center",
			},
		],
		emojiLayers: [{ emoji: "➡️", x: 50, y: 50, fontSize: 60, rotation: 0 }],
	},
];

// ── Renderer ────────────────────────────────────────────────────────────────

function drawOverlay(
	ctx: CanvasRenderingContext2D,
	overlay: ThumbnailOverlay,
	w: number,
	h: number,
) {
	ctx.save();
	ctx.globalAlpha = overlay.opacity;

	if (overlay.type === "color" && overlay.color) {
		ctx.fillStyle = overlay.color;
		ctx.fillRect(0, 0, w, h);
	} else if (overlay.type === "gradient" && overlay.colors && overlay.colors.length >= 2) {
		const angle = ((overlay.angle ?? 180) * Math.PI) / 180;
		const cx = w / 2;
		const cy = h / 2;
		const len = Math.max(w, h);
		const x0 = cx - (Math.cos(angle) * len) / 2;
		const y0 = cy - (Math.sin(angle) * len) / 2;
		const x1 = cx + (Math.cos(angle) * len) / 2;
		const y1 = cy + (Math.sin(angle) * len) / 2;
		const grad = ctx.createLinearGradient(x0, y0, x1, y1);
		overlay.colors.forEach((c, i) => {
			grad.addColorStop(i / (overlay.colors!.length - 1), c);
		});
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, w, h);
	} else if (overlay.type === "vignette") {
		const grad = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.75);
		grad.addColorStop(0, "rgba(0,0,0,0)");
		grad.addColorStop(1, "rgba(0,0,0,1)");
		ctx.fillStyle = grad;
		ctx.fillRect(0, 0, w, h);
	}

	ctx.restore();
}

function drawTextLayer(
	ctx: CanvasRenderingContext2D,
	layer: ThumbnailTextLayer,
	w: number,
	h: number,
) {
	const x = (layer.x / 100) * w;
	const y = (layer.y / 100) * h;
	const maxPx = layer.maxWidth ? (layer.maxWidth / 100) * w : undefined;

	ctx.save();
	ctx.translate(x, y);
	if (layer.rotation) {
		ctx.rotate((layer.rotation * Math.PI) / 180);
	}

	ctx.font = `${layer.fontWeight} ${layer.fontSize}px ${layer.fontFamily}`;
	ctx.textAlign = layer.textAlign;
	ctx.textBaseline = "middle";

	// Glow pass
	if (layer.glowRadius > 0 && layer.glowColor) {
		ctx.shadowColor = layer.glowColor;
		ctx.shadowBlur = layer.glowRadius;
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;
		ctx.fillStyle = layer.color;
		ctx.fillText(layer.text, 0, 0, maxPx);
		// Second pass for stronger glow
		ctx.fillText(layer.text, 0, 0, maxPx);
	}

	// Reset shadow
	ctx.shadowColor = "transparent";
	ctx.shadowBlur = 0;

	// Outline
	if (layer.outlineWidth > 0) {
		ctx.strokeStyle = layer.outlineColor;
		ctx.lineWidth = layer.outlineWidth * 2;
		ctx.lineJoin = "round";
		ctx.miterLimit = 2;
		ctx.strokeText(layer.text, 0, 0, maxPx);
	}

	// Fill
	ctx.fillStyle = layer.color;
	ctx.fillText(layer.text, 0, 0, maxPx);

	ctx.restore();
}

function drawEmojiLayer(
	ctx: CanvasRenderingContext2D,
	layer: ThumbnailEmojiLayer,
	w: number,
	h: number,
) {
	const x = (layer.x / 100) * w;
	const y = (layer.y / 100) * h;

	ctx.save();
	ctx.translate(x, y);
	if (layer.rotation) {
		ctx.rotate((layer.rotation * Math.PI) / 180);
	}
	ctx.font = `${layer.fontSize}px serif`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(layer.emoji, 0, 0);
	ctx.restore();
}

/**
 * Render a thumbnail by compositing the base frame + template layers.
 * Returns a data-URL (PNG).
 */
export async function renderThumbnail(
	baseFrameDataUrl: string,
	template: ThumbnailTemplate,
	/** Override text layers — array in same order as template.textLayers */
	textOverrides?: string[],
): Promise<string> {
	const canvas = document.createElement("canvas");
	canvas.width = template.width;
	canvas.height = template.height;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("Canvas context unavailable");

	// 1. Draw base frame (cover-fit)
	const img = await loadImage(baseFrameDataUrl);
	const imgAspect = img.width / img.height;
	const canvasAspect = template.width / template.height;
	let sx = 0;
	let sy = 0;
	let sw = img.width;
	let sh = img.height;

	if (imgAspect > canvasAspect) {
		sw = Math.round(img.height * canvasAspect);
		sx = Math.round((img.width - sw) / 2);
	} else {
		sh = Math.round(img.width / canvasAspect);
		sy = Math.round((img.height - sh) / 2);
	}
	ctx.drawImage(img, sx, sy, sw, sh, 0, 0, template.width, template.height);

	// 2. Overlays
	for (const overlay of template.overlays) {
		drawOverlay(ctx, overlay, template.width, template.height);
	}

	// 3. Text layers (with optional overrides)
	template.textLayers.forEach((layer, i) => {
		const text = textOverrides?.[i] ?? layer.text;
		drawTextLayer(ctx, { ...layer, text }, template.width, template.height);
	});

	// 4. Emoji layers
	for (const emoji of template.emojiLayers) {
		drawEmojiLayer(ctx, emoji, template.width, template.height);
	}

	return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new window.Image();
		img.onload = () => resolve(img);
		img.onerror = reject;
		img.src = src;
	});
}

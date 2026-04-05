// ── Motion Graphics Templates ───────────────────────────────────────────────
// Pre-built animated text overlay templates for intros, lower thirds, end cards, etc.

export type TemplateCategory = "intro" | "lower-third" | "end-card" | "cta" | "title";

export interface MotionTemplateField {
  key: string;
  label: string;
  defaultValue: string;
  type: "text" | "color";
}

export interface MotionTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  durationMs: number;
  fields: MotionTemplateField[];
  /** Render function: ctx, width, height, progress (0-1), field values */
  render: (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    progress: number,
    values: Record<string, string>,
  ) => void;
}

// ── Easing helpers ──────────────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t));
}

// ── Drawing helpers ─────────────────────────────────────────────────────────

function drawRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    // Fallback for older browsers
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
  }
  ctx.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace("#", "");
  const r = Number.parseInt(c.substring(0, 2), 16);
  const g = Number.parseInt(c.substring(2, 4), 16);
  const b = Number.parseInt(c.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Templates ───────────────────────────────────────────────────────────────

const slideInTitle: MotionTemplate = {
  id: "slide-in-title",
  name: "Slide In Title",
  category: "intro",
  durationMs: 4000,
  fields: [
    { key: "title", label: "Title", defaultValue: "Welcome", type: "text" },
    { key: "subtitle", label: "Subtitle", defaultValue: "Your subtitle here", type: "text" },
    { key: "color", label: "Color", defaultValue: "#ffffff", type: "color" },
  ],
  render(ctx, width, height, progress, values) {
    const title = values.title || "Welcome";
    const subtitle = values.subtitle || "";
    const color = values.color || "#ffffff";

    // Phase: 0-0.2 slide in, 0.2-0.8 hold, 0.8-1.0 fade out
    const slideIn = easeOutCubic(clamp01(progress / 0.2));
    const fadeOut = progress > 0.8 ? 1 - easeInCubic(clamp01((progress - 0.8) / 0.2)) : 1;

    const offsetX = (1 - slideIn) * -width * 0.3;

    ctx.save();
    ctx.globalAlpha = fadeOut;

    // Title
    const titleSize = Math.round(height * 0.08);
    ctx.font = `bold ${titleSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textBaseline = "middle";
    ctx.fillText(title, width * 0.08 + offsetX, height * 0.45);

    // Subtitle
    if (subtitle) {
      const subSize = Math.round(height * 0.04);
      ctx.font = `${subSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
      ctx.fillStyle = hexToRgba(color, 0.7);
      ctx.fillText(subtitle, width * 0.08 + offsetX, height * 0.45 + titleSize * 1.2);
    }

    // Accent line
    const lineWidth = slideIn * width * 0.15;
    ctx.fillStyle = "#E0000F";
    ctx.fillRect(width * 0.08 + offsetX, height * 0.45 - titleSize * 0.8, lineWidth, 3);

    ctx.restore();
  },
};

const lowerThirdBar: MotionTemplate = {
  id: "lower-third-bar",
  name: "Lower Third Bar",
  category: "lower-third",
  durationMs: 5000,
  fields: [
    { key: "name", label: "Name", defaultValue: "John Doe", type: "text" },
    { key: "title", label: "Title", defaultValue: "Software Engineer", type: "text" },
    { key: "barColor", label: "Bar Color", defaultValue: "#E0000F", type: "color" },
  ],
  render(ctx, width, height, progress, values) {
    const name = values.name || "John Doe";
    const title = values.title || "";
    const barColor = values.barColor || "#E0000F";

    // Phase: 0-0.15 bar grows, 0.15-0.85 hold, 0.85-1.0 bar shrinks
    const growIn = easeOutCubic(clamp01(progress / 0.15));
    const shrinkOut = progress > 0.85 ? 1 - easeOutCubic(clamp01((progress - 0.85) / 0.15)) : 1;
    const barProgress = growIn * shrinkOut;

    const barX = width * 0.06;
    const barY = height * 0.78;
    const barW = barProgress * width * 0.4;
    const barH = height * 0.12;

    ctx.save();

    // Background bar
    drawRoundRect(ctx, barX, barY, barW, barH, 6);
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fill();

    // Accent strip on the left
    if (barW > 8) {
      ctx.fillStyle = barColor;
      ctx.fillRect(barX, barY, 4, barH);
    }

    // Text (only show when bar is wide enough)
    if (barProgress > 0.3) {
      const textAlpha = clamp01((barProgress - 0.3) / 0.2);
      ctx.globalAlpha = textAlpha;

      const nameSize = Math.round(height * 0.035);
      ctx.font = `bold ${nameSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "middle";
      ctx.fillText(name, barX + 16, barY + barH * 0.38);

      if (title) {
        const titleSize = Math.round(height * 0.025);
        ctx.font = `${titleSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(title, barX + 16, barY + barH * 0.68);
      }
    }

    ctx.restore();
  },
};

const subscribeCta: MotionTemplate = {
  id: "subscribe-cta",
  name: "Subscribe CTA",
  category: "cta",
  durationMs: 4000,
  fields: [
    { key: "channelName", label: "Channel Name", defaultValue: "My Channel", type: "text" },
    { key: "color", label: "Color", defaultValue: "#E0000F", type: "color" },
  ],
  render(ctx, width, height, progress, values) {
    const channelName = values.channelName || "My Channel";
    const color = values.color || "#E0000F";

    // Phase: 0-0.2 pop in, 0.2-0.8 hold with pulse, 0.8-1.0 pop out
    const popIn = easeOutCubic(clamp01(progress / 0.2));
    const popOut = progress > 0.8 ? 1 - easeInCubic(clamp01((progress - 0.8) / 0.2)) : 1;
    const scale = popIn * popOut;

    // Subtle pulse during hold phase
    const pulse = progress > 0.2 && progress < 0.8
      ? 1 + Math.sin((progress - 0.2) * Math.PI * 8) * 0.02
      : 1;

    const cx = width * 0.5;
    const cy = height * 0.82;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale * pulse, scale * pulse);

    // Subscribe button
    const btnW = width * 0.22;
    const btnH = height * 0.06;
    drawRoundRect(ctx, -btnW / 2, -btnH / 2, btnW, btnH, btnH / 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Bell icon (simplified)
    const bellX = -btnW / 2 + 14;
    const bellY = -2;
    const bellSize = btnH * 0.35;
    ctx.beginPath();
    ctx.arc(bellX, bellY - bellSize * 0.4, bellSize * 0.3, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(bellX - bellSize * 0.5, bellY);
    ctx.quadraticCurveTo(bellX - bellSize * 0.5, bellY - bellSize, bellX, bellY - bellSize);
    ctx.quadraticCurveTo(bellX + bellSize * 0.5, bellY - bellSize, bellX + bellSize * 0.5, bellY);
    ctx.lineTo(bellX - bellSize * 0.5, bellY);
    ctx.fill();

    // Text
    const textSize = Math.round(btnH * 0.45);
    ctx.font = `bold ${textSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SUBSCRIBE", 8, 0);

    // Channel name above
    const chSize = Math.round(height * 0.025);
    ctx.font = `${chSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillText(channelName, 0, -btnH / 2 - chSize * 1.2);

    ctx.restore();
  },
};

const endCard: MotionTemplate = {
  id: "end-card",
  name: "End Card",
  category: "end-card",
  durationMs: 6000,
  fields: [
    { key: "message", label: "Message", defaultValue: "Thanks for watching!", type: "text" },
    { key: "handle", label: "Social Handle", defaultValue: "@yourhandle", type: "text" },
    { key: "bgColor", label: "Background", defaultValue: "#1a1a2e", type: "color" },
  ],
  render(ctx, width, height, progress, values) {
    const message = values.message || "Thanks for watching!";
    const handle = values.handle || "@yourhandle";
    const bgColor = values.bgColor || "#1a1a2e";

    // Fade in: 0-0.15, hold: 0.15-0.85, fade out: 0.85-1.0
    const fadeIn = easeOutCubic(clamp01(progress / 0.15));
    const fadeOut = progress > 0.85 ? 1 - easeInCubic(clamp01((progress - 0.85) / 0.15)) : 1;
    const alpha = fadeIn * fadeOut;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Background gradient
    const grad = ctx.createRadialGradient(
      width * 0.5, height * 0.5, 0,
      width * 0.5, height * 0.5, width * 0.6,
    );
    grad.addColorStop(0, hexToRgba(bgColor, 0.9));
    grad.addColorStop(1, hexToRgba(bgColor, 0.6));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    // Message
    const msgSize = Math.round(height * 0.07);
    ctx.font = `bold ${msgSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(message, width * 0.5, height * 0.42);

    // Handle
    const handleSize = Math.round(height * 0.035);
    ctx.font = `${handleSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText(handle, width * 0.5, height * 0.42 + msgSize * 1.5);

    // Decorative line
    const lineW = easeOutCubic(clamp01((progress - 0.1) / 0.2)) * width * 0.2;
    ctx.fillStyle = "#E0000F";
    ctx.fillRect(width * 0.5 - lineW / 2, height * 0.42 + msgSize * 2.2, lineW, 2);

    ctx.restore();
  },
};

const chapterTitle: MotionTemplate = {
  id: "chapter-title",
  name: "Chapter Title",
  category: "title",
  durationMs: 3000,
  fields: [
    { key: "text", label: "Title Text", defaultValue: "Chapter 1", type: "text" },
    { key: "color", label: "Color", defaultValue: "#ffffff", type: "color" },
  ],
  render(ctx, width, height, progress, values) {
    const text = values.text || "Chapter 1";
    const color = values.color || "#ffffff";

    // Fade in with subtle zoom: 0-0.25, hold: 0.25-0.75, fade out: 0.75-1.0
    const fadeIn = easeOutCubic(clamp01(progress / 0.25));
    const fadeOut = progress > 0.75 ? 1 - easeInCubic(clamp01((progress - 0.75) / 0.25)) : 1;
    const alpha = fadeIn * fadeOut;
    const zoom = 0.9 + fadeIn * 0.1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(width * 0.5, height * 0.5);
    ctx.scale(zoom, zoom);

    // Background pill
    const textSize = Math.round(height * 0.09);
    ctx.font = `bold ${textSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
    const metrics = ctx.measureText(text);
    const pillW = metrics.width + textSize * 1.5;
    const pillH = textSize * 1.8;
    drawRoundRect(ctx, -pillW / 2, -pillH / 2, pillW, pillH, pillH * 0.15);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fill();

    // Text
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0);

    ctx.restore();
  },
};

const countdown: MotionTemplate = {
  id: "countdown",
  name: "Countdown",
  category: "intro",
  durationMs: 4000,
  fields: [
    { key: "startNum", label: "Start Number", defaultValue: "3", type: "text" },
    { key: "color", label: "Color", defaultValue: "#E0000F", type: "color" },
  ],
  render(ctx, width, height, progress, values) {
    const startNum = Math.max(1, Math.min(10, Number.parseInt(values.startNum, 10) || 3));
    const color = values.color || "#E0000F";

    // Each number takes an equal slice, last 10% reserved for "GO"
    const numPhase = progress * (startNum + 1); // 0 to startNum+1
    const currentIdx = Math.floor(numPhase);
    const localProgress = numPhase - currentIdx;

    ctx.save();
    ctx.translate(width * 0.5, height * 0.5);

    let displayText: string;
    if (currentIdx >= startNum) {
      displayText = "GO";
    } else {
      displayText = String(startNum - currentIdx);
    }

    // Scale: pop in then shrink
    const popScale = localProgress < 0.3
      ? easeOutCubic(localProgress / 0.3) * 1.2
      : 1.2 - (localProgress - 0.3) * 0.3;
    const alpha = localProgress < 0.1
      ? easeOutCubic(localProgress / 0.1)
      : localProgress > 0.8
        ? 1 - easeInCubic((localProgress - 0.8) / 0.2)
        : 1;

    ctx.globalAlpha = clamp01(alpha);
    ctx.scale(popScale, popScale);

    // Circle background
    const radius = height * 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(color, 0.3);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();

    // Progress arc
    const arcProgress = 1 - localProgress;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 4, -Math.PI / 2, -Math.PI / 2 + arcProgress * Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.stroke();

    // Number text
    const numSize = Math.round(radius * 1.2);
    ctx.font = `bold ${numSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(displayText, 0, 0);

    ctx.restore();
  },
};

const focusReveal: MotionTemplate = {
  id: "focus-reveal",
  name: "Focus Reveal",
  category: "title",
  durationMs: 3500,
  fields: [
    { key: "text", label: "Text", defaultValue: "Key Point", type: "text" },
    { key: "color", label: "Color", defaultValue: "#ffffff", type: "color" },
  ],
  render(ctx, width, height, progress, values) {
    const text = values.text || "Key Point";
    const color = values.color || "#ffffff";

    // Cinematic reveal: line draws, then text appears
    const lineGrow = easeOutCubic(clamp01(progress / 0.3));
    const textFade = easeOutCubic(clamp01((progress - 0.15) / 0.2));
    const fadeOut = progress > 0.8 ? 1 - easeInCubic(clamp01((progress - 0.8) / 0.2)) : 1;

    ctx.save();
    ctx.globalAlpha = fadeOut;

    const cx = width * 0.5;
    const cy = height * 0.5;
    const lineW = lineGrow * width * 0.35;

    // Horizontal lines
    ctx.strokeStyle = hexToRgba(color, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - lineW / 2, cy - 20);
    ctx.lineTo(cx + lineW / 2, cy - 20);
    ctx.moveTo(cx - lineW / 2, cy + 20);
    ctx.lineTo(cx + lineW / 2, cy + 20);
    ctx.stroke();

    // Text
    ctx.globalAlpha = textFade * fadeOut;
    const textSize = Math.round(height * 0.06);
    ctx.font = `600 ${textSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, cy);

    ctx.restore();
  },
};

const minimalLowerThird: MotionTemplate = {
  id: "minimal-lower-third",
  name: "Minimal Lower Third",
  category: "lower-third",
  durationMs: 4000,
  fields: [
    { key: "name", label: "Name", defaultValue: "Jane Smith", type: "text" },
    { key: "title", label: "Title", defaultValue: "Creative Director", type: "text" },
    { key: "barColor", label: "Accent Color", defaultValue: "#0A84FF", type: "color" },
  ],
  render(ctx, width, height, progress, values) {
    const name = values.name || "Jane Smith";
    const title = values.title || "";
    const barColor = values.barColor || "#0A84FF";

    // Fade up: 0-0.15, hold: 0.15-0.85, fade down: 0.85-1.0
    const slideUp = easeOutCubic(clamp01(progress / 0.15));
    const slideDown = progress > 0.85 ? easeInCubic(clamp01((progress - 0.85) / 0.15)) : 0;
    const offsetY = (1 - slideUp) * 20 + slideDown * 20;
    const alpha = slideUp * (1 - slideDown);

    ctx.save();
    ctx.globalAlpha = alpha;

    const baseY = height * 0.82 + offsetY;

    // Accent dot
    ctx.beginPath();
    ctx.arc(width * 0.06, baseY, 4, 0, Math.PI * 2);
    ctx.fillStyle = barColor;
    ctx.fill();

    // Name
    const nameSize = Math.round(height * 0.032);
    ctx.font = `600 ${nameSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(name, width * 0.06 + 14, baseY);

    // Title (lighter)
    if (title) {
      const metrics = ctx.measureText(name);
      const titleSize = Math.round(height * 0.024);
      ctx.font = `400 ${titleSize}px "SF Pro Display", "Inter", system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillText(` ${title}`, width * 0.06 + 14 + metrics.width + 8, baseY);
    }

    ctx.restore();
  },
};

// ── Exports ─────────────────────────────────────────────────────────────────

export const MOTION_TEMPLATES: MotionTemplate[] = [
  slideInTitle,
  lowerThirdBar,
  subscribeCta,
  endCard,
  chapterTitle,
  countdown,
  focusReveal,
  minimalLowerThird,
];

export const TEMPLATE_CATEGORIES: { id: TemplateCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "intro", label: "Intro" },
  { id: "lower-third", label: "Lower Third" },
  { id: "end-card", label: "End Card" },
  { id: "cta", label: "CTA" },
  { id: "title", label: "Title" },
];

/**
 * Render a template at a given progress to an offscreen canvas and return a data URL.
 */
export function renderTemplateToDataUrl(
  template: MotionTemplate,
  values: Record<string, string>,
  progress: number,
  width = 640,
  height = 360,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.clearRect(0, 0, width, height);
  template.render(ctx, width, height, progress, values);
  return canvas.toDataURL("image/png");
}

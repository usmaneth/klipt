import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveAnnotation, LiveAnnotationFadeOption, LiveAnnotationTool } from "../video-editor/types";

interface AnnotationCanvasProps {
	isActive: boolean;
	activeTool: LiveAnnotationTool;
	color: string;
	strokeWidth: number;
	fadeDuration: LiveAnnotationFadeOption;
	recordingStartMs: number;
	onAnnotationComplete: (annotation: LiveAnnotation) => void;
	annotations: LiveAnnotation[];
	onTextSubmit?: (text: string, x: number, y: number) => void;
}

function generateId(): string {
	return `la-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AnnotationCanvas({
	isActive,
	activeTool,
	color,
	strokeWidth,
	fadeDuration,
	recordingStartMs,
	onAnnotationComplete,
	annotations,
	onTextSubmit,
}: AnnotationCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const currentPointsRef = useRef<Array<{ x: number; y: number }>>([]);
	const isDrawingRef = useRef(false);
	const [textInput, setTextInput] = useState<{ x: number; y: number; visible: boolean }>({
		x: 0,
		y: 0,
		visible: false,
	});
	const [textValue, setTextValue] = useState("");
	const animFrameRef = useRef<number>(0);

	const normalizePoint = useCallback(
		(clientX: number, clientY: number) => {
			const canvas = canvasRef.current;
			if (!canvas) return { x: 0, y: 0 };
			const rect = canvas.getBoundingClientRect();
			return {
				x: (clientX - rect.left) / rect.width,
				y: (clientY - rect.top) / rect.height,
			};
		},
		[],
	);

	const drawAnnotation = useCallback(
		(ctx: CanvasRenderingContext2D, ann: LiveAnnotation, w: number, h: number, alpha: number) => {
			ctx.save();
			ctx.globalAlpha = alpha;
			ctx.strokeStyle = ann.color;
			ctx.fillStyle = ann.color;
			ctx.lineWidth = ann.strokeWidth;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";

			const pts = ann.points.map((p) => ({ x: p.x * w, y: p.y * h }));

			switch (ann.type) {
				case "pen": {
					if (pts.length < 2) break;
					ctx.beginPath();
					ctx.moveTo(pts[0].x, pts[0].y);
					for (let i = 1; i < pts.length; i++) {
						ctx.lineTo(pts[i].x, pts[i].y);
					}
					ctx.stroke();
					break;
				}
				case "highlight": {
					if (pts.length < 2) break;
					ctx.globalAlpha = alpha * 0.35;
					ctx.lineWidth = ann.strokeWidth * 4;
					ctx.beginPath();
					ctx.moveTo(pts[0].x, pts[0].y);
					for (let i = 1; i < pts.length; i++) {
						ctx.lineTo(pts[i].x, pts[i].y);
					}
					ctx.stroke();
					break;
				}
				case "arrow": {
					if (pts.length < 2) break;
					const start = pts[0];
					const end = pts[pts.length - 1];
					ctx.beginPath();
					ctx.moveTo(start.x, start.y);
					ctx.lineTo(end.x, end.y);
					ctx.stroke();
					// Arrowhead
					const angle = Math.atan2(end.y - start.y, end.x - start.x);
					const headLen = 12 + ann.strokeWidth * 2;
					ctx.beginPath();
					ctx.moveTo(end.x, end.y);
					ctx.lineTo(
						end.x - headLen * Math.cos(angle - Math.PI / 6),
						end.y - headLen * Math.sin(angle - Math.PI / 6),
					);
					ctx.lineTo(
						end.x - headLen * Math.cos(angle + Math.PI / 6),
						end.y - headLen * Math.sin(angle + Math.PI / 6),
					);
					ctx.closePath();
					ctx.fill();
					break;
				}
				case "rect": {
					if (pts.length < 2) break;
					const p0 = pts[0];
					const p1 = pts[pts.length - 1];
					ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
					break;
				}
				case "circle": {
					if (pts.length < 2) break;
					const c0 = pts[0];
					const c1 = pts[pts.length - 1];
					const rx = Math.abs(c1.x - c0.x) / 2;
					const ry = Math.abs(c1.y - c0.y) / 2;
					const cx = (c0.x + c1.x) / 2;
					const cy = (c0.y + c1.y) / 2;
					ctx.beginPath();
					ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
					ctx.stroke();
					break;
				}
				case "text": {
					if (!ann.text || pts.length < 1) break;
					const fontSize = Math.max(16, ann.strokeWidth * 6);
					ctx.font = `bold ${fontSize}px Inter, system-ui, sans-serif`;
					ctx.fillText(ann.text, pts[0].x, pts[0].y);
					break;
				}
			}
			ctx.restore();
		},
		[],
	);

	const renderLoop = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		const w = canvas.width;
		const h = canvas.height;
		const now = Date.now() - recordingStartMs;

		ctx.clearRect(0, 0, w, h);

		// Draw completed annotations
		for (const ann of annotations) {
			let alpha = 1;
			if (ann.durationMs > 0) {
				const elapsed = now - ann.startMs;
				if (elapsed > ann.durationMs) continue; // fully faded
				const fadeStart = ann.durationMs * 0.7;
				if (elapsed > fadeStart) {
					alpha = 1 - (elapsed - fadeStart) / (ann.durationMs - fadeStart);
				}
			}
			drawAnnotation(ctx, ann, w, h, alpha);
		}

		// Draw current in-progress stroke
		if (isDrawingRef.current && currentPointsRef.current.length > 1) {
			const tempAnn: LiveAnnotation = {
				id: "temp",
				type: activeTool,
				points: currentPointsRef.current,
				color,
				strokeWidth,
				startMs: 0,
				durationMs: -1,
			};
			drawAnnotation(ctx, tempAnn, w, h, 1);
		}

		animFrameRef.current = requestAnimationFrame(renderLoop);
	}, [annotations, activeTool, color, strokeWidth, recordingStartMs, drawAnnotation]);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const resize = () => {
			canvas.width = canvas.clientWidth * window.devicePixelRatio;
			canvas.height = canvas.clientHeight * window.devicePixelRatio;
		};
		resize();
		window.addEventListener("resize", resize);
		return () => window.removeEventListener("resize", resize);
	}, []);

	useEffect(() => {
		if (!isActive) return;
		animFrameRef.current = requestAnimationFrame(renderLoop);
		return () => cancelAnimationFrame(animFrameRef.current);
	}, [isActive, renderLoop]);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (!isActive) return;
			if (activeTool === "text") {
				const { x, y } = normalizePoint(e.clientX, e.clientY);
				setTextInput({ x: e.clientX, y: e.clientY, visible: true });
				setTextValue("");
				currentPointsRef.current = [{ x, y }];
				return;
			}
			isDrawingRef.current = true;
			currentPointsRef.current = [normalizePoint(e.clientX, e.clientY)];
		},
		[isActive, activeTool, normalizePoint],
	);

	const handleMouseMove = useCallback(
		(e: React.MouseEvent) => {
			if (!isDrawingRef.current || !isActive) return;
			const pt = normalizePoint(e.clientX, e.clientY);
			if (activeTool === "pen" || activeTool === "highlight") {
				currentPointsRef.current.push(pt);
			} else {
				// For shapes, keep start + current end
				currentPointsRef.current = [currentPointsRef.current[0], pt];
			}
		},
		[isActive, activeTool, normalizePoint],
	);

	const handleMouseUp = useCallback(() => {
		if (!isDrawingRef.current || !isActive) return;
		isDrawingRef.current = false;
		if (currentPointsRef.current.length < 2) return;

		const ann: LiveAnnotation = {
			id: generateId(),
			type: activeTool,
			points: [...currentPointsRef.current],
			color,
			strokeWidth,
			startMs: Date.now() - recordingStartMs,
			durationMs: fadeDuration,
		};
		onAnnotationComplete(ann);
		currentPointsRef.current = [];
	}, [isActive, activeTool, color, strokeWidth, fadeDuration, recordingStartMs, onAnnotationComplete]);

	const handleTextKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && textValue.trim()) {
				const points = currentPointsRef.current;
				if (points.length > 0) {
					const ann: LiveAnnotation = {
						id: generateId(),
						type: "text",
						points: [...points],
						color,
						strokeWidth,
						startMs: Date.now() - recordingStartMs,
						durationMs: fadeDuration,
						text: textValue.trim(),
					};
					onAnnotationComplete(ann);
					onTextSubmit?.(textValue.trim(), points[0].x, points[0].y);
				}
				setTextInput((p) => ({ ...p, visible: false }));
				setTextValue("");
				currentPointsRef.current = [];
			} else if (e.key === "Escape") {
				setTextInput((p) => ({ ...p, visible: false }));
				setTextValue("");
				currentPointsRef.current = [];
			}
		},
		[textValue, color, strokeWidth, fadeDuration, recordingStartMs, onAnnotationComplete, onTextSubmit],
	);

	if (!isActive) return null;

	return (
		<div className="absolute inset-0 z-[100]" style={{ pointerEvents: "auto" }}>
			<canvas
				ref={canvasRef}
				className="absolute inset-0 w-full h-full"
				style={{ cursor: activeTool === "text" ? "text" : "crosshair" }}
				onMouseDown={handleMouseDown}
				onMouseMove={handleMouseMove}
				onMouseUp={handleMouseUp}
				onMouseLeave={handleMouseUp}
			/>
			{textInput.visible && (
				<input
					type="text"
					value={textValue}
					onChange={(e) => setTextValue(e.target.value)}
					onKeyDown={handleTextKeyDown}
					onBlur={() => {
						setTextInput((p) => ({ ...p, visible: false }));
						setTextValue("");
					}}
					autoFocus
					className="absolute z-[110] px-2 py-1 text-sm bg-black/70 border border-white/30 text-white rounded-md outline-none"
					style={{ left: textInput.x, top: textInput.y - 30 }}
					placeholder="Type and press Enter"
				/>
			)}
		</div>
	);
}

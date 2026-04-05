import { Mic, RotateCcw, Sparkles } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { enhanceAudio, type DenoiseProfile } from "@/lib/audio/audioEnhancer";
import { generateWaveform } from "@/lib/audio/waveformGenerator";
import { cn } from "@/lib/utils";

interface StudioSoundPanelProps {
	videoUrl: string | null;
	audioEnhanced: boolean;
	enhancedAudioUrl: string | null;
	onEnhance: (blob: Blob) => void;
	onUndo: () => void;
}

type EnhanceStatus = "idle" | "processing" | "done";

const NUM_WAVEFORM_BARS = 64;

function WaveformCanvas({
	bars,
	color,
	height,
}: {
	bars: number[];
	color: string;
	height: number;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || bars.length === 0) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		const w = canvas.clientWidth;
		const h = canvas.clientHeight;
		canvas.width = w * dpr;
		canvas.height = h * dpr;
		ctx.scale(dpr, dpr);

		ctx.clearRect(0, 0, w, h);

		const barWidth = Math.max(1, (w / bars.length) * 0.7);
		const gap = (w - barWidth * bars.length) / bars.length;

		ctx.fillStyle = color;
		for (let i = 0; i < bars.length; i++) {
			const barHeight = Math.max(2, bars[i] * h * 0.9);
			const x = i * (barWidth + gap) + gap / 2;
			const y = (h - barHeight) / 2;
			ctx.beginPath();
			ctx.roundRect(x, y, barWidth, barHeight, 1);
			ctx.fill();
		}
	}, [bars, color]);

	return <canvas ref={canvasRef} className="w-full" style={{ height: `${height}px` }} />;
}

export const StudioSoundPanel = memo(function StudioSoundPanel({
	videoUrl,
	audioEnhanced,
	enhancedAudioUrl,
	onEnhance,
	onUndo,
}: StudioSoundPanelProps) {
	const [status, setStatus] = useState<EnhanceStatus>(audioEnhanced ? "done" : "idle");
	const [progress, setProgress] = useState(0);
	const [showAfter, setShowAfter] = useState(audioEnhanced);
	const [originalWaveform, setOriginalWaveform] = useState<number[]>([]);
	const [enhancedWaveform, setEnhancedWaveform] = useState<number[]>([]);
	const [denoiseProfile, setDenoiseProfile] = useState<DenoiseProfile>("moderate");
	const processingRef = useRef(false);

	// Decode waveform from a URL
	const decodeWaveform = useCallback(async (url: string): Promise<number[]> => {
		try {
			const response = await fetch(url);
			const arrayBuffer = await response.arrayBuffer();
			const audioCtx = new AudioContext();
			try {
				const buffer = await audioCtx.decodeAudioData(arrayBuffer);
				return generateWaveform(buffer, NUM_WAVEFORM_BARS);
			} finally {
				await audioCtx.close();
			}
		} catch {
			return [];
		}
	}, []);

	// Load original waveform when video URL changes
	useEffect(() => {
		if (!videoUrl) return;
		let cancelled = false;
		decodeWaveform(videoUrl).then((bars) => {
			if (!cancelled) setOriginalWaveform(bars);
		});
		return () => {
			cancelled = true;
		};
	}, [videoUrl, decodeWaveform]);

	// Load enhanced waveform when enhanced audio URL changes
	useEffect(() => {
		if (!enhancedAudioUrl) {
			setEnhancedWaveform([]);
			return;
		}
		let cancelled = false;
		decodeWaveform(enhancedAudioUrl).then((bars) => {
			if (!cancelled) setEnhancedWaveform(bars);
		});
		return () => {
			cancelled = true;
		};
	}, [enhancedAudioUrl, decodeWaveform]);

	// Sync status with external state
	useEffect(() => {
		if (audioEnhanced) {
			setStatus("done");
			setShowAfter(true);
		} else {
			setStatus("idle");
			setShowAfter(false);
		}
	}, [audioEnhanced]);

	const handleEnhance = useCallback(async () => {
		if (!videoUrl || processingRef.current) return;

		processingRef.current = true;
		setStatus("processing");
		setProgress(0);

		try {
			const blob = await enhanceAudio(videoUrl, (pct) => {
				setProgress(pct);
			}, denoiseProfile);
			onEnhance(blob);
			setStatus("done");
			setShowAfter(true);
			toast.success("Audio enhanced successfully");
		} catch (err) {
			console.error("[StudioSound] Enhancement failed:", err);
			setStatus("idle");
			const errMsg = err instanceof Error ? err.message : String(err);
			if (errMsg.includes("rnnoise") || errMsg.includes("wasm") || errMsg.includes("WebAssembly") || errMsg.includes("module")) {
				toast.error("Audio enhancement not available in this build");
			} else {
				toast.error("Audio enhancement failed");
			}
		} finally {
			processingRef.current = false;
		}
	}, [videoUrl, onEnhance, denoiseProfile]);

	const handleUndo = useCallback(() => {
		onUndo();
		setStatus("idle");
		setShowAfter(false);
		setEnhancedWaveform([]);
	}, [onUndo]);

	const statusLabel =
		status === "processing" ? "Processing..." : status === "done" ? "Enhanced" : "Original";

	const activeBars = showAfter && enhancedWaveform.length > 0 ? enhancedWaveform : originalWaveform;

	return (
		<div className="space-y-3">
			{/* Status indicator */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					<Mic
						className={cn(
							"w-3.5 h-3.5",
							status === "done"
								? "text-cyan-400 drop-shadow-[0_0_5px_rgba(34,211,238,0.6)]"
								: "text-slate-400",
						)}
					/>
					<span
						className={cn(
							"text-[10px] font-semibold tracking-wide",
							status === "done" ? "text-cyan-300" : "text-slate-400",
						)}
					>
						{statusLabel}
					</span>
				</div>
				{status === "done" && (
					<button
						type="button"
						onClick={() => setShowAfter(!showAfter)}
						className={cn(
							"text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border transition-all",
							showAfter
								? "text-cyan-300 bg-cyan-950/40 border-cyan-500/30 shadow-[0_0_10px_rgba(34,211,238,0.2)]"
								: "text-slate-400 bg-white/5 border-white/10",
						)}
					>
						{showAfter ? "After" : "Before"}
					</button>
				)}
			</div>

			{/* Waveform visualization */}
			{activeBars.length > 0 && (
				<div className="rounded-lg bg-white/[0.02] border border-white/5 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
					<WaveformCanvas
						bars={activeBars}
						color={
							showAfter && status === "done" ? "rgba(34,211,238,0.7)" : "rgba(148,163,184,0.5)"
						}
						height={40}
					/>
				</div>
			)}

			{/* Progress bar */}
			{status === "processing" && (
				<div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
					<div
						className="h-full rounded-full bg-gradient-to-r from-[#E0000F] to-[#FF4500] transition-all duration-300 ease-out shadow-[0_0_10px_rgba(224,0,15,0.4)]"
						style={{ width: `${progress}%` }}
					/>
				</div>
			)}

			{/* Denoise profile selector */}
			{status === "idle" && (
				<div className="flex items-center gap-1 p-0.5 rounded-lg bg-white/[0.03] border border-white/5">
					{(["light", "moderate", "aggressive"] as const).map((profile) => (
						<button
							key={profile}
							type="button"
							onClick={() => setDenoiseProfile(profile)}
							className={cn(
								"flex-1 text-[10px] font-semibold tracking-wide py-1.5 rounded-md transition-all capitalize",
								denoiseProfile === profile
									? "bg-gradient-to-r from-[#E0000F]/20 to-[#FF4500]/20 text-white border border-white/10 shadow-[0_0_8px_rgba(224,0,15,0.15)]"
									: "text-slate-500 hover:text-slate-300 border border-transparent",
							)}
						>
							{profile}
						</button>
					))}
				</div>
			)}

			{/* Action buttons */}
			{status === "idle" && (
				<Button
					type="button"
					onClick={handleEnhance}
					disabled={!videoUrl}
					className="w-full gap-2 h-8 text-xs font-semibold tracking-wide bg-gradient-to-r from-[#E0000F] to-[#FF4500] text-white rounded-lg shadow-[0_0_15px_rgba(224,0,15,0.3),inset_0_1px_0_rgba(255,255,255,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 border-none disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
				>
					<Sparkles className="w-3.5 h-3.5" />
					Enhance Audio
				</Button>
			)}

			{status === "done" && (
				<Button
					type="button"
					onClick={handleUndo}
					variant="outline"
					className="w-full gap-2 h-8 text-xs font-semibold tracking-wide bg-gradient-to-r from-white/[0.05] to-white/[0.02] text-slate-300 border-white/10 hover:bg-white/10 hover:border-white/20 hover:text-white rounded-lg transition-all"
				>
					<RotateCcw className="w-3.5 h-3.5" />
					Undo Enhancement
				</Button>
			)}
		</div>
	);
});

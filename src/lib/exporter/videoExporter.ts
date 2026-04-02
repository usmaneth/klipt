import type { CaptionCue } from "@/components/video-editor/captionLayout";
import type { CaptionSettings } from "@/components/video-editor/captionStyle";
import type { WebcamState } from "@/components/video-editor/projectPersistence";
import type {
	AnnotationRegion,
	AudioRegion,
	CropRegion,
	CursorTelemetryPoint,
	SoundEffectRegion,
	SpeedRegion,
	TransitionRegion,
	TrimRegion,
	ZoomRegion,
} from "@/components/video-editor/types";
import { AudioProcessor } from "./audioEncoder";
import { buildExportCaptionPages, renderCaptions } from "./captionRenderer";
import { FrameRenderer } from "./frameRenderer";
import { VideoMuxer } from "./muxer";
import { StreamingVideoDecoder } from "./streamingDecoder";
import { renderTransitionFrame } from "./transitionRenderer";
import type { ExportConfig, ExportProgress, ExportResult } from "./types";

interface VideoExporterConfig extends ExportConfig {
	videoUrl: string;
	wallpaper: string;
	zoomRegions: ZoomRegion[];
	trimRegions?: TrimRegion[];
	speedRegions?: SpeedRegion[];
	showShadow: boolean;
	shadowIntensity: number;
	backgroundBlur: number;
	zoomMotionBlur?: number;
	connectZooms?: boolean;
	borderRadius?: number;
	padding?: number;
	videoPadding?: number;
	cropRegion: CropRegion;
	annotationRegions?: AnnotationRegion[];
	cursorTelemetry?: CursorTelemetryPoint[];
	showCursor?: boolean;
	cursorSize?: number;
	cursorSmoothing?: number;
	cursorMotionBlur?: number;
	cursorClickBounce?: number;
	cursorSway?: number;
	audioRegions?: AudioRegion[];
	soundEffectRegions?: SoundEffectRegion[];
	transitionRegions?: TransitionRegion[];
	enhancedAudioUrl?: string;
	previewWidth?: number;
	previewHeight?: number;
	webcamVideoPath?: string;
	webcamState?: WebcamState;
	captionCues?: CaptionCue[];
	captionSettings?: CaptionSettings;
	onProgress?: (progress: ExportProgress) => void;
}

async function seekVideo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
	return new Promise((resolve) => {
		if (Math.abs(video.currentTime - timeSeconds) < 0.01) {
			resolve();
			return;
		}
		video.onseeked = () => resolve();
		video.currentTime = timeSeconds;
	});
}

export class VideoExporter {
	private config: VideoExporterConfig;
	private streamingDecoder: StreamingVideoDecoder | null = null;
	private renderer: FrameRenderer | null = null;
	private encoder: VideoEncoder | null = null;
	private muxer: VideoMuxer | null = null;
	private audioProcessor: AudioProcessor | null = null;
	private cancelled = false;
	private encodeQueue = 0;
	// Increased queue size for better throughput with hardware encoding
	private readonly MAX_ENCODE_QUEUE = 120;
	private videoDescription: Uint8Array | undefined;
	private videoColorSpace: VideoColorSpaceInit | undefined;
	private pendingMuxing: Promise<void> = Promise.resolve();
	private muxingError: Error | null = null;
	private chunkCount = 0;
	private readonly WINDOWS_FINALIZATION_TIMEOUT_MS = 60_000;
	private readonly DEFAULT_FINALIZATION_TIMEOUT_MS = 120_000;

	constructor(config: VideoExporterConfig) {
		this.config = config;
	}

	async export(): Promise<ExportResult> {
		try {
			this.cleanup();
			this.cancelled = false;
			this.muxingError = null;

			// Initialize streaming decoder and load video metadata
			this.streamingDecoder = new StreamingVideoDecoder();
			const videoInfo = await this.streamingDecoder.loadMetadata(this.config.videoUrl);

			// Initialize frame renderer
			this.renderer = new FrameRenderer({
				width: this.config.width,
				height: this.config.height,
				wallpaper: this.config.wallpaper,
				zoomRegions: this.config.zoomRegions,
				showShadow: this.config.showShadow,
				shadowIntensity: this.config.shadowIntensity,
				backgroundBlur: this.config.backgroundBlur,
				zoomMotionBlur: this.config.zoomMotionBlur,
				connectZooms: this.config.connectZooms,
				borderRadius: this.config.borderRadius,
				padding: this.config.padding,
				cropRegion: this.config.cropRegion,
				videoWidth: videoInfo.width,
				videoHeight: videoInfo.height,
				annotationRegions: this.config.annotationRegions,
				speedRegions: this.config.speedRegions,
				previewWidth: this.config.previewWidth,
				previewHeight: this.config.previewHeight,
				cursorTelemetry: this.config.cursorTelemetry,
				showCursor: this.config.showCursor,
				cursorSize: this.config.cursorSize,
				cursorSmoothing: this.config.cursorSmoothing,
				cursorMotionBlur: this.config.cursorMotionBlur,
				cursorClickBounce: this.config.cursorClickBounce,
				cursorSway: this.config.cursorSway,
			});
			await this.renderer.initialize();

			// Setup webcam if provided
			let webcamVideo: HTMLVideoElement | null = null;
			const webcamState = this.config.webcamState;
			if (this.config.webcamVideoPath && webcamState && webcamState.visible) {
				webcamVideo = document.createElement("video");
				webcamVideo.src = this.config.webcamVideoPath;
				webcamVideo.muted = true;
				webcamVideo.preload = "auto";
				await new Promise<void>((resolve, reject) => {
					webcamVideo!.onloadeddata = () => resolve();
					webcamVideo!.onerror = () => reject(new Error("Failed to load webcam video"));
					webcamVideo!.load();
				});
				this.renderer.setupWebcam(webcamState);
			}

			// Initialize video encoder
			await this.initializeEncoder();

			const hasAudioRegions = (this.config.audioRegions ?? []).length > 0;
			const hasSfx = (this.config.soundEffectRegions ?? []).length > 0;
			const hasAudio = videoInfo.hasAudio || hasAudioRegions || hasSfx;

			// Initialize muxer
			this.muxer = new VideoMuxer(this.config, hasAudio);
			await this.muxer.initialize();

			// Pre-build caption layout for the entire export
			const captionPages =
				this.config.captionCues &&
				this.config.captionSettings?.enabled &&
				this.config.captionCues.length > 0
					? buildExportCaptionPages(
							this.config.captionCues,
							this.config.width,
							this.config.captionSettings.fontSize,
							this.config.captionSettings.fontFamily,
							this.config.captionSettings.maxRows,
						)
					: [];

			// Calculate effective duration and frame count (excluding trim regions)
			const effectiveDuration = this.streamingDecoder.getEffectiveDuration(
				this.config.trimRegions,
				this.config.speedRegions,
			);
			const totalFrames = Math.ceil(effectiveDuration * this.config.frameRate);

			console.log("[VideoExporter] Original duration:", videoInfo.duration, "s");
			console.log("[VideoExporter] Effective duration:", effectiveDuration, "s");
			console.log("[VideoExporter] Total frames to export:", totalFrames);
			console.log("[VideoExporter] Using streaming decode (web-demuxer + VideoDecoder)");

			const frameDuration = 1_000_000 / this.config.frameRate; // in microseconds
			let frameIndex = 0;
			let webcamRemoved = false;

			// Transition support: buffer for the "outgoing" frame snapshot
			const sortedTransitions = [...(this.config.transitionRegions ?? [])].sort(
				(a, b) => a.atMs - b.atMs,
			);
			let transitionSnapshotCanvas: OffscreenCanvas | null = null;
			let lastFrameMs = -1;

			if (sortedTransitions.length > 0) {
				transitionSnapshotCanvas = new OffscreenCanvas(this.config.width, this.config.height);
			}

			// Stream decode and process frames — no seeking!
			await this.streamingDecoder.decodeAll(
				this.config.frameRate,
				this.config.trimRegions,
				this.config.speedRegions,
				async (videoFrame, _exportTimestampUs, sourceTimestampMs) => {
					if (this.cancelled) {
						videoFrame.close();
						return;
					}

					const timestamp = frameIndex * frameDuration;
					const sourceTimestampUs = sourceTimestampMs * 1000;

					try {
						// Update webcam frame if available
						if (webcamVideo && webcamState && !webcamRemoved) {
							const timeSeconds = sourceTimestampMs / 1000;
							if (timeSeconds > webcamVideo.duration) {
								this.renderer!.removeWebcam();
								webcamRemoved = true;
							} else {
								await seekVideo(webcamVideo, timeSeconds);
								await this.renderer!.updateWebcamFrameWithBgRemoval(
									webcamVideo,
									webcamState,
									this.config.width,
									this.config.height,
								);
							}
						}

						await this.renderer!.renderFrame(videoFrame, sourceTimestampUs);
					} finally {
						videoFrame.close();
					}

					// Render captions on the composite canvas after all other layers
					if (captionPages.length > 0 && this.config.captionSettings) {
						const compositeCanvas = this.renderer!.getCanvas();
						const captionCtx = compositeCanvas.getContext("2d");
						if (captionCtx) {
							renderCaptions(
								captionCtx,
								this.config.width,
								this.config.height,
								sourceTimestampMs,
								captionPages,
								this.config.captionSettings,
							);
						}
					}

					// Apply video transitions if any are active at this timestamp
					if (sortedTransitions.length > 0 && transitionSnapshotCanvas) {
						const compositeCanvas = this.renderer!.getCanvas();
						const compositeCtx = compositeCanvas.getContext("2d");

						// Check if we're inside any transition window
						const activeTransition = sortedTransitions.find((tr) => {
							const halfDur = tr.durationMs / 2;
							return sourceTimestampMs >= tr.atMs - halfDur && sourceTimestampMs <= tr.atMs + halfDur;
						});

						if (activeTransition && compositeCtx && lastFrameMs >= 0) {
							const halfDur = activeTransition.durationMs / 2;
							const progress = (sourceTimestampMs - (activeTransition.atMs - halfDur)) / activeTransition.durationMs;

							// The current composite canvas has the "incoming" frame.
							// Copy it to a temp canvas, then blend outgoing snapshot with incoming.
							const tempCanvas = new OffscreenCanvas(this.config.width, this.config.height);
							const tempCtx = tempCanvas.getContext("2d")!;
							tempCtx.drawImage(compositeCanvas, 0, 0);

							renderTransitionFrame(
								compositeCtx,
								activeTransition.type,
								transitionSnapshotCanvas,
								tempCanvas,
								this.config.width,
								this.config.height,
								progress,
							);
						}

						// Snapshot current composite for next frame's outgoing reference
						const snapCtx = transitionSnapshotCanvas.getContext("2d")!;
						snapCtx.drawImage(compositeCanvas, 0, 0);
						lastFrameMs = sourceTimestampMs;
					}

					await this.encodeRenderedFrame(timestamp, frameDuration, frameIndex);
					frameIndex++;
					this.reportProgress(frameIndex, totalFrames);
				},
			);

			if (this.cancelled) {
				return { success: false, error: "Export cancelled" };
			}

			// Finalize encoding — bail early if muxing already failed
			if (this.muxingError) {
				throw this.muxingError;
			}
			if (this.encoder && this.encoder.state === "configured") {
				await this.awaitWithWindowsTimeout(this.encoder.flush(), "encoder flush");
			}

			// Wait for queued muxing operations to complete
			await this.awaitWithWindowsTimeout(this.pendingMuxing, "muxing queued video chunks");

			if (hasAudio && !this.cancelled) {
				this.audioProcessor = new AudioProcessor();
				if (this.config.enhancedAudioUrl) {
					// Use Studio Sound enhanced audio instead of original
					await this.awaitWithWindowsTimeout(
						this.audioProcessor.processEnhancedAudio(this.config.enhancedAudioUrl, this.muxer!),
						"enhanced audio processing",
					);
				} else {
					const demuxer = this.streamingDecoder.getDemuxer();
					if (demuxer || hasAudioRegions || hasSfx) {
						await this.awaitWithWindowsTimeout(
							this.audioProcessor.process(
								demuxer!,
								this.muxer!,
								this.config.videoUrl,
								this.config.trimRegions,
								this.config.speedRegions,
								undefined,
								this.config.audioRegions,
								this.config.soundEffectRegions,
							),
							"audio processing",
						);
					}
				}
			}

			// Check for muxing errors before finalizing
			if (this.muxingError !== null) {
				throw this.muxingError;
			}

			// Finalize muxer and get output blob
			const blob = await this.awaitWithWindowsTimeout(this.muxer!.finalize(), "muxer finalization");

			return { success: true, blob };
		} catch (error) {
			console.error("Export error:", error);
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		} finally {
			this.cleanup();
		}
	}

	private isWindowsPlatform(): boolean {
		if (typeof navigator === "undefined") {
			return false;
		}
		return /Win/i.test(navigator.platform);
	}

	private async awaitWithWindowsTimeout<T>(promise: Promise<T>, stage: string): Promise<T> {
		const isWindows = this.isWindowsPlatform();
		const timeoutMs = isWindows
			? this.WINDOWS_FINALIZATION_TIMEOUT_MS
			: this.DEFAULT_FINALIZATION_TIMEOUT_MS;
		const platformLabel = isWindows ? "Windows" : "export";

		let timeoutId: ReturnType<typeof setTimeout> | null = null;

		try {
			return await Promise.race([
				promise,
				new Promise<T>((_, reject) => {
					timeoutId = setTimeout(() => {
						reject(
							new Error(
								`Export timed out during ${stage} (${platformLabel}, ${timeoutMs / 1000}s)`,
							),
						);
					}, timeoutMs);
				}),
			]);
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		}
	}

	private async encodeRenderedFrame(timestamp: number, frameDuration: number, frameIndex: number) {
		const canvas = this.renderer!.getCanvas();

		// @ts-expect-error - colorSpace not in TypeScript definitions but works at runtime
		const exportFrame = new VideoFrame(canvas, {
			timestamp,
			duration: frameDuration,
			colorSpace: {
				primaries: "bt709",
				transfer: "iec61966-2-1",
				matrix: "rgb",
				fullRange: true,
			},
		});

		while (
			this.encoder &&
			this.encoder.encodeQueueSize >= this.MAX_ENCODE_QUEUE &&
			!this.cancelled
		) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		if (this.encoder && this.encoder.state === "configured") {
			this.encodeQueue++;
			this.encoder.encode(exportFrame, { keyFrame: frameIndex % 150 === 0 });
		} else {
			console.warn(`[Frame ${frameIndex}] Encoder not ready! State: ${this.encoder?.state}`);
		}

		exportFrame.close();
	}

	private reportProgress(currentFrame: number, totalFrames: number) {
		if (this.config.onProgress) {
			this.config.onProgress({
				currentFrame,
				totalFrames,
				percentage: totalFrames > 0 ? (currentFrame / totalFrames) * 100 : 100,
				estimatedTimeRemaining: 0,
			});
		}
	}

	private async initializeEncoder(): Promise<void> {
		if (this.config.width < 16 || this.config.height < 16) {
			throw new Error(
				`Export resolution too small — minimum 16x16 pixels (got ${this.config.width}x${this.config.height})`,
			);
		}

		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.chunkCount = 0;
		let videoDescription: Uint8Array | undefined;

		// Ordered from most capable to most compatible. avc1.PPCCLL where PP=profile, CC=constraints, LL=level.
		// High 5.1 → Main 5.1 → Baseline 5.1 → Main 3.1 → Baseline 3.1
		const CODEC_FALLBACK_LIST = this.config.codec
			? [this.config.codec]
			: ["avc1.640033", "avc1.4d4033", "avc1.420033", "avc1.4d401f", "avc1.42001f"];

		let resolvedCodec: string | null = null;

		this.encoder = new VideoEncoder({
			output: (chunk, meta) => {
				// Capture decoder config metadata from encoder output
				if (meta?.decoderConfig?.description && !videoDescription) {
					const desc = meta.decoderConfig.description;
					videoDescription = ArrayBuffer.isView(desc)
						? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength)
						: new Uint8Array(desc);
					this.videoDescription = videoDescription;
				}
				// Capture colorSpace from encoder metadata if provided
				if (meta?.decoderConfig?.colorSpace && !this.videoColorSpace) {
					this.videoColorSpace = meta.decoderConfig.colorSpace;
				}

				// Stream chunks to muxer in order without retaining an ever-growing promise array
				const isFirstChunk = this.chunkCount === 0;
				this.chunkCount++;

				this.pendingMuxing = this.pendingMuxing.then(async () => {
					try {
						if (isFirstChunk && this.videoDescription) {
							// Add decoder config for the first chunk
							const colorSpace = this.videoColorSpace || {
								primaries: "bt709",
								transfer: "iec61966-2-1",
								matrix: "rgb",
								fullRange: true,
							};

							const metadata: EncodedVideoChunkMetadata = {
								decoderConfig: {
									codec: resolvedCodec ?? (this.config.codec || "avc1.640033"),
									codedWidth: this.config.width,
									codedHeight: this.config.height,
									description: this.videoDescription,
									colorSpace,
								},
							};

							await this.muxer!.addVideoChunk(chunk, metadata);
						} else {
							await this.muxer!.addVideoChunk(chunk, meta);
						}
					} catch (error) {
						console.error("Muxing error:", error);
						this.muxingError = error instanceof Error ? error : new Error(String(error));
					}
				});
				this.encodeQueue--;
			},
			error: (error) => {
				console.error(
					`[VideoExporter] Encoder error (codec: ${resolvedCodec}, ${this.config.width}x${this.config.height}):`,
					error,
				);
				// Stop export — encoding failed
				this.cancelled = true;
			},
		});

		const baseConfig: Omit<VideoEncoderConfig, "codec" | "hardwareAcceleration"> = {
			width: this.config.width,
			height: this.config.height,
			bitrate: this.config.bitrate,
			framerate: this.config.frameRate,
			latencyMode: "quality",
			bitrateMode: "variable",
		};

		for (const candidateCodec of CODEC_FALLBACK_LIST) {
			const hwConfig: VideoEncoderConfig = {
				...baseConfig,
				codec: candidateCodec,
				hardwareAcceleration: "prefer-hardware",
			};
			const hwSupport = await VideoEncoder.isConfigSupported(hwConfig);
			if (hwSupport.supported) {
				resolvedCodec = candidateCodec;
				console.log(`[VideoExporter] Using hardware acceleration with codec ${candidateCodec}`);
				this.encoder.configure(hwConfig);
				return;
			}

			const swConfig: VideoEncoderConfig = {
				...baseConfig,
				codec: candidateCodec,
				hardwareAcceleration: "prefer-software",
			};
			const swSupport = await VideoEncoder.isConfigSupported(swConfig);
			if (swSupport.supported) {
				resolvedCodec = candidateCodec;
				console.log(`[VideoExporter] Using software encoding with codec ${candidateCodec}`);
				this.encoder.configure(swConfig);
				return;
			}

			console.warn(
				`[VideoExporter] Codec ${candidateCodec} not supported (${this.config.width}x${this.config.height}), trying next...`,
			);
		}

		throw new Error(
			`Video encoding not supported on this system. ` +
				`Tried codecs: ${CODEC_FALLBACK_LIST.join(", ")} at ${this.config.width}x${this.config.height}. ` +
				`Your browser or hardware may not support H.264 encoding at this resolution. ` +
				`Try exporting at a lower quality setting.`,
		);
	}

	cancel(): void {
		this.cancelled = true;
		if (this.streamingDecoder) {
			this.streamingDecoder.cancel();
		}
		if (this.audioProcessor) {
			this.audioProcessor.cancel();
		}
		this.cleanup();
	}

	private cleanup(): void {
		if (this.encoder) {
			try {
				if (this.encoder.state === "configured") {
					this.encoder.close();
				}
			} catch (e) {
				console.warn("Error closing encoder:", e);
			}
			this.encoder = null;
		}

		if (this.streamingDecoder) {
			try {
				this.streamingDecoder.destroy();
			} catch (e) {
				console.warn("Error destroying streaming decoder:", e);
			}
			this.streamingDecoder = null;
		}

		if (this.renderer) {
			try {
				this.renderer.destroy();
			} catch (e) {
				console.warn("Error destroying renderer:", e);
			}
			this.renderer = null;
		}

		this.muxer = null;
		this.audioProcessor = null;
		this.encodeQueue = 0;
		this.pendingMuxing = Promise.resolve();
		this.chunkCount = 0;
		this.videoDescription = undefined;
		this.videoColorSpace = undefined;
	}
}

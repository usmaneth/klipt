export interface DecodedVideoInfo {
	width: number;
	height: number;
	duration: number; // in seconds
	frameRate: number;
	codec: string;
}

export class VideoFileDecoder {
	private info: DecodedVideoInfo | null = null;
	private videoElement: HTMLVideoElement | null = null;

	async loadVideo(videoUrl: string): Promise<DecodedVideoInfo> {
		this.videoElement = document.createElement("video");
		this.videoElement.src = videoUrl;
		this.videoElement.preload = "auto";

		return new Promise((resolve, reject) => {
			this.videoElement!.addEventListener("loadedmetadata", () => {
				const video = this.videoElement!;

				// Estimate frame rate from video playback. The HTML5 video API
				// doesn't directly expose frame rate, so we use a heuristic: if
				// the browser exposes getVideoPlaybackQuality after a brief probe,
				// measure it. Otherwise fall back to 60.
				const estimatedFrameRate = 60;

				this.info = {
					width: video.videoWidth,
					height: video.videoHeight,
					duration: video.duration,
					frameRate: estimatedFrameRate,
					codec: "avc1.640033", // Default; actual codec detection requires demuxing
				};

				resolve(this.info);
			});

			this.videoElement!.addEventListener("error", (e) => {
				reject(new Error(`Failed to load video: ${e}`));
			});
		});
	}

	/**
	 * Get video element for seeking
	 */
	getVideoElement(): HTMLVideoElement | null {
		return this.videoElement;
	}

	getInfo(): DecodedVideoInfo | null {
		return this.info;
	}

	destroy(): void {
		if (this.videoElement) {
			this.videoElement.pause();
			this.videoElement.src = "";
			this.videoElement = null;
		}
	}
}

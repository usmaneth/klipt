export interface ThumbnailCandidate {
	frameTime: number;
	score: number;
	imageDataUrl: string;
}

/**
 * Computes the standard deviation of luminance values in the image data.
 * Higher values indicate more contrast.
 */
function computeContrast(data: Uint8ClampedArray): number {
	let sum = 0;
	let sumSq = 0;
	const pixelCount = data.length / 4;

	for (let i = 0; i < data.length; i += 4) {
		const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
		sum += luminance;
		sumSq += luminance * luminance;
	}

	const mean = sum / pixelCount;
	const variance = sumSq / pixelCount - mean * mean;
	return Math.sqrt(Math.max(0, variance));
}

/**
 * Computes average saturation in HSL space.
 */
function computeSaturation(data: Uint8ClampedArray): number {
	let totalSaturation = 0;
	const pixelCount = data.length / 4;

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] / 255;
		const g = data[i + 1] / 255;
		const b = data[i + 2] / 255;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 2;

		if (max === min) {
			// achromatic
			continue;
		}

		const d = max - min;
		const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		totalSaturation += s;
	}

	return totalSaturation / pixelCount;
}

/**
 * Computes sharpness via Laplacian variance.
 * Sum of absolute differences with neighbors.
 */
function computeSharpness(data: Uint8ClampedArray, width: number, height: number): number {
	let laplacianSum = 0;
	let count = 0;

	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const idx = (y * width + x) * 4;
			const top = ((y - 1) * width + x) * 4;
			const bottom = ((y + 1) * width + x) * 4;
			const left = (y * width + (x - 1)) * 4;
			const right = (y * width + (x + 1)) * 4;

			// Use luminance channel
			const center = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
			const tVal = 0.299 * data[top] + 0.587 * data[top + 1] + 0.114 * data[top + 2];
			const bVal = 0.299 * data[bottom] + 0.587 * data[bottom + 1] + 0.114 * data[bottom + 2];
			const lVal = 0.299 * data[left] + 0.587 * data[left + 1] + 0.114 * data[left + 2];
			const rVal = 0.299 * data[right] + 0.587 * data[right + 1] + 0.114 * data[right + 2];

			// Laplacian: 4*center - top - bottom - left - right
			const laplacian = Math.abs(4 * center - tVal - bVal - lVal - rVal);
			laplacianSum += laplacian;
			count++;
		}
	}

	return count > 0 ? laplacianSum / count : 0;
}

/**
 * Score a single frame based on contrast, saturation, and sharpness.
 */
function scoreFrame(data: Uint8ClampedArray, width: number, height: number): number {
	const contrast = computeContrast(data);
	const saturation = computeSaturation(data);
	const sharpness = computeSharpness(data, width, height);

	// Normalize each metric to roughly 0-1 range
	const normalizedContrast = Math.min(contrast / 80, 1);
	const normalizedSaturation = Math.min(saturation / 0.5, 1);
	const normalizedSharpness = Math.min(sharpness / 30, 1);

	return 0.4 * normalizedContrast + 0.3 * normalizedSharpness + 0.3 * normalizedSaturation;
}

/**
 * Generates thumbnail candidates from a video URL by extracting frames
 * and scoring them based on visual quality metrics.
 */
export async function generateThumbnails(
	videoUrl: string,
	count = 6,
	onProgress?: (p: number) => void,
): Promise<ThumbnailCandidate[]> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.crossOrigin = "anonymous";
		video.preload = "auto";
		video.muted = true;

		// Use a smaller canvas for analysis to keep it fast
		const analysisWidth = 320;

		video.addEventListener("error", () => {
			reject(new Error("Failed to load video for thumbnail generation"));
		});

		video.addEventListener("loadedmetadata", async () => {
			const duration = video.duration;
			if (!Number.isFinite(duration) || duration <= 0) {
				reject(new Error("Video has invalid duration"));
				return;
			}

			const intervalSec = 1;
			const totalFrames = Math.floor(duration / intervalSec);

			if (totalFrames === 0) {
				reject(new Error("Video is too short for thumbnail generation"));
				return;
			}

			const analysisHeight = Math.round(analysisWidth * (video.videoHeight / video.videoWidth));
			const analysisCanvas = document.createElement("canvas");
			analysisCanvas.width = analysisWidth;
			analysisCanvas.height = analysisHeight;
			const analysisCtx = analysisCanvas.getContext("2d", {
				willReadFrequently: true,
			});

			// Full-size canvas for the data URL output
			const outputCanvas = document.createElement("canvas");
			outputCanvas.width = video.videoWidth;
			outputCanvas.height = video.videoHeight;
			const outputCtx = outputCanvas.getContext("2d");

			if (!analysisCtx || !outputCtx) {
				reject(new Error("Failed to create canvas contexts"));
				return;
			}

			const candidates: ThumbnailCandidate[] = [];

			try {
				for (let i = 0; i < totalFrames; i++) {
					const time = i * intervalSec + 0.5; // offset by 0.5s to avoid black frames
					if (time >= duration) break;

					video.currentTime = time;

					await new Promise<void>((seekResolve) => {
						const onSeeked = () => {
							video.removeEventListener("seeked", onSeeked);
							seekResolve();
						};
						video.addEventListener("seeked", onSeeked);
					});

					// Draw to analysis canvas for scoring
					analysisCtx.drawImage(video, 0, 0, analysisWidth, analysisHeight);
					const imageData = analysisCtx.getImageData(0, 0, analysisWidth, analysisHeight);
					const score = scoreFrame(imageData.data, analysisWidth, analysisHeight);

					// Draw to output canvas for the data URL
					outputCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
					const imageDataUrl = outputCanvas.toDataURL("image/jpeg", 0.85);

					candidates.push({
						frameTime: time,
						score,
						imageDataUrl,
					});

					onProgress?.(((i + 1) / totalFrames) * 100);
				}

				// Sort by score descending and return top N
				candidates.sort((a, b) => b.score - a.score);
				resolve(candidates.slice(0, count));
			} catch (err) {
				reject(err);
			}
		});

		video.src = videoUrl;
	});
}

/**
 * GIF frame extractor for rendering animated GIF annotations during export.
 *
 * Uses the Chromium ImageDecoder API to decode individual GIF frames,
 * selecting the correct frame based on the current playback timestamp.
 */

/** Cached decoded GIF keyed by the first 64 chars of the data URL. */
const gifCache = new Map<string, Promise<DecodedGif>>();

interface DecodedGif {
	frames: ImageBitmap[];
	/** Cumulative end-time (ms) for each frame. */
	frameTimes: number[];
	totalDurationMs: number;
}

function cacheKey(dataUrl: string): string {
	return dataUrl.slice(0, 128);
}

/**
 * Returns true if a data-URL looks like an animated GIF.
 */
export function isGifDataUrl(dataUrl: string): boolean {
	return dataUrl.startsWith("data:image/gif");
}

/**
 * Decode all frames of a GIF data-URL into ImageBitmaps.
 * Results are cached so repeated calls for the same GIF are free.
 */
export function decodeGif(dataUrl: string): Promise<DecodedGif> {
	const key = cacheKey(dataUrl);
	const cached = gifCache.get(key);
	if (cached) return cached;

	const promise = decodeGifInternal(dataUrl);
	gifCache.set(key, promise);
	return promise;
}

async function decodeGifInternal(dataUrl: string): Promise<DecodedGif> {
	// Convert data URL to blob for ImageDecoder
	const resp = await fetch(dataUrl);
	const blob = await resp.blob();

	// Check if ImageDecoder API is available (Chromium 94+)
	if (typeof ImageDecoder === "undefined") {
		// Fallback: single static frame
		return decodeGifFallback(dataUrl);
	}

	try {
		const decoder = new ImageDecoder({
			data: blob.stream(),
			type: "image/gif",
		});

		await decoder.completed;

		const track = decoder.tracks.selectedTrack;
		if (!track || track.frameCount === 0) {
			decoder.close();
			return decodeGifFallback(dataUrl);
		}

		const frameCount = track.frameCount;
		const frames: ImageBitmap[] = [];
		const frameTimes: number[] = [];
		let cumulative = 0;

		for (let i = 0; i < frameCount; i++) {
			const result = await decoder.decode({ frameIndex: i });
			const vf = result.image;

			// VideoFrame.duration is in microseconds
			const delayMs = (vf.duration ?? 100_000) / 1000;
			cumulative += delayMs;

			// Convert VideoFrame to ImageBitmap for canvas drawing
			const bitmap = await createImageBitmap(vf);
			vf.close();

			frames.push(bitmap);
			frameTimes.push(cumulative);
		}

		decoder.close();

		return {
			frames,
			frameTimes,
			totalDurationMs: cumulative,
		};
	} catch {
		return decodeGifFallback(dataUrl);
	}
}

/** Fallback: load as a single static image. */
async function decodeGifFallback(dataUrl: string): Promise<DecodedGif> {
	const bitmap = await new Promise<ImageBitmap>((resolve, reject) => {
		const img = new Image();
		img.onload = () => createImageBitmap(img).then(resolve).catch(reject);
		img.onerror = reject;
		img.src = dataUrl;
	});
	return {
		frames: [bitmap],
		frameTimes: [100],
		totalDurationMs: 100,
	};
}

/**
 * Get the correct GIF frame for a given elapsed time (ms) since the
 * annotation started. Loops automatically.
 */
export function getGifFrameAtTime(gif: DecodedGif, elapsedMs: number): ImageBitmap {
	if (gif.frames.length === 1) return gif.frames[0];

	const looped = elapsedMs % gif.totalDurationMs;
	for (let i = 0; i < gif.frameTimes.length; i++) {
		if (looped < gif.frameTimes[i]) return gif.frames[i];
	}
	return gif.frames[gif.frames.length - 1];
}

/**
 * Clear the decoded-GIF cache (e.g. when a project is closed).
 */
export function clearGifCache(): void {
	gifCache.clear();
}

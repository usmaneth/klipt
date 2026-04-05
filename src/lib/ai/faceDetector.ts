/**
 * Face detection using Chromium's built-in FaceDetector API.
 * Available in Electron without any external libraries.
 */

export interface DetectedFace {
	timeMs: number;
	x: number; // normalized 0-1
	y: number; // normalized 0-1
	width: number; // normalized 0-1
	height: number; // normalized 0-1
}

/**
 * Check whether the FaceDetector API is available in this environment.
 */
export function isFaceDetectorAvailable(): boolean {
	// biome-ignore lint/correctness/noUndeclaredVariables: FaceDetector is a Chromium built-in API declared in vite-env.d.ts
	return typeof FaceDetector !== "undefined";
}

/**
 * Load an image from a file path (or data URL) into an HTMLImageElement.
 */
function loadImage(src: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = (_e) => reject(new Error(`Failed to load image: ${src}`));
		img.src = src;
	});
}

/**
 * Detect faces in a single image and return normalized bounding boxes.
 */
async function detectFacesInImage(imageSrc: string, timeMs: number): Promise<DetectedFace[]> {
	if (!isFaceDetectorAvailable()) {
		console.warn("[faceDetector] FaceDetector API is not available");
		return [];
	}

	const img = await loadImage(imageSrc);
	// biome-ignore lint/correctness/noUndeclaredVariables: FaceDetector is a Chromium built-in API declared in vite-env.d.ts
	const detector = new FaceDetector({ maxDetectedFaces: 10 });
	const results = await detector.detect(img);

	return results.map((face) => ({
		timeMs,
		x: face.boundingBox.x / img.naturalWidth,
		y: face.boundingBox.y / img.naturalHeight,
		width: face.boundingBox.width / img.naturalWidth,
		height: face.boundingBox.height / img.naturalHeight,
	}));
}

/**
 * Detect faces across multiple extracted video frames.
 * Each frame has a timestamp and a file path (or data URL).
 */
export async function detectFacesInFrames(
	framePaths: Array<{ timeMs: number; path: string }>,
	onProgress?: (percent: number) => void,
): Promise<DetectedFace[]> {
	const allFaces: DetectedFace[] = [];
	const total = framePaths.length;

	for (let i = 0; i < total; i++) {
		const frame = framePaths[i];
		try {
			const faces = await detectFacesInImage(frame.path, frame.timeMs);
			allFaces.push(...faces);
		} catch (err) {
			console.warn(`[faceDetector] Failed to process frame at ${frame.timeMs}ms:`, err);
		}
		onProgress?.(Math.round(((i + 1) / total) * 100));
	}

	return allFaces;
}

/**
 * Merge overlapping/nearby face detections across time into consolidated regions.
 * Groups faces that have similar positions (within the given tolerance).
 */
export function mergeFaceDetections(
	faces: DetectedFace[],
	positionTolerance = 0.15,
): Array<{
	startMs: number;
	endMs: number;
	x: number;
	y: number;
	width: number;
	height: number;
}> {
	if (faces.length === 0) return [];

	// Sort by time
	const sorted = [...faces].sort((a, b) => a.timeMs - b.timeMs);

	type Cluster = {
		faces: DetectedFace[];
		avgX: number;
		avgY: number;
		avgW: number;
		avgH: number;
	};

	const clusters: Cluster[] = [];

	for (const face of sorted) {
		// Find a matching cluster
		let matched = false;
		for (const cluster of clusters) {
			const dx = Math.abs(face.x - cluster.avgX);
			const dy = Math.abs(face.y - cluster.avgY);
			if (dx < positionTolerance && dy < positionTolerance) {
				cluster.faces.push(face);
				const n = cluster.faces.length;
				cluster.avgX = (cluster.avgX * (n - 1) + face.x) / n;
				cluster.avgY = (cluster.avgY * (n - 1) + face.y) / n;
				cluster.avgW = (cluster.avgW * (n - 1) + face.width) / n;
				cluster.avgH = (cluster.avgH * (n - 1) + face.height) / n;
				matched = true;
				break;
			}
		}

		if (!matched) {
			clusters.push({
				faces: [face],
				avgX: face.x,
				avgY: face.y,
				avgW: face.width,
				avgH: face.height,
			});
		}
	}

	return clusters.map((cluster) => {
		const times = cluster.faces.map((f) => f.timeMs);
		return {
			startMs: Math.min(...times),
			endMs: Math.max(...times),
			x: cluster.avgX,
			y: cluster.avgY,
			width: cluster.avgW,
			height: cluster.avgH,
		};
	});
}

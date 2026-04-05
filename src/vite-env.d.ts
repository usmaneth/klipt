/// <reference types="vite/client" />
/// <reference types="../electron/electron-env" />

/**
 * Chromium's built-in FaceDetector API (Shape Detection API).
 * Available in Electron/Chromium without any external libraries.
 */
interface DetectedFaceResult {
	boundingBox: DOMRectReadOnly;
	landmarks?: Array<{
		locations: Array<{ x: number; y: number }>;
		type: "eye" | "mouth" | "nose";
	}>;
}

interface FaceDetectorOptions {
	maxDetectedFaces?: number;
	fastMode?: boolean;
}

declare class FaceDetector {
	constructor(options?: FaceDetectorOptions);
	detect(image: ImageBitmapSource): Promise<DetectedFaceResult[]>;
}

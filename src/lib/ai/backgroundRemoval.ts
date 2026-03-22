import { removeBackground as imglyRemoveBackground } from "@imgly/background-removal";

export type BgMode = "none" | "remove" | "blur" | "color";

interface BgRemovalOptions {
	blurAmount?: number;
	bgColor?: string;
}

let cachedConfig: { model: "isnet_fp16" } | null = null;

function getConfig(): { model: "isnet_fp16" } {
	if (!cachedConfig) {
		cachedConfig = { model: "isnet_fp16" };
	}
	return cachedConfig;
}

/**
 * Applies background removal/replacement to an ImageData.
 * Uses @imgly/background-removal to segment the foreground.
 */
export async function removeBackground(
	imageData: ImageData,
	mode: BgMode,
	options?: BgRemovalOptions,
): Promise<ImageData> {
	if (mode === "none") {
		return imageData;
	}

	const config = getConfig();

	// Convert ImageData to a Blob for the library
	const canvas = new OffscreenCanvas(imageData.width, imageData.height);
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Failed to get 2D context for background removal");
	}
	ctx.putImageData(imageData, 0, 0);
	const blob = await canvas.convertToBlob({ type: "image/png" });

	// Run background removal — returns a Blob with transparent background
	const resultBlob = await imglyRemoveBackground(blob, config);

	// Convert result blob to ImageData
	const resultBitmap = await createImageBitmap(resultBlob);
	const resultCanvas = new OffscreenCanvas(imageData.width, imageData.height);
	const resultCtx = resultCanvas.getContext("2d");
	if (!resultCtx) {
		throw new Error("Failed to get 2D context for result canvas");
	}

	if (mode === "remove") {
		// Transparent background — just draw the foreground
		resultCtx.drawImage(resultBitmap, 0, 0, imageData.width, imageData.height);
	} else if (mode === "blur") {
		// Draw original image with blur as background
		const blurAmount = options?.blurAmount ?? 10;
		resultCtx.filter = `blur(${blurAmount}px)`;
		resultCtx.putImageData(imageData, 0, 0);
		resultCtx.filter = "none";
		// Draw foreground on top
		resultCtx.drawImage(resultBitmap, 0, 0, imageData.width, imageData.height);
	} else if (mode === "color") {
		// Draw solid color background
		const bgColor = options?.bgColor ?? "#00FF00";
		resultCtx.fillStyle = bgColor;
		resultCtx.fillRect(0, 0, imageData.width, imageData.height);
		// Draw foreground on top
		resultCtx.drawImage(resultBitmap, 0, 0, imageData.width, imageData.height);
	}

	resultBitmap.close();

	return resultCtx.getImageData(0, 0, imageData.width, imageData.height);
}

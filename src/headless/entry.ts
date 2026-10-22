import { VideoExporter } from "@/lib/exporter/videoExporter";
import { describeExportError } from "./errors";
import type { HeadlessJob } from "./job";
import { BRAND, resolvePreset } from "./preset";
import { captionsToCues, zoomsToRegions } from "./schedule";
import { drawTitleCard } from "./titleCard";

interface RendererJob extends HeadlessJob {
	inputUrl: string;
}

interface KliptHeadlessApi {
	getJob: () => Promise<RendererJob>;
	progress: (current: number, total: number) => void;
	log: (message: string) => void;
	finish: (result: { ok: true; bytes: Uint8Array } | { ok: false; error: string }) => Promise<void>;
}

declare global {
	interface Window {
		kliptHeadless: KliptHeadlessApi;
	}
}

/**
 * The canvas draws with the font that is loaded when it paints. A font that is installed on the host
 * is not in document.fonts, so load() cannot tell whether it exists. The proof frames show it.
 */
async function loadBrandFont(): Promise<void> {
	const family = BRAND.font.split(",")[0];
	for (const weight of [400, 700]) {
		await document.fonts.load(`${weight} 48px ${family}`);
	}
}

async function run(): Promise<void> {
	const api = window.kliptHeadless;
	try {
		const startedAt = performance.now();
		const job = await api.getJob();
		const preset = resolvePreset(job.preset);
		const cues = captionsToCues(job.captions, { lowercase: preset.lowercaseCopy });
		const zoomRegions = zoomsToRegions(job.zooms);
		const title = job.title && preset.lowercaseCopy ? job.title.toLowerCase() : job.title;
		await loadBrandFont();
		api.log(
			`start: ${preset.width}x${preset.height}@${preset.frameRate}, ${cues.length} captions, ` +
				`${zoomRegions.length} zooms, title card ${title ? "on" : "off"}`,
		);

		const exporter = new VideoExporter({
			videoUrl: job.inputUrl,
			width: preset.width,
			height: preset.height,
			frameRate: preset.frameRate,
			bitrate: preset.bitrate,
			wallpaper: preset.wallpaper,
			zoomRegions,
			showShadow: preset.shadowIntensity > 0,
			shadowIntensity: preset.shadowIntensity,
			backgroundBlur: 0,
			zoomMotionBlur: 0,
			borderRadius: preset.borderRadius,
			padding: preset.padding,
			cropRegion: { x: 0, y: 0, width: 1, height: 1 },
			previewWidth: preset.width,
			previewHeight: preset.height,
			showCursor: false,
			captionCues: cues.length > 0 ? cues : undefined,
			captionSettings: cues.length > 0 ? preset.captionSettings : undefined,
			introCard: title
				? {
						durationMs: preset.titleCardMs,
						draw: (ctx, width, height) => drawTitleCard(ctx, width, height, title),
					}
				: undefined,
			onProgress: (progress) => {
				api.progress(progress.currentFrame, progress.totalFrames);
				if (progress.currentFrame % 15 === 0) {
					const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
					api.log(`frame ${progress.currentFrame} of ${progress.totalFrames} at ${seconds}s`);
				}
			},
		});

		const result = await exporter.export();
		if (!result.success || !result.blob) {
			throw new Error(result.error ?? "the export returned no video");
		}
		const bytes = new Uint8Array(await result.blob.arrayBuffer());
		await api.finish({ ok: true, bytes });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await api.finish({ ok: false, error: describeExportError(message) });
	}
}

void run();

import type {
	AnnotationRegion,
	AudioRegion,
	CropRegion,
	SoundEffectRegion,
	SpeedRegion,
	TransitionRegion,
	TrimRegion,
	ZoomRegion,
} from "@/components/video-editor/types";
import { DEFAULT_CROP_REGION } from "@/components/video-editor/types";
import type { CaptionCue } from "@/components/video-editor/captionLayout";

/**
 * Describes the full project state needed to determine if fast export is possible.
 */
export interface FastExportProjectState {
	trimRegions: TrimRegion[];
	zoomRegions: ZoomRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	soundEffectRegions: SoundEffectRegion[];
	transitionRegions: TransitionRegion[];
	speedRegions: SpeedRegion[];
	cropRegion: CropRegion;
	enhancedAudioUrl: string | null;
	webcamPath: string | null;
	captionCues: CaptionCue[];
	/** Aspect ratio string — "native" means no letterboxing/pillarboxing */
	aspectRatio: string;
	/** Default is 12.5; any non-zero value means visual change */
	borderRadius: number;
	/** Default is 50; 0 means edge-to-edge */
	padding: number;
	/** Shadow intensity; 0 means no shadow */
	shadowIntensity: number;
	/** Background blur level; 0 means no blur */
	backgroundBlur: number;
}

/**
 * Returns `true` when the project contains only trim edits and no visual
 * modifications, meaning we can remux (copy codec) instead of re-encoding.
 */
export function canFastExport(project: FastExportProjectState): boolean {
	// Must have no overlays / annotations
	if (project.annotationRegions.length > 0) return false;

	// Must have no zoom regions (or all identity — depth 1 is the lowest zoom)
	if (project.zoomRegions.length > 0) {
		const hasNonIdentityZoom = project.zoomRegions.some((z) => z.depth !== 1);
		if (hasNonIdentityZoom) return false;
	}

	// Must have no custom audio regions
	if (project.audioRegions.length > 0) return false;

	// Must have no sound effect regions
	if (project.soundEffectRegions.length > 0) return false;

	// Must have no transition regions
	if (project.transitionRegions.length > 0) return false;

	// Must have no speed change regions
	if (project.speedRegions.length > 0) return false;

	// Must not have enhanced/replaced audio
	if (project.enhancedAudioUrl) return false;

	// Must not have a webcam overlay
	if (project.webcamPath) return false;

	// Must not have captions baked in
	if (project.captionCues.length > 0) return false;

	// Must use native aspect ratio (no letterboxing)
	if (project.aspectRatio !== "native") return false;

	// Crop must be identity (full frame)
	const c = project.cropRegion;
	if (
		Math.abs(c.x - DEFAULT_CROP_REGION.x) > 0.001 ||
		Math.abs(c.y - DEFAULT_CROP_REGION.y) > 0.001 ||
		Math.abs(c.width - DEFAULT_CROP_REGION.width) > 0.001 ||
		Math.abs(c.height - DEFAULT_CROP_REGION.height) > 0.001
	) {
		return false;
	}

	// Must have zero padding (edge-to-edge)
	if (project.padding !== 0) return false;

	// Must have zero border radius
	if (project.borderRadius !== 0) return false;

	// Must have no shadow
	if (project.shadowIntensity !== 0) return false;

	// Must have no background blur
	if (project.backgroundBlur !== 0) return false;

	return true;
}

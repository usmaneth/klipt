/**
 * Background Upload Manager
 *
 * Manages chunked background uploads to S3-compatible storage.
 * Progress is reported via callbacks and can work while recording is in progress.
 */

export interface S3Config {
	endpoint: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
	region?: string;
	pathStyle?: boolean;
}

export interface UploadProgressCallback {
	(progress: { percent: number; bytesUploaded: number; totalBytes: number }): void;
}

export interface UploadManager {
	startBackgroundUpload(filePath: string, config: S3Config): Promise<string>;
	getProgress(): number;
	cancel(): void;
	isUploading(): boolean;
	getShareUrl(): string | null;
}

interface UploadState {
	uploading: boolean;
	progress: number;
	shareUrl: string | null;
	cancelled: boolean;
	cleanupListener: (() => void) | null;
}

/**
 * Creates an UploadManager that delegates actual file I/O to Electron's main process
 * via IPC. The renderer only tracks state and progress.
 */
export function createUploadManager(): UploadManager {
	const state: UploadState = {
		uploading: false,
		progress: 0,
		shareUrl: null,
		cancelled: false,
		cleanupListener: null,
	};

	return {
		async startBackgroundUpload(filePath: string, config: S3Config): Promise<string> {
			if (state.uploading) {
				throw new Error("An upload is already in progress");
			}

			state.uploading = true;
			state.progress = 0;
			state.shareUrl = null;
			state.cancelled = false;

			// Listen for progress events from the main process
			if (window.electronAPI?.onBackgroundUploadProgress) {
				state.cleanupListener = window.electronAPI.onBackgroundUploadProgress(
					(progressData) => {
						state.progress = progressData.percent;
					},
				);
			}

			try {
				const result = await window.electronAPI.startBackgroundUpload(filePath, config);
				if (state.cancelled) {
					throw new Error("Upload was cancelled");
				}
				if (!result.success) {
					throw new Error(result.error || "Upload failed");
				}
				state.shareUrl = result.url ?? null;
				state.progress = 100;
				return result.url ?? "";
			} catch (err) {
				if (state.cancelled) {
					throw new Error("Upload was cancelled");
				}
				throw err;
			} finally {
				state.uploading = false;
				if (state.cleanupListener) {
					state.cleanupListener();
					state.cleanupListener = null;
				}
			}
		},

		getProgress(): number {
			return state.progress;
		},

		cancel(): void {
			state.cancelled = true;
			state.uploading = false;
			if (state.cleanupListener) {
				state.cleanupListener();
				state.cleanupListener = null;
			}
			window.electronAPI?.cancelBackgroundUpload?.();
		},

		isUploading(): boolean {
			return state.uploading;
		},

		getShareUrl(): string | null {
			return state.shareUrl;
		},
	};
}

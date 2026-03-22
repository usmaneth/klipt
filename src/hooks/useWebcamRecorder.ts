import { fixWebmDuration } from "@fix-webm-duration/fix";
import { useCallback, useEffect, useRef, useState } from "react";

const WEBCAM_BITRATE = 2_500_000;
const RECORDER_TIMESLICE_MS = 1000;
const WEBCAM_FILE_PREFIX = "webcam-";
const VIDEO_FILE_EXTENSION = ".webm";

export interface UseWebcamRecorderOptions {
	enabled: boolean;
	deviceId: string;
	previewVisible: boolean;
}

export interface UseWebcamRecorderReturn {
	stream: MediaStream | null;
	recording: boolean;
	previewVisible: boolean;
	setPreviewVisible: (v: boolean) => void;
	startRecording: () => Promise<void>;
	stopAndSave: () => Promise<string | null>;
}

function selectMimeType(): string {
	const preferred = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
	return preferred.find((type) => MediaRecorder.isTypeSupported(type)) ?? "video/webm";
}

export function useWebcamRecorder(options: UseWebcamRecorderOptions): UseWebcamRecorderReturn {
	const { enabled, deviceId, previewVisible: initialPreviewVisible } = options;

	const [stream, setStream] = useState<MediaStream | null>(null);
	const [recording, setRecording] = useState(false);
	const [previewVisible, setPreviewVisible] = useState(initialPreviewVisible);

	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const startTimeRef = useRef<number>(0);
	const streamRef = useRef<MediaStream | null>(null);
	const stopPromiseResolveRef = useRef<((path: string | null) => void) | null>(null);
	const mountedRef = useRef(true);

	// Keep previewVisible in sync with external prop changes
	useEffect(() => {
		setPreviewVisible(initialPreviewVisible);
	}, [initialPreviewVisible]);

	const cleanup = useCallback(() => {
		if (streamRef.current) {
			streamRef.current.getTracks().forEach((track) => track.stop());
			streamRef.current = null;
		}
		mediaRecorderRef.current = null;
		chunksRef.current = [];
		startTimeRef.current = 0;
		if (mountedRef.current) {
			setStream(null);
			setRecording(false);
		}
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			if (mediaRecorderRef.current?.state === "recording") {
				mediaRecorderRef.current.stop();
			}
			if (streamRef.current) {
				streamRef.current.getTracks().forEach((track) => track.stop());
				streamRef.current = null;
			}
			if (previewStreamRef.current) {
				previewStreamRef.current.getTracks().forEach((track) => track.stop());
				previewStreamRef.current = null;
			}
		};
	}, []);

	// Start/stop preview stream when camera is enabled/disabled (before recording)
	const previewStreamRef = useRef<MediaStream | null>(null);
	useEffect(() => {
		if (enabled && deviceId && !recording) {
			navigator.mediaDevices
				.getUserMedia({
					video: { deviceId: { exact: deviceId } },
					audio: false,
				})
				.then((previewStream) => {
					if (!mountedRef.current) {
						previewStream.getTracks().forEach((t) => t.stop());
						return;
					}
					previewStreamRef.current = previewStream;
					setStream(previewStream);
				})
				.catch((err) => {
					console.error("Failed to start webcam preview:", err);
				});
		} else if (!enabled && previewStreamRef.current) {
			previewStreamRef.current.getTracks().forEach((t) => t.stop());
			previewStreamRef.current = null;
			if (!recording && mountedRef.current) {
				setStream(null);
			}
		}

		return () => {
			if (previewStreamRef.current) {
				previewStreamRef.current.getTracks().forEach((t) => t.stop());
				previewStreamRef.current = null;
			}
		};
	}, [enabled, deviceId, recording]);

	const saveRecording = useCallback(async (mimeType: string): Promise<string | null> => {
		if (chunksRef.current.length === 0) return null;

		const duration = Date.now() - startTimeRef.current;
		const recordedChunks = chunksRef.current;
		chunksRef.current = [];

		const buggyBlob = new Blob(recordedChunks, { type: mimeType });
		const timestamp = Date.now();
		const fileName = `${WEBCAM_FILE_PREFIX}${timestamp}${VIDEO_FILE_EXTENSION}`;

		try {
			const videoBlob = await fixWebmDuration(buggyBlob, duration);
			const arrayBuffer = await videoBlob.arrayBuffer();

			const api = window.electronAPI as Record<string, unknown>;
			if (typeof api.storeWebcamVideo === "function") {
				const result = (await (
					api.storeWebcamVideo as (
						data: ArrayBuffer,
						name: string,
					) => Promise<{
						success: boolean;
						path?: string;
						message?: string;
					}>
				)(arrayBuffer, fileName)) as {
					success: boolean;
					path?: string;
					message?: string;
				};
				if (result.success && result.path) {
					return result.path;
				}
				console.error("Failed to store webcam video:", result.message);
				return null;
			}

			// Fallback: use storeRecordedVideo if storeWebcamVideo is not yet available
			const result = await window.electronAPI.storeRecordedVideo(arrayBuffer, fileName);
			if (result.success && result.path) {
				return result.path;
			}
			console.error("Failed to store webcam video:", result.message);
			return null;
		} catch (error) {
			console.error("Error saving webcam recording:", error);
			return null;
		}
	}, []);

	const stopAndSave = useCallback(async (): Promise<string | null> => {
		const recorder = mediaRecorderRef.current;
		if (!recorder || recorder.state !== "recording") {
			cleanup();
			return null;
		}

		const mimeType = recorder.mimeType;

		return new Promise<string | null>((resolve) => {
			stopPromiseResolveRef.current = resolve;

			recorder.onstop = async () => {
				if (mountedRef.current) {
					setRecording(false);
				}
				const savedPath = await saveRecording(mimeType);
				cleanup();
				stopPromiseResolveRef.current = null;
				resolve(savedPath);
			};

			recorder.stop();
		});
	}, [cleanup, saveRecording]);

	const startRecording = useCallback(async () => {
		if (!enabled || !deviceId) return;

		// Stop any existing recording first
		if (mediaRecorderRef.current?.state === "recording") {
			await stopAndSave();
		}

		cleanup();

		// Stop preview stream before starting recording stream
		if (previewStreamRef.current) {
			previewStreamRef.current.getTracks().forEach((t) => t.stop());
			previewStreamRef.current = null;
		}

		try {
			const webcamStream = await navigator.mediaDevices.getUserMedia({
				video: { deviceId: { exact: deviceId } },
				audio: false,
			});

			streamRef.current = webcamStream;
			if (mountedRef.current) {
				setStream(webcamStream);
			}

			// Listen for camera disconnect
			const videoTrack = webcamStream.getVideoTracks()[0];
			if (videoTrack) {
				videoTrack.onended = () => {
					void stopAndSave();
				};
			}

			const mimeType = selectMimeType();
			const recorder = new MediaRecorder(webcamStream, {
				mimeType,
				videoBitsPerSecond: WEBCAM_BITRATE,
			});

			mediaRecorderRef.current = recorder;

			recorder.ondataavailable = (event) => {
				if (event.data && event.data.size > 0) {
					chunksRef.current.push(event.data);
				}
			};

			recorder.onerror = () => {
				if (mountedRef.current) {
					setRecording(false);
				}
				cleanup();
			};

			recorder.start(RECORDER_TIMESLICE_MS);
			startTimeRef.current = Date.now();
			if (mountedRef.current) {
				setRecording(true);
			}
		} catch (error) {
			console.error("Failed to start webcam recording:", error);
			cleanup();
		}
	}, [enabled, deviceId, cleanup, stopAndSave]);

	return {
		stream,
		recording,
		previewVisible,
		setPreviewVisible,
		startRecording,
		stopAndSave,
	};
}

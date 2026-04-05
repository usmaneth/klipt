import { useCallback, useEffect, useRef, useState } from "react";

interface UseRecordingTimerOptions {
	autoStopMs?: number;
	onAutoStop?: () => void;
}

interface UseRecordingTimerReturn {
	elapsedMs: number;
	isRunning: boolean;
	start: () => void;
	stop: () => void;
	reset: () => void;
	remainingMs: number | null;
}

/**
 * Reusable hook for recording timer with optional auto-stop.
 *
 * - Tracks elapsed recording time in milliseconds.
 * - When `autoStopMs` is set (> 0), computes a countdown and
 *   fires `onAutoStop` when the countdown reaches zero.
 */
export function useRecordingTimer(options: UseRecordingTimerOptions = {}): UseRecordingTimerReturn {
	const { autoStopMs = 0, onAutoStop } = options;

	const [elapsedMs, setElapsedMs] = useState(0);
	const [isRunning, setIsRunning] = useState(false);

	const startTimeRef = useRef<number | null>(null);
	const rafRef = useRef<number | null>(null);
	const onAutoStopRef = useRef(onAutoStop);

	// Keep callback ref fresh without re-triggering effects
	useEffect(() => {
		onAutoStopRef.current = onAutoStop;
	}, [onAutoStop]);

	const tick = useCallback(() => {
		if (startTimeRef.current == null) return;
		const now = performance.now();
		const elapsed = now - startTimeRef.current;
		setElapsedMs(elapsed);
		rafRef.current = requestAnimationFrame(tick);
	}, []);

	const start = useCallback(() => {
		if (startTimeRef.current != null) return; // already running
		startTimeRef.current = performance.now();
		setIsRunning(true);
		setElapsedMs(0);
		rafRef.current = requestAnimationFrame(tick);
	}, [tick]);

	const stop = useCallback(() => {
		setIsRunning(false);
		startTimeRef.current = null;
		if (rafRef.current != null) {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = null;
		}
	}, []);

	const reset = useCallback(() => {
		stop();
		setElapsedMs(0);
	}, [stop]);

	// Auto-stop logic
	useEffect(() => {
		if (!isRunning || autoStopMs <= 0) return;
		if (elapsedMs >= autoStopMs) {
			stop();
			onAutoStopRef.current?.();
		}
	}, [isRunning, elapsedMs, autoStopMs, stop]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (rafRef.current != null) {
				cancelAnimationFrame(rafRef.current);
			}
		};
	}, []);

	const remainingMs = autoStopMs > 0 && isRunning ? Math.max(0, autoStopMs - elapsedMs) : null;

	return {
		elapsedMs,
		isRunning,
		start,
		stop,
		reset,
		remainingMs,
	};
}

/** Format milliseconds as MM:SS */
export function formatTimerDisplay(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

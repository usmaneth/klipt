import type { Size } from "../markers.ts";

export type CaptureStart = {
	/** Epoch ms of the first frame. Undefined when the source cannot say: the recorder then aligns the end. */
	startedAtMs?: number;
	/** The space of tap markers in pixels: the CSS viewport of a tab, the screen of a device, the X window. */
	tapSpace?: Size;
	/** Facts for session.json, for example the DevTools URL of a tab that klipt opened. */
	info: Record<string, unknown>;
};

export type Capture = {
	/** Resolves when frames flow. Rejects with a reason when the source cannot start. */
	started: Promise<CaptureStart>;
	/** Resolves with a reason when the source ends by itself (the tab closed, the device went away). */
	ended: Promise<string>;
	/** Stop and close the capture file. */
	stop(): Promise<{ file: string; warnings: string[] }>;
};

export type CaptureEnv = {
	/** The folder of the recording. The capture writes capture.mkv and capture.log here. */
	out: string;
	fps: number;
	/** Called for each tap the source sees by itself (a pointer down in a tab), in epoch ms. */
	onTap: (tap: { x: number; y: number }, atMs: number) => void;
};

/** A promise with its resolve and reject, for events that end a capture. */
export function deferred<T>(): {
	promise: Promise<T>;
	resolve: (v: T) => void;
	reject: (e: Error) => void;
} {
	let resolve!: (v: T) => void;
	let reject!: (e: Error) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

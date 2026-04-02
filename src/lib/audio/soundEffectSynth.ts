/**
 * Programmatic sound-effect synthesizer using OfflineAudioContext.
 *
 * Each effect is generated from scratch with oscillators, noise buffers, and
 * envelope shaping — no external audio files needed.
 */

import type { SoundEffectId } from "@/components/video-editor/types";

const SAMPLE_RATE = 44100;

/** Cached synthesis promises keyed by sound-effect ID (prevents concurrent duplicates). */
const bufferCache = new Map<SoundEffectId, Promise<AudioBuffer>>();

// ── Noise helper ──────────────────────────────────────────────────────────────

function createNoiseBuffer(ctx: OfflineAudioContext, durationSec: number): AudioBuffer {
	const length = Math.ceil(durationSec * ctx.sampleRate);
	const buf = ctx.createBuffer(1, length, ctx.sampleRate);
	const data = buf.getChannelData(0);
	for (let i = 0; i < length; i++) {
		data[i] = Math.random() * 2 - 1;
	}
	return buf;
}

// ── Individual synthesisers ───────────────────────────────────────────────────

async function synthClick(): Promise<AudioBuffer> {
	const dur = 0.2;
	const ctx = new OfflineAudioContext(1, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);

	// Short noise burst shaped by a fast exponential decay
	const noiseBuf = createNoiseBuffer(ctx, dur);
	const src = ctx.createBufferSource();
	src.buffer = noiseBuf;

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.8, 0);
	gain.gain.exponentialRampToValueAtTime(0.001, 0.05);

	// Highpass to make it "clicky"
	const hp = ctx.createBiquadFilter();
	hp.type = "highpass";
	hp.frequency.value = 2000;

	src.connect(hp).connect(gain).connect(ctx.destination);
	src.start(0);
	return ctx.startRendering();
}

async function synthWhoosh(): Promise<AudioBuffer> {
	const dur = 0.5;
	const ctx = new OfflineAudioContext(1, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);

	const noiseBuf = createNoiseBuffer(ctx, dur);
	const src = ctx.createBufferSource();
	src.buffer = noiseBuf;

	// Bandpass sweep from low to high
	const bp = ctx.createBiquadFilter();
	bp.type = "bandpass";
	bp.Q.value = 2;
	bp.frequency.setValueAtTime(200, 0);
	bp.frequency.exponentialRampToValueAtTime(4000, dur * 0.6);
	bp.frequency.exponentialRampToValueAtTime(800, dur);

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.001, 0);
	gain.gain.linearRampToValueAtTime(0.7, dur * 0.3);
	gain.gain.linearRampToValueAtTime(0.001, dur);

	src.connect(bp).connect(gain).connect(ctx.destination);
	src.start(0);
	return ctx.startRendering();
}

async function synthPop(): Promise<AudioBuffer> {
	const dur = 0.3;
	const ctx = new OfflineAudioContext(1, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);

	// Short sine burst with pitch drop
	const osc = ctx.createOscillator();
	osc.type = "sine";
	osc.frequency.setValueAtTime(600, 0);
	osc.frequency.exponentialRampToValueAtTime(80, 0.15);

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.9, 0);
	gain.gain.exponentialRampToValueAtTime(0.001, 0.2);

	osc.connect(gain).connect(ctx.destination);
	osc.start(0);
	osc.stop(dur);
	return ctx.startRendering();
}

async function synthDing(): Promise<AudioBuffer> {
	const dur = 0.8;
	const ctx = new OfflineAudioContext(1, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);

	// Bell-like: fundamental + inharmonic partials
	const freqs = [880, 1760, 2640, 3520];
	const amps = [0.5, 0.25, 0.15, 0.1];

	for (let i = 0; i < freqs.length; i++) {
		const osc = ctx.createOscillator();
		osc.type = "sine";
		osc.frequency.value = freqs[i];

		const gain = ctx.createGain();
		gain.gain.setValueAtTime(amps[i], 0);
		gain.gain.exponentialRampToValueAtTime(0.001, dur * (0.5 + i * 0.1));

		osc.connect(gain).connect(ctx.destination);
		osc.start(0);
		osc.stop(dur);
	}

	return ctx.startRendering();
}

async function synthSwoosh(): Promise<AudioBuffer> {
	const dur = 0.6;
	const ctx = new OfflineAudioContext(1, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);

	const noiseBuf = createNoiseBuffer(ctx, dur);
	const src = ctx.createBufferSource();
	src.buffer = noiseBuf;

	// Fast sweep high-to-low
	const bp = ctx.createBiquadFilter();
	bp.type = "bandpass";
	bp.Q.value = 3;
	bp.frequency.setValueAtTime(5000, 0);
	bp.frequency.exponentialRampToValueAtTime(200, dur);

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.001, 0);
	gain.gain.linearRampToValueAtTime(0.6, dur * 0.15);
	gain.gain.linearRampToValueAtTime(0.001, dur);

	src.connect(bp).connect(gain).connect(ctx.destination);
	src.start(0);
	return ctx.startRendering();
}

async function synthThud(): Promise<AudioBuffer> {
	const dur = 0.3;
	const ctx = new OfflineAudioContext(1, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);

	// Low sine with noise impact
	const osc = ctx.createOscillator();
	osc.type = "sine";
	osc.frequency.setValueAtTime(100, 0);
	osc.frequency.exponentialRampToValueAtTime(40, 0.15);

	const oscGain = ctx.createGain();
	oscGain.gain.setValueAtTime(0.9, 0);
	oscGain.gain.exponentialRampToValueAtTime(0.001, 0.25);

	osc.connect(oscGain).connect(ctx.destination);
	osc.start(0);
	osc.stop(dur);

	// Noise layer
	const noiseBuf = createNoiseBuffer(ctx, dur);
	const noiseSrc = ctx.createBufferSource();
	noiseSrc.buffer = noiseBuf;

	const lp = ctx.createBiquadFilter();
	lp.type = "lowpass";
	lp.frequency.value = 500;

	const noiseGain = ctx.createGain();
	noiseGain.gain.setValueAtTime(0.4, 0);
	noiseGain.gain.exponentialRampToValueAtTime(0.001, 0.1);

	noiseSrc.connect(lp).connect(noiseGain).connect(ctx.destination);
	noiseSrc.start(0);

	return ctx.startRendering();
}

async function synthRise(): Promise<AudioBuffer> {
	const dur = 1.0;
	const ctx = new OfflineAudioContext(1, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);

	// Rising tone + noise sweep
	const osc = ctx.createOscillator();
	osc.type = "sawtooth";
	osc.frequency.setValueAtTime(200, 0);
	osc.frequency.exponentialRampToValueAtTime(2000, dur);

	const oscGain = ctx.createGain();
	oscGain.gain.setValueAtTime(0.001, 0);
	oscGain.gain.linearRampToValueAtTime(0.35, dur * 0.8);
	oscGain.gain.linearRampToValueAtTime(0.001, dur);

	const lp = ctx.createBiquadFilter();
	lp.type = "lowpass";
	lp.frequency.setValueAtTime(400, 0);
	lp.frequency.exponentialRampToValueAtTime(6000, dur);

	osc.connect(lp).connect(oscGain).connect(ctx.destination);
	osc.start(0);
	osc.stop(dur);

	// Noise layer
	const noiseBuf = createNoiseBuffer(ctx, dur);
	const noiseSrc = ctx.createBufferSource();
	noiseSrc.buffer = noiseBuf;

	const bp = ctx.createBiquadFilter();
	bp.type = "bandpass";
	bp.Q.value = 2;
	bp.frequency.setValueAtTime(300, 0);
	bp.frequency.exponentialRampToValueAtTime(5000, dur);

	const noiseGain = ctx.createGain();
	noiseGain.gain.setValueAtTime(0.001, 0);
	noiseGain.gain.linearRampToValueAtTime(0.15, dur * 0.7);
	noiseGain.gain.linearRampToValueAtTime(0.001, dur);

	noiseSrc.connect(bp).connect(noiseGain).connect(ctx.destination);
	noiseSrc.start(0);

	return ctx.startRendering();
}

async function synthFall(): Promise<AudioBuffer> {
	const dur = 0.8;
	const ctx = new OfflineAudioContext(1, Math.ceil(dur * SAMPLE_RATE), SAMPLE_RATE);

	// Falling tone
	const osc = ctx.createOscillator();
	osc.type = "sawtooth";
	osc.frequency.setValueAtTime(2000, 0);
	osc.frequency.exponentialRampToValueAtTime(100, dur);

	const oscGain = ctx.createGain();
	oscGain.gain.setValueAtTime(0.35, 0);
	oscGain.gain.linearRampToValueAtTime(0.001, dur);

	const lp = ctx.createBiquadFilter();
	lp.type = "lowpass";
	lp.frequency.setValueAtTime(6000, 0);
	lp.frequency.exponentialRampToValueAtTime(200, dur);

	osc.connect(lp).connect(oscGain).connect(ctx.destination);
	osc.start(0);
	osc.stop(dur);

	// Noise layer
	const noiseBuf = createNoiseBuffer(ctx, dur);
	const noiseSrc = ctx.createBufferSource();
	noiseSrc.buffer = noiseBuf;

	const bp = ctx.createBiquadFilter();
	bp.type = "bandpass";
	bp.Q.value = 2;
	bp.frequency.setValueAtTime(4000, 0);
	bp.frequency.exponentialRampToValueAtTime(200, dur);

	const noiseGain = ctx.createGain();
	noiseGain.gain.setValueAtTime(0.15, 0);
	noiseGain.gain.linearRampToValueAtTime(0.001, dur);

	noiseSrc.connect(bp).connect(noiseGain).connect(ctx.destination);
	noiseSrc.start(0);

	return ctx.startRendering();
}

// ── Synth dispatch ────────────────────────────────────────────────────────────

const SYNTH_MAP: Record<SoundEffectId, () => Promise<AudioBuffer>> = {
	"sfx-click": synthClick,
	"sfx-whoosh": synthWhoosh,
	"sfx-pop": synthPop,
	"sfx-ding": synthDing,
	"sfx-swoosh": synthSwoosh,
	"sfx-thud": synthThud,
	"sfx-rise": synthRise,
	"sfx-fall": synthFall,
};

/** Duration in seconds for each sound effect (used for region sizing). */
export const SFX_DURATIONS: Record<SoundEffectId, number> = {
	"sfx-click": 0.2,
	"sfx-whoosh": 0.5,
	"sfx-pop": 0.3,
	"sfx-ding": 0.8,
	"sfx-swoosh": 0.6,
	"sfx-thud": 0.3,
	"sfx-rise": 1.0,
	"sfx-fall": 0.8,
};

/**
 * Get (or synthesise & cache) the AudioBuffer for a given sound effect.
 */
export function getSoundEffectBuffer(id: SoundEffectId): Promise<AudioBuffer> {
	const cached = bufferCache.get(id);
	if (cached) return cached;

	const synthFn = SYNTH_MAP[id];
	// Cache the promise immediately to prevent concurrent duplicate synthesis
	const promise = synthFn();
	bufferCache.set(id, promise);
	return promise;
}

/**
 * Preview-play a sound effect through the default audio output.
 */
export async function previewSoundEffect(id: SoundEffectId, volume = 0.7): Promise<void> {
	const buffer = await getSoundEffectBuffer(id);
	const ctx = new AudioContext();
	const src = ctx.createBufferSource();
	src.buffer = buffer;

	const gain = ctx.createGain();
	gain.gain.value = volume;

	src.connect(gain).connect(ctx.destination);
	src.start(0);
	src.onended = () => ctx.close();
}

/**
 * Mix an array of SoundEffectRegions onto a base audio AudioBuffer using
 * OfflineAudioContext.  Returns a new AudioBuffer with all effects baked in.
 *
 * If `baseBuffer` is null (no original audio), creates a silent base track.
 */
export async function mixSoundEffects(
	baseBuffer: AudioBuffer | null,
	effects: { buffer: AudioBuffer; startSec: number; volume: number }[],
	totalDurationSec: number,
): Promise<AudioBuffer> {
	const channels = baseBuffer?.numberOfChannels ?? 1;
	const sampleRate = baseBuffer?.sampleRate ?? SAMPLE_RATE;
	const length = Math.ceil(totalDurationSec * sampleRate);

	const offline = new OfflineAudioContext(channels, length, sampleRate);

	// Base track
	if (baseBuffer) {
		const baseSrc = offline.createBufferSource();
		baseSrc.buffer = baseBuffer;
		baseSrc.connect(offline.destination);
		baseSrc.start(0);
	}

	// Overlay each effect at its timestamp
	for (const fx of effects) {
		const src = offline.createBufferSource();
		src.buffer = fx.buffer;
		const gain = offline.createGain();
		gain.gain.value = Math.max(0, Math.min(1, fx.volume));
		src.connect(gain).connect(offline.destination);
		src.start(fx.startSec);
	}

	return offline.startRendering();
}

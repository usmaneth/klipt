/**
 * Voice cloning via the official Chatterbox Python package.
 * Uses a subprocess to run the reference implementation — guaranteed to work.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface VoiceCloneResult {
	outputPath: string;
	duration: number;
}

/**
 * Check if Chatterbox Python package is installed.
 */
export async function isChatterboxInstalled(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn("python3", ["-c", "from chatterbox.tts import ChatterboxTTS; print('ok')"], {
			stdio: "pipe",
		});
		let output = "";
		proc.stdout.on("data", (d: Buffer) => { output += d.toString(); });
		proc.on("close", (code) => {
			resolve(code === 0 && output.includes("ok"));
		});
		proc.on("error", () => resolve(false));
	});
}

/**
 * Generate cloned speech using official Chatterbox Python package.
 *
 * @param referenceAudioPath - 5-10s WAV of the user's voice (for voice identity)
 * @param text - The text to speak (in target language)
 * @param outputPath - Where to save the output WAV
 * @param onProgress - Progress callback (0-1)
 */
export async function generateClonedSpeechPython(opts: {
	referenceAudioPath: string;
	text: string;
	outputPath: string;
	onProgress?: (fraction: number) => void;
}): Promise<void> {
	const { referenceAudioPath, text, outputPath, onProgress } = opts;

	// Write a temporary Python script that runs Chatterbox
	const scriptPath = path.join(os.tmpdir(), `klipt-vc-${Date.now()}.py`);
	const script = `
import sys
import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS

ref_audio = sys.argv[1]
text = sys.argv[2]
output = sys.argv[3]

print("PROGRESS:10:Loading model...", flush=True)
model = ChatterboxTTS.from_pretrained(device="mps" if torch.backends.mps.is_available() else "cpu")

print("PROGRESS:30:Generating speech...", flush=True)
wav = model.generate(text, audio_prompt_path=ref_audio)

print("PROGRESS:80:Saving audio...", flush=True)
torchaudio.save(output, wav, model.sr)

print("PROGRESS:100:Done", flush=True)
print("SUCCESS", flush=True)
`;

	await fs.writeFile(scriptPath, script, "utf-8");

	onProgress?.(0.05);

	return new Promise<void>((resolve, reject) => {
		const proc = spawn("python3", [scriptPath, referenceAudioPath, text, outputPath], {
			stdio: "pipe",
			env: { ...process.env },
		});

		let stderr = "";
		let succeeded = false;

		proc.stdout.on("data", (data: Buffer) => {
			const lines = data.toString().split("\n");
			for (const line of lines) {
				if (line.startsWith("PROGRESS:")) {
					const parts = line.split(":");
					const pct = Number.parseInt(parts[1] ?? "0", 10);
					const msg = parts.slice(2).join(":");
					onProgress?.(pct / 100);
					console.log(`[voice-clone-py] ${pct}% ${msg}`);
				}
				if (line.trim() === "SUCCESS") {
					succeeded = true;
				}
			}
		});

		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString();
		});

		proc.on("close", async (code) => {
			// Clean up temp script
			await fs.unlink(scriptPath).catch(() => {});

			if (code === 0 && succeeded) {
				resolve();
			} else {
				reject(new Error(`Voice clone failed (code ${code}): ${stderr.slice(-500)}`));
			}
		});

		proc.on("error", async (err) => {
			await fs.unlink(scriptPath).catch(() => {});
			reject(new Error(`Failed to run Python: ${err.message}`));
		});

		// Timeout after 5 minutes
		setTimeout(() => {
			try { proc.kill(); } catch {}
			reject(new Error("Voice clone timed out after 5 minutes"));
		}, 300_000);
	});
}

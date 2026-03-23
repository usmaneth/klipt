/**
 * setup-voice-clone.mjs
 *
 * Downloads the Chatterbox-Turbo ONNX model (q4f16 quantisation) from HuggingFace
 * and stores it in the app's userData directory for on-device voice cloning.
 *
 * Can be run standalone for pre-seeding:
 *   node scripts/setup-voice-clone.mjs [--dest <dir>]
 *
 * Or it is invoked at runtime via the IPC handler in the Electron main process.
 */

import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";

const MODEL_ID = "ResembleAI/chatterbox-turbo-ONNX";
const QUANT = "q4f16";
const HF_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main`;

const MODEL_FILES = [
	{ name: "conditional_decoder", suffix: `_${QUANT}` },
	{ name: "embed_tokens", suffix: `_${QUANT}` },
	{ name: "language_model", suffix: `_${QUANT}` },
	{ name: "speech_encoder", suffix: `_${QUANT}` },
];

function getDownloadList(destDir) {
	const files = [];
	for (const m of MODEL_FILES) {
		const onnxFile = `${m.name}${m.suffix}.onnx`;
		const dataFile = `${onnxFile}_data`;
		files.push({ url: `${HF_BASE}/onnx/${onnxFile}`, dest: path.join(destDir, onnxFile) });
		files.push({ url: `${HF_BASE}/onnx/${dataFile}`, dest: path.join(destDir, dataFile) });
	}
	files.push({ url: `${HF_BASE}/tokenizer.json`, dest: path.join(destDir, "tokenizer.json") });
	files.push({ url: `${HF_BASE}/tokenizer_config.json`, dest: path.join(destDir, "tokenizer_config.json") });
	return files;
}

function downloadFile(url, destPath) {
	return new Promise((resolve, reject) => {
		const request = (currentUrl, redirectCount = 0) => {
			const req = httpsGet(currentUrl, (res) => {
				const statusCode = res.statusCode ?? 0;
				const location = res.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					res.resume();
					if (redirectCount >= 10) {
						reject(new Error(`Too many redirects for ${url}`));
						return;
					}
					request(new URL(location, currentUrl).toString(), redirectCount + 1);
					return;
				}

				if (statusCode < 200 || statusCode >= 300) {
					res.resume();
					reject(new Error(`HTTP ${statusCode} downloading ${url}`));
					return;
				}

				const contentLength = parseInt(res.headers["content-length"] ?? "0", 10);
				let downloaded = 0;

				const ws = createWriteStream(destPath);
				res.on("data", (chunk) => {
					downloaded += chunk.length;
					if (contentLength > 0) {
						const pct = Math.round((downloaded / contentLength) * 100);
						process.stdout.write(`\r  ${path.basename(destPath)}: ${pct}% (${(downloaded / 1024 / 1024).toFixed(1)} MB)`);
					}
				});
				res.pipe(ws);
				ws.on("finish", () => {
					process.stdout.write("\n");
					resolve();
				});
				ws.on("error", reject);
				res.on("error", reject);
			});
			req.on("error", reject);
		};
		request(url);
	});
}

async function main() {
	// Parse args
	let destDir;
	const args = process.argv.slice(2);
	const destIdx = args.indexOf("--dest");
	if (destIdx !== -1 && args[destIdx + 1]) {
		destDir = path.resolve(args[destIdx + 1]);
	} else {
		// Default: project-relative location (for dev/testing)
		destDir = path.join(process.cwd(), ".tmp", "voice-clone-models");
	}

	console.log(`[setup-voice-clone] Destination: ${destDir}`);
	await mkdir(destDir, { recursive: true });

	// Check manifest
	const manifestPath = path.join(destDir, "manifest.json");
	if (existsSync(manifestPath)) {
		try {
			const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
			if (manifest.complete === true) {
				console.log("[setup-voice-clone] Model already downloaded. Done.");
				return;
			}
		} catch {
			// continue
		}
	}

	const files = getDownloadList(destDir);
	let skipped = 0;

	for (const f of files) {
		const fileName = path.basename(f.dest);
		if (existsSync(f.dest)) {
			const s = await stat(f.dest);
			if (s.size > 0) {
				console.log(`  ${fileName}: already exists (${(s.size / 1024 / 1024).toFixed(1)} MB), skipping`);
				skipped++;
				continue;
			}
		}
		console.log(`  Downloading ${fileName}...`);
		await downloadFile(f.url, f.dest);
	}

	// Write manifest
	await writeFile(
		manifestPath,
		JSON.stringify({ complete: true, quant: QUANT, modelId: MODEL_ID }, null, "\t"),
		"utf8",
	);

	console.log(`[setup-voice-clone] Done. ${files.length - skipped} files downloaded, ${skipped} skipped.`);
}

await main();

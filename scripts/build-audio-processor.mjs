import { spawnSync } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const nativeRoot = path.join(projectRoot, "electron", "native");

if (process.platform !== "darwin") {
	console.log("[build-audio-processor] Skipping: host platform is not macOS.");
	process.exit(0);
}

const swiftcCheck = spawnSync("swiftc", ["--version"], { encoding: "utf8" });
if (swiftcCheck.status !== 0) {
	const details = [swiftcCheck.stderr, swiftcCheck.stdout]
		.filter(Boolean)
		.join("\n")
		.trim();
	throw new Error(
		details || "swiftc is unavailable; install Xcode Command Line Tools.",
	);
}

const archTag = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
const target =
	process.arch === "arm64"
		? "arm64-apple-macos14.0"
		: "x86_64-apple-macos14.0";
const outputDir = path.join(nativeRoot, "bin", archTag);

await mkdir(outputDir, { recursive: true });

const sourcePath = path.join(nativeRoot, "AudioProcessor.swift");
const outputPath = path.join(outputDir, "klipt-audio");

console.log(`[build-audio-processor] Compiling AudioProcessor.swift...`);
console.log(`  Source: ${sourcePath}`);
console.log(`  Output: ${outputPath}`);
console.log(`  Target: ${target}`);

const result = spawnSync(
	"swiftc",
	[
		"-O",
		"-target",
		target,
		"-framework",
		"AVFoundation",
		"-framework",
		"Accelerate",
		"-framework",
		"CoreAudio",
		sourcePath,
		"-o",
		outputPath,
	],
	{
		encoding: "utf8",
		timeout: 120000,
	},
);

if (result.status !== 0) {
	const details = [result.stderr, result.stdout]
		.filter(Boolean)
		.join("\n")
		.trim();
	console.error(`[build-audio-processor] Compilation failed:\n${details}`);
	process.exit(1);
}

await chmod(outputPath, 0o755);
console.log(
	`[build-audio-processor] Built klipt-audio -> ${outputPath}`,
);

// Quick smoke test
const smokeTest = spawnSync(outputPath, [], { encoding: "utf8", timeout: 5000 });
if (smokeTest.status === 1 && smokeTest.stderr?.includes("Usage:")) {
	console.log("[build-audio-processor] Smoke test passed (usage printed).");
} else {
	console.log(
		`[build-audio-processor] Smoke test: exit=${smokeTest.status}`,
	);
}

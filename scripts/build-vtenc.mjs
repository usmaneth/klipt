import { spawnSync } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const nativeRoot = path.join(projectRoot, "electron", "native");

if (process.platform !== "darwin") {
	console.log("[build-vtenc] Skipping: host platform is not macOS.");
	process.exit(0);
}

// Verify swiftc is available
const swiftcCheck = spawnSync("swiftc", ["--version"], { encoding: "utf8" });
if (swiftcCheck.status !== 0) {
	const details = [swiftcCheck.stderr, swiftcCheck.stdout].filter(Boolean).join("\n").trim();
	throw new Error(details || "swiftc is unavailable; install Xcode Command Line Tools.");
}

const archTag = process.arch === "arm64" ? "darwin-arm64" : "darwin-x64";
const outputDir = path.join(nativeRoot, "bin", archTag);
await mkdir(outputDir, { recursive: true });

const sourcePath = path.join(nativeRoot, "VideoToolboxEncoder.swift");
const outputPath = path.join(outputDir, "klipt-vtenc");

console.log("[build-vtenc] Compiling VideoToolboxEncoder.swift...");
console.log(`[build-vtenc]   Source: ${sourcePath}`);
console.log(`[build-vtenc]   Output: ${outputPath}`);
console.log(`[build-vtenc]   Arch: ${archTag}`);

const result = spawnSync(
	"swiftc",
	[
		"-O",
		"-target",
		process.arch === "arm64" ? "arm64-apple-macos14.0" : "x86_64-apple-macos14.0",
		"-framework", "VideoToolbox",
		"-framework", "CoreMedia",
		"-framework", "CoreVideo",
		"-framework", "AVFoundation",
		"-framework", "Foundation",
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
	const details = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
	console.error(`[build-vtenc] Compilation failed:\n${details}`);
	process.exit(1);
}

await chmod(outputPath, 0o755);
console.log(`[build-vtenc] Built klipt-vtenc -> ${outputPath}`);

// Show binary info
const fileInfo = spawnSync("file", [outputPath], { encoding: "utf8" });
if (fileInfo.status === 0) {
	console.log(`[build-vtenc] ${fileInfo.stdout.trim()}`);
}

const sizeInfo = spawnSync("ls", ["-lh", outputPath], { encoding: "utf8" });
if (sizeInfo.status === 0) {
	const parts = sizeInfo.stdout.trim().split(/\s+/);
	console.log(`[build-vtenc] Binary size: ${parts[4]}`);
}

// Quick sanity check: run with --help
const helpCheck = spawnSync(outputPath, ["--help"], { encoding: "utf8", timeout: 5000 });
if (helpCheck.status === 0) {
	console.log("[build-vtenc] Sanity check passed (--help exits cleanly).");
} else {
	console.warn("[build-vtenc] Warning: --help did not exit cleanly.");
}

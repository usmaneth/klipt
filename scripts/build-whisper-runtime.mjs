import { execFileSync, execSync } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import path from "node:path";

const projectRoot = process.cwd();
const whisperVersion = "v1.8.4";
const nativeRoot = path.join(projectRoot, "electron", "native");
const cacheRoot = path.join(projectRoot, ".tmp", "whisper-runtime");
const archivePath = path.join(cacheRoot, `${whisperVersion}.tar.gz`);
const extractRoot = path.join(cacheRoot, `src-${whisperVersion}`);

function getNativeArchTag(platform, arch) {
	if (platform === "darwin") {
		return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
	}
	if (platform === "win32") {
		return arch === "arm64" ? "win32-arm64" : "win32-x64";
	}
	if (platform === "linux") {
		return arch === "arm64" ? "linux-arm64" : "linux-x64";
	}
	throw new Error(`[build-whisper-runtime] Unsupported platform: ${platform}/${arch}`);
}

function getTargetConfigs() {
	if (process.platform === "darwin") {
		// Only build for the host architecture on macOS
		const arch = process.arch === "arm64" ? "arm64" : "x64";
		const archTag = getNativeArchTag("darwin", arch);
		return [
			{
				platform: "darwin",
				arch,
				archTag,
				buildRoot: path.join(cacheRoot, `build-${archTag}`),
				outputDir: path.join(nativeRoot, "bin", archTag),
				configureArgs: [
					"-DCMAKE_BUILD_TYPE=Release",
					`-DCMAKE_OSX_ARCHITECTURES=${arch === "arm64" ? "arm64" : "x86_64"}`,
					// Enable Metal GPU acceleration on macOS
					"-DGGML_METAL=ON",
				],
			},
		];
	}

	const arch = process.arch === "arm64" ? "arm64" : "x64";
	const archTag = getNativeArchTag(process.platform, arch);

	if (process.platform === "win32") {
		return [
			{
				platform: "win32",
				arch,
				archTag,
				buildRoot: path.join(cacheRoot, `build-${archTag}`),
				outputDir: path.join(nativeRoot, "bin", archTag),
				configureArgs: ["-G", "Visual Studio 17 2022", "-A", arch === "arm64" ? "ARM64" : "x64"],
			},
		];
	}

	if (process.platform === "linux") {
		return [
			{
				platform: "linux",
				arch,
				archTag,
				buildRoot: path.join(cacheRoot, `build-${archTag}`),
				outputDir: path.join(nativeRoot, "bin", archTag),
				configureArgs: ["-DCMAKE_BUILD_TYPE=Release"],
			},
		];
	}

	throw new Error(`[build-whisper-runtime] Unsupported platform: ${process.platform}/${process.arch}`);
}

function getSourceArchiveUrl() {
	return `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${whisperVersion}.tar.gz`;
}

function findCmake() {
	try {
		execFileSync("cmake", ["--version"], { stdio: "pipe" });
		return "cmake";
	} catch {
		// not on PATH
	}

	if (process.platform === "win32") {
		const vsEditions = ["Community", "Professional", "Enterprise", "BuildTools"];
		for (const edition of vsEditions) {
			const cmakePath = path.join(
				"C:",
				"Program Files",
				"Microsoft Visual Studio",
				"2022",
				edition,
				"Common7",
				"IDE",
				"CommonExtensions",
				"Microsoft",
				"CMake",
				"CMake",
				"bin",
				"cmake.exe",
			);
			if (existsSync(cmakePath)) {
				return cmakePath;
			}
		}
	}

	return null;
}

function ensureTarAvailable() {
	try {
		execFileSync("tar", ["--version"], { stdio: "pipe" });
	} catch {
		throw new Error("[build-whisper-runtime] tar is required to unpack whisper.cpp sources.");
	}
}

async function downloadFile(url, destinationPath) {
	await mkdir(path.dirname(destinationPath), { recursive: true });

	await new Promise((resolve, reject) => {
		const request = (currentUrl, redirectCount = 0) => {
			const req = httpsGet(currentUrl, (response) => {
				const statusCode = response.statusCode ?? 0;
				const location = response.headers.location;

				if (statusCode >= 300 && statusCode < 400 && location) {
					response.resume();
					if (redirectCount >= 5) {
						reject(new Error("[build-whisper-runtime] Too many redirects while downloading whisper.cpp source."));
						return;
					}
					request(new URL(location, currentUrl).toString(), redirectCount + 1);
					return;
				}

				if (statusCode < 200 || statusCode >= 300) {
					response.resume();
					reject(new Error(`[build-whisper-runtime] Failed to download whisper.cpp source: HTTP ${statusCode}`));
					return;
				}

				const fileStream = createWriteStream(destinationPath);
				fileStream.on("finish", resolve);
				fileStream.on("error", reject);
				response.on("error", reject);
				response.pipe(fileStream);
			});

			req.on("error", reject);
		};

		request(url);
	});
}

async function ensureSourceTree() {
	const extractedSourceDir = path.join(extractRoot, `whisper.cpp-${whisperVersion.replace(/^v/, "")}`);
	if (existsSync(path.join(extractedSourceDir, "CMakeLists.txt"))) {
		return extractedSourceDir;
	}

	await rm(extractRoot, { recursive: true, force: true });
	await mkdir(extractRoot, { recursive: true });

	if (!existsSync(archivePath)) {
		console.log(`[build-whisper-runtime] Downloading whisper.cpp ${whisperVersion} source...`);
		await downloadFile(getSourceArchiveUrl(), archivePath);
	}

	ensureTarAvailable();
	execFileSync("tar", ["-xzf", archivePath, "-C", extractRoot], { stdio: "inherit" });

	if (!existsSync(path.join(extractedSourceDir, "CMakeLists.txt"))) {
		throw new Error(`[build-whisper-runtime] Extracted whisper.cpp source not found at ${extractedSourceDir}`);
	}

	return extractedSourceDir;
}

async function shouldSkipBuild(target) {
	const manifestPath = path.join(target.outputDir, "whisper-runtime.json");
	if (!existsSync(manifestPath)) {
		return false;
	}

	try {
		const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		const binaryName = target.platform === "win32" ? "klipt-whisper-cli.exe" : "klipt-whisper-cli";
		const binaryPath = path.join(target.outputDir, binaryName);
		return (
			manifest.version === whisperVersion && manifest.arch === target.arch && existsSync(binaryPath)
		);
	} catch {
		return false;
	}
}

function getConfigureArgs(sourceDir, target) {
	return [
		"-S", sourceDir,
		"-B", target.buildRoot,
		"-DWHISPER_BUILD_TESTS=OFF",
		"-DWHISPER_BUILD_SERVER=OFF",
		// Build shared libs so we get libwhisper.dylib
		"-DBUILD_SHARED_LIBS=ON",
		...target.configureArgs,
	];
}

function getBuildArgs(target) {
	const args = ["--build", target.buildRoot, "--config", "Release"];
	if (target.platform !== "win32") {
		args.push("--parallel");
	}
	return args;
}

async function findRuntimeArtifacts(target) {
	const candidateDirs =
		target.platform === "win32"
			? [path.join(target.buildRoot, "bin", "Release"), path.join(target.buildRoot, "bin")]
			: [path.join(target.buildRoot, "bin")];

	for (const candidateDir of candidateDirs) {
		if (!existsSync(candidateDir)) {
			continue;
		}

		const entries = await readdir(candidateDir);
		const runtimeEntries = entries.filter((entry) =>
			/^(whisper|ggml|libwhisper|libggml)/i.test(entry),
		);
		if (runtimeEntries.length > 0) {
			return { candidateDir, runtimeEntries };
		}
	}

	throw new Error("[build-whisper-runtime] Built whisper runtime artifacts were not found.");
}

async function stageRuntimeArtifacts(target, candidateDir, runtimeEntries) {
	await mkdir(target.outputDir, { recursive: true });

	const binaryName = target.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
	const renamedBinary = target.platform === "win32" ? "klipt-whisper-cli.exe" : "klipt-whisper-cli";

	for (const entry of runtimeEntries) {
		const sourcePath = path.join(candidateDir, entry);
		const destName = entry === binaryName ? renamedBinary : entry;
		const destinationPath = path.join(target.outputDir, destName);
		const entryStats = await stat(sourcePath);

		if (entryStats.isDirectory()) {
			await rm(destinationPath, { recursive: true, force: true });
			await cp(sourcePath, destinationPath, { recursive: true });
			continue;
		}

		await cp(sourcePath, destinationPath, { force: true });
		if (target.platform !== "win32") {
			await chmod(destinationPath, 0o755).catch(() => undefined);
		}
	}

	// Also copy any .dylib/.so from the lib directory
	if (target.platform === "darwin" || target.platform === "linux") {
		const libDirs = [
			path.join(target.buildRoot, "src"),
			path.join(target.buildRoot, "lib"),
			path.join(target.buildRoot, "ggml", "src"),
			path.join(target.buildRoot, "ggml", "src", "ggml-blas"),
			path.join(target.buildRoot, "ggml", "src", "ggml-metal"),
			path.join(target.buildRoot, "ggml", "src", "ggml-cpu"),
		];

		for (const libDir of libDirs) {
			if (!existsSync(libDir)) continue;
			const libEntries = await readdir(libDir);
			const dynLibs = libEntries.filter((e) =>
				/\.(dylib|so)/.test(e) && /^lib(whisper|ggml)/.test(e),
			);
			for (const lib of dynLibs) {
				const src = path.join(libDir, lib);
				const dest = path.join(target.outputDir, lib);
				const s = await stat(src);
				if (s.isFile() || s.isSymbolicLink()) {
					await cp(src, dest, { force: true, dereference: true });
					await chmod(dest, 0o755).catch(() => undefined);
					console.log(`[build-whisper-runtime]   Copied ${lib} -> ${target.outputDir}`);
				}
			}
		}
	}

	// Fix rpath on macOS so all binaries/dylibs find each other via @loader_path
	if (target.platform === "darwin") {
		const outputEntries = await readdir(target.outputDir);
		const allDylibs = outputEntries.filter((e) => e.endsWith(".dylib"));
		const allBinaries = [
			...outputEntries.filter((e) => e === "klipt-whisper-cli"),
			...allDylibs,
		];

		for (const binaryName of allBinaries) {
			const binaryPath = path.join(target.outputDir, binaryName);
			// Rewrite every @rpath/ reference to @loader_path/
			for (const dylib of allDylibs) {
				try {
					execFileSync("install_name_tool", [
						"-change",
						`@rpath/${dylib}`,
						`@loader_path/${dylib}`,
						binaryPath,
					], { stdio: "pipe" });
				} catch {
					// Not all binaries reference all dylibs — that's fine
				}
			}
		}
		console.log("[build-whisper-runtime] Fixed all @rpath -> @loader_path references");
	}

	const manifestPath = path.join(target.outputDir, "whisper-runtime.json");
	await writeFile(
		manifestPath,
		JSON.stringify(
			{
				version: whisperVersion,
				platform: target.platform,
				arch: target.arch,
				binary: target.platform === "win32" ? "klipt-whisper-cli.exe" : "klipt-whisper-cli",
			},
			null,
			"\t",
		),
		"utf8",
	);
}

async function main() {
	const cmake = findCmake();
	if (!cmake) {
		throw new Error("[build-whisper-runtime] CMake is required to build the bundled Whisper runtime.");
	}

	const sourceDir = await ensureSourceTree();

	for (const target of getTargetConfigs()) {
		if (await shouldSkipBuild(target)) {
			console.log(`[build-whisper-runtime] Whisper runtime ${whisperVersion} already staged for ${target.archTag}.`);
			continue;
		}

		await mkdir(target.buildRoot, { recursive: true });

		console.log(`[build-whisper-runtime] Configuring whisper.cpp ${whisperVersion} for ${target.archTag}...`);
		try {
			execFileSync(cmake, getConfigureArgs(sourceDir, target), {
				stdio: "inherit",
				timeout: 300000,
			});
		} catch (error) {
			if (target.platform === "win32" && target.arch !== "arm64") {
				console.log("[build-whisper-runtime] VS 2022 generator unavailable, retrying with VS 2019...");
				execFileSync(cmake, [
					"-S", sourceDir,
					"-B", target.buildRoot,
					"-G", "Visual Studio 16 2019",
					"-A", "x64",
					"-DWHISPER_BUILD_TESTS=OFF",
					"-DWHISPER_BUILD_SERVER=OFF",
					"-DBUILD_SHARED_LIBS=ON",
				], { stdio: "inherit", timeout: 300000 });
			} else {
				throw error;
			}
		}

		console.log(`[build-whisper-runtime] Building bundled whisper runtime for ${target.archTag}...`);
		execFileSync(cmake, getBuildArgs(target), { stdio: "inherit", timeout: 900000 });

		const { candidateDir, runtimeEntries } = await findRuntimeArtifacts(target);
		await stageRuntimeArtifacts(target, candidateDir, runtimeEntries);
		console.log(`[build-whisper-runtime] Staged whisper runtime -> ${target.outputDir}`);
	}
}

await main();

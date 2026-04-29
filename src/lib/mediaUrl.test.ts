import { describe, expect, it } from "vitest";
import { fromFileUrl, isFileUrl, toFileUrl } from "./mediaUrl";

describe("mediaUrl", () => {
	describe("toFileUrl", () => {
		it("emits a `localhost` host for unix absolute paths", () => {
			// Critical: without `localhost`, Chromium's URL parser eats the first
			// path segment as the host and lowercases it (because `klipt-media`
			// is a "standard" scheme). See electron/main.ts protocol handler.
			expect(toFileUrl("/Users/music/song.mp3")).toBe(
				"klipt-media://localhost/Users/music/song.mp3",
			);
		});

		it("emits a `localhost` host for windows drive paths", () => {
			expect(toFileUrl("C:/Users/music/song.mp3")).toBe(
				"klipt-media://localhost/C:/Users/music/song.mp3",
			);
		});

		it("normalizes backslashes to forward slashes", () => {
			expect(toFileUrl("C:\\Users\\music\\song.mp3")).toBe(
				"klipt-media://localhost/C:/Users/music/song.mp3",
			);
		});

		it("preserves UNC paths with the server as host", () => {
			// UNC paths (//server/share/...) keep the server as the URL host
			// because that's the natural mapping.
			expect(toFileUrl("//server/share/file.mp4")).toBe(
				"klipt-media://server/share/file.mp4",
			);
		});

		it("encodes spaces in path segments", () => {
			expect(toFileUrl("/Users/my music/song.mp3")).toBe(
				"klipt-media://localhost/Users/my%20music/song.mp3",
			);
		});

		it("encodes unicode characters", () => {
			const url = toFileUrl("/Users/Müsic/Æ.mp3");
			expect(url).toBe("klipt-media://localhost/Users/M%C3%BCsic/%C3%86.mp3");
		});

		it("is idempotent: passes klipt-media URLs through unchanged", () => {
			const url = "klipt-media://localhost/Users/foo.mp4";
			expect(toFileUrl(url)).toBe(url);
		});

		it("is idempotent: passes file:// URLs through unchanged", () => {
			const url = "file:///Users/foo.mp4";
			expect(toFileUrl(url)).toBe(url);
		});

		it("makes relative paths absolute", () => {
			expect(toFileUrl("relative/path.mp3")).toBe(
				"klipt-media://localhost/relative/path.mp3",
			);
		});
	});

	describe("URLs survive Chromium's WHATWG parser", () => {
		// `klipt-media` is registered as a `standard: true` scheme in main.ts,
		// which makes Chromium parse it like http(s). Special schemes don't
		// allow empty hosts, so URLs without a host get reinterpreted.
		// `new URL` in the same Node version behaves the same way for special
		// schemes, so we can verify here.

		it("URL parser sees `localhost` as the host (not the first path segment)", () => {
			const u = new URL(toFileUrl("/Users/usmanasim/foo.mp4"));
			expect(u.host).toBe("localhost");
			expect(u.pathname).toBe("/Users/usmanasim/foo.mp4");
		});

		it("URL parser preserves case in pathname", () => {
			// Hosts are lowercased; pathnames are not. Embedding `localhost` as
			// the host means the case-preserving filesystem path stays in the
			// pathname slot.
			const u = new URL(toFileUrl("/Users/UPPER/MiXeD.mp4"));
			expect(u.pathname).toBe("/Users/UPPER/MiXeD.mp4");
		});

		it("emitted URLs round-trip identically through `new URL`", () => {
			// This is a property the empty-host form does NOT have in Chromium
			// (which is the actual bug toFileUrl works around). Node's URL
			// parser is more permissive about non-special schemes, so we can't
			// reproduce the Chromium-specific bug in vitest, but we CAN verify
			// that the URLs we emit don't lose information when parsed.
			const inputs = [
				"/Users/usmanasim/foo.mp4",
				"/Users/UPPER/MiXeD.mp4",
				"/path with spaces/file.txt",
				"/Müsic/Æ.mp3",
			];
			for (const filePath of inputs) {
				const url = toFileUrl(filePath);
				const reserialized = new URL(url).href;
				expect(reserialized).toBe(url);
			}
		});
	});

	describe("isFileUrl", () => {
		it("matches klipt-media URLs", () => {
			expect(isFileUrl("klipt-media://localhost/foo")).toBe(true);
		});

		it("matches file URLs", () => {
			expect(isFileUrl("file:///foo")).toBe(true);
		});

		it("rejects http/https/blob/data URLs", () => {
			expect(isFileUrl("https://example.com/foo")).toBe(false);
			expect(isFileUrl("blob:abc-123")).toBe(false);
			expect(isFileUrl("data:image/png;base64,xxx")).toBe(false);
		});

		it("rejects raw filesystem paths", () => {
			expect(isFileUrl("/Users/foo")).toBe(false);
			expect(isFileUrl("C:/Users/foo")).toBe(false);
		});
	});

	describe("fromFileUrl", () => {
		it("recovers the original path from a localhost URL", () => {
			expect(fromFileUrl("klipt-media://localhost/Users/foo.mp4")).toBe(
				"/Users/foo.mp4",
			);
		});

		it("decodes percent-encoded segments", () => {
			expect(fromFileUrl("klipt-media://localhost/Users/my%20music/song.mp3")).toBe(
				"/Users/my music/song.mp3",
			);
		});

		it("handles windows drive paths in the URL", () => {
			expect(fromFileUrl("klipt-media://localhost/C:/Users/foo.mp4")).toBe(
				"C:/Users/foo.mp4",
			);
		});

		it("recovers from legacy URLs where Chromium ate a path segment", () => {
			// Pre-fix, toFileUrl emitted `klipt-media:///Users/foo.mp4`. Chromium
			// reinterpreted as `klipt-media://users/foo.mp4`. The new fromFileUrl
			// reattaches the host as a leading path segment (works on
			// case-insensitive APFS, harmless elsewhere).
			expect(fromFileUrl("klipt-media://users/foo.mp4")).toBe("/users/foo.mp4");
		});

		it("passes non-URL strings through unchanged", () => {
			expect(fromFileUrl("/Users/foo")).toBe("/Users/foo");
			expect(fromFileUrl("https://example.com/foo")).toBe("https://example.com/foo");
		});

		it("round-trips simple unix paths", () => {
			const paths = [
				"/Users/music/song.mp3",
				"/tmp/audio.wav",
				"/home/user/my-file.aac",
				"/data/recordings/track_01.flac",
			];
			for (const original of paths) {
				expect(fromFileUrl(toFileUrl(original))).toBe(original);
			}
		});

		it("round-trips paths with spaces and unicode", () => {
			const paths = [
				"/Users/my user/my music/song file.mp3",
				"/tmp/Müsic/Æ.mp4",
				"/var/log/file with spaces.txt",
			];
			for (const original of paths) {
				expect(fromFileUrl(toFileUrl(original))).toBe(original);
			}
		});
	});
});

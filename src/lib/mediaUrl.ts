/**
 * URL helpers for the custom `klipt-media://` protocol used to load local files
 * into the renderer without disabling `webSecurity`. The protocol is registered
 * as a `standard` scheme in `electron/main.ts`, which makes Chromium parse it
 * like http(s).
 *
 * IMPORTANT: special schemes do not allow an empty host. Chromium silently
 * reinterprets `klipt-media:///Users/foo` as `klipt-media://Users/foo` (eats
 * the first path segment as the host AND lowercases it). To avoid this we
 * always emit a stable `localhost` host. The protocol handler in
 * `electron/main.ts` mirrors this and also reconstructs the original path from
 * `host + pathname` when the host isn't empty/localhost, so older URLs and
 * URLs from other call sites still resolve.
 *
 * Both renderer (browser) and main process (Node) import these helpers, so
 * keep this file dependency-free.
 */

const KLIPT_MEDIA_PREFIX_RE = /^(file|klipt-media):\/\//i;

function encodePathSegments(pathname: string, keepWindowsDrive = false): string {
	return pathname
		.split("/")
		.map((segment, index) => {
			if (!segment) return "";
			if (keepWindowsDrive && index === 1 && /^[a-zA-Z]:$/.test(segment)) {
				return segment;
			}
			return encodeURIComponent(segment);
		})
		.join("/");
}

/** True if `value` is a `file://` or `klipt-media://` URL. */
export function isFileUrl(value: string): boolean {
	return KLIPT_MEDIA_PREFIX_RE.test(value);
}

/**
 * Convert a local filesystem path to a `klipt-media://` URL the renderer can
 * load. Idempotent: passing in an already-formed `file://` or `klipt-media://`
 * URL returns it unchanged.
 */
export function toFileUrl(filePath: string): string {
	if (isFileUrl(filePath)) {
		return filePath;
	}

	const normalized = filePath.replace(/\\/g, "/");

	// Windows drive path: C:/Users/...
	if (/^[a-zA-Z]:\//.test(normalized)) {
		return `klipt-media://localhost${encodePathSegments(`/${normalized}`, true)}`;
	}

	// UNC path: //server/share/...
	if (normalized.startsWith("//")) {
		const [host, ...pathParts] = normalized.replace(/^\/+/, "").split("/");
		const encodedPath = pathParts.map((part) => encodeURIComponent(part)).join("/");
		return encodedPath ? `klipt-media://${host}/${encodedPath}` : `klipt-media://${host}/`;
	}

	const absolutePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
	return `klipt-media://localhost${encodePathSegments(absolutePath)}`;
}

/**
 * Convert a `file://` or `klipt-media://` URL back to a filesystem path. Any
 * other input is returned unchanged. Handles the legacy URL forms produced
 * before the `localhost` host was introduced (where Chromium ate the first
 * path segment) by treating any non-localhost host as a leading path segment
 * — APFS case-insensitivity makes this safe on macOS, and modern callers
 * always emit `localhost`.
 */
export function fromFileUrl(fileUrl: string): string {
	const value = fileUrl.trim();
	if (!isFileUrl(value)) {
		return fileUrl;
	}

	try {
		const url = new URL(value);
		const pathname = decodeURIComponent(url.pathname);
		const host = url.host;

		// UNC path: klipt-media://server/share/...  →  \\server\share\...
		if (host && host !== "localhost" && /^[a-zA-Z][a-zA-Z0-9-]+$/.test(host)) {
			// Heuristic: a host that looks like a hostname (not a path segment) is
			// treated as a UNC server when the resulting filesystem path doesn't
			// look like a Unix absolute path. This preserves Windows compatibility.
			const looksLikeUnixPath = pathname.startsWith("/") && !/^\/[A-Za-z]:/.test(pathname);
			if (!looksLikeUnixPath) {
				const uncPath = `//${host}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
				return uncPath.replace(/\//g, "\\");
			}
		}

		// Legacy URLs from before the `localhost` host was introduced: Chromium
		// ate the leading path segment. Re-attach it so the path resolves.
		if (host && host !== "localhost") {
			const sep = pathname.startsWith("/") ? "" : "/";
			return `/${host}${sep}${pathname}`;
		}

		// Windows drive path: pathname is `/C:/Users/...`  →  `C:/Users/...`
		if (/^\/[A-Za-z]:/.test(pathname)) {
			return pathname.slice(1);
		}

		return pathname;
	} catch {
		const rawFallbackPath = value.replace(KLIPT_MEDIA_PREFIX_RE, "");
		let fallbackPath = rawFallbackPath;
		try {
			fallbackPath = decodeURIComponent(rawFallbackPath);
		} catch {
			// Keep raw best-effort path if percent decoding fails.
		}
		return fallbackPath.replace(/^\/([a-zA-Z]:)/, "$1");
	}
}

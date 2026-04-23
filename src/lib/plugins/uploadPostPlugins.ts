// Social publishing plugins via the Upload-Post API (https://upload-post.com).
// One API key unlocks TikTok, Instagram Reels, and YouTube Shorts uploads.
//
// Each plugin here adapts the common UploadPlugin contract to Upload-Post's
// unified `/upload` endpoint, selecting the platform field appropriately.

import type { UploadPlugin } from "./pluginTypes";

export type UploadPostPlatform = "tiktok" | "instagram" | "youtube";

const UPLOAD_POST_ENDPOINT = "https://api.upload-post.com/api/upload";

interface UploadPostResponse {
	success?: boolean;
	status?: string;
	error?: string;
	message?: string;
	/** Platform-specific results; shapes vary so we read permissively. */
	results?: Record<string, { url?: string; permalink?: string; id?: string }>;
}

async function uploadViaUploadPost(
	platform: UploadPostPlatform,
	filePath: string,
	config: Record<string, string>,
	onProgress?: (percent: number) => void,
): Promise<{ url: string }> {
	const apiKey = config.apiKey?.trim();
	if (!apiKey) throw new Error("Upload-Post API key is required");

	const user = config.user?.trim() || "default";

	// Read file bytes via the existing electron bridge.
	const fileRes = await window.electronAPI.readLocalFile(filePath);
	if (!fileRes?.success || !fileRes.data) {
		throw new Error(`Could not read file for upload: ${filePath}`);
	}
	// Copy into a fresh ArrayBuffer — Node Buffers serialized through Electron
	// IPC can be backed by SharedArrayBuffer which isn't a valid BlobPart.
	const source = fileRes.data instanceof Uint8Array ? fileRes.data : new Uint8Array(fileRes.data);
	const buffer = new ArrayBuffer(source.byteLength);
	new Uint8Array(buffer).set(source);

	// Pull filename from path for multipart.
	const fileName = filePath.split(/[/\\]/).pop() ?? "klipt-upload.mp4";
	const mime = fileName.toLowerCase().endsWith(".gif") ? "image/gif" : "video/mp4";

	const form = new FormData();
	form.append("user", user);
	form.append("platform[]", platform);
	if (config.title) form.append("title", config.title);
	if (config.description) form.append("description", config.description);
	if (config.hashtags) form.append("hashtags", config.hashtags);
	// TikTok / Reels specific privacy flag, safe to include for all.
	if (config.privacy) form.append("privacy", config.privacy);
	form.append("video", new Blob([buffer], { type: mime }), fileName);

	onProgress?.(5);

	const res = await fetch(UPLOAD_POST_ENDPOINT, {
		method: "POST",
		headers: { Authorization: `Apikey ${apiKey}` },
		body: form,
	});

	onProgress?.(90);

	if (!res.ok) {
		const body = await res.text().catch(() => res.statusText);
		throw new Error(`Upload-Post (${platform}) failed: ${res.status} ${body.slice(0, 400)}`);
	}

	const data = (await res.json().catch(() => ({}))) as UploadPostResponse;
	if (data.error) throw new Error(data.error);

	const platformResult = data.results?.[platform] ?? data.results?.[String(platform)];
	const url = platformResult?.url ?? platformResult?.permalink ?? data.message ?? "";

	onProgress?.(100);
	return { url };
}

async function testUploadPost(
	config: Record<string, string>,
): Promise<{ success: boolean; error?: string }> {
	const apiKey = config.apiKey?.trim();
	if (!apiKey) return { success: false, error: "API key missing" };

	try {
		// Upload-Post exposes a /users listing that accepts the same auth header.
		const res = await fetch("https://api.upload-post.com/api/uploadposts/users", {
			headers: { Authorization: `Apikey ${apiKey}` },
		});
		if (!res.ok) {
			return { success: false, error: `Upload-Post returned ${res.status}` };
		}
		return { success: true };
	} catch (err) {
		return { success: false, error: err instanceof Error ? err.message : String(err) };
	}
}

const commonSchema = {
	apiKey: {
		type: "password" as const,
		label: "Upload-Post API Key",
		placeholder: "up_live_...",
		required: true,
	},
	user: {
		type: "text" as const,
		label: "Upload-Post User Profile",
		placeholder: "default",
		defaultValue: "default",
	},
	title: { type: "text" as const, label: "Title / Caption" },
	description: { type: "text" as const, label: "Description" },
	hashtags: { type: "text" as const, label: "Hashtags (comma-separated)" },
	privacy: {
		type: "select" as const,
		label: "Privacy",
		options: [
			{ value: "PUBLIC_TO_EVERYONE", label: "Public" },
			{ value: "MUTUAL_FOLLOW_FRIENDS", label: "Friends only" },
			{ value: "SELF_ONLY", label: "Private" },
		],
		defaultValue: "PUBLIC_TO_EVERYONE",
	},
};

export const tiktokPlugin: UploadPlugin = {
	id: "upload-post-tiktok",
	name: "TikTok (via Upload-Post)",
	icon: "Music2",
	description: "Publish a vertical short directly to TikTok using your Upload-Post account.",
	configSchema: commonSchema,
	upload: (filePath, config, onProgress) =>
		uploadViaUploadPost("tiktok", filePath, config, onProgress),
	testConnection: testUploadPost,
};

export const instagramReelsPlugin: UploadPlugin = {
	id: "upload-post-instagram",
	name: "Instagram Reels (via Upload-Post)",
	icon: "Instagram",
	description: "Publish a vertical reel to Instagram using your Upload-Post account.",
	configSchema: commonSchema,
	upload: (filePath, config, onProgress) =>
		uploadViaUploadPost("instagram", filePath, config, onProgress),
	testConnection: testUploadPost,
};

export const youtubeShortsPlugin: UploadPlugin = {
	id: "upload-post-youtube",
	name: "YouTube Shorts (via Upload-Post)",
	icon: "Youtube",
	description: "Publish a vertical short to YouTube using your Upload-Post account.",
	configSchema: commonSchema,
	upload: (filePath, config, onProgress) =>
		uploadViaUploadPost("youtube", filePath, config, onProgress),
	testConnection: testUploadPost,
};

export const UPLOAD_POST_PLUGINS: UploadPlugin[] = [
	tiktokPlugin,
	instagramReelsPlugin,
	youtubeShortsPlugin,
];

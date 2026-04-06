import type { UploadPlugin } from "./pluginTypes";

// ── S3 Plugin ───────────────────────────────────────────────────────────────

export const s3Plugin: UploadPlugin = {
	id: "s3",
	name: "Amazon S3 / Compatible",
	icon: "Cloud",
	description: "Upload to S3, Cloudflare R2, MinIO, or any S3-compatible storage",
	configSchema: {
		endpoint: { type: "text", label: "Endpoint URL", placeholder: "https://s3.amazonaws.com", required: true },
		bucket: { type: "text", label: "Bucket", placeholder: "my-bucket", required: true },
		accessKeyId: { type: "text", label: "Access Key ID", required: true },
		secretAccessKey: { type: "password", label: "Secret Access Key", required: true },
		region: { type: "text", label: "Region", placeholder: "us-east-1", defaultValue: "us-east-1" },
		pathStyle: {
			type: "select",
			label: "Path Style",
			options: [
				{ value: "false", label: "Virtual-hosted (AWS default)" },
				{ value: "true", label: "Path-style (MinIO, R2)" },
			],
			defaultValue: "false",
		},
	},
	async upload(filePath, config, onProgress) {
		const result = await window.electronAPI.uploadToS3(
			filePath,
			{
				endpoint: config.endpoint,
				bucket: config.bucket,
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
				region: config.region || "us-east-1",
				pathStyle: config.pathStyle === "true",
			},
		);
		onProgress?.(100);
		if (!result.success || !result.url) throw new Error(result.error || "Upload failed");
		return { url: result.url };
	},
	async testConnection(config) {
		const result = await window.electronAPI.testS3Connection({
			endpoint: config.endpoint,
			bucket: config.bucket,
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			region: config.region || "us-east-1",
			pathStyle: config.pathStyle === "true",
		});
		return { success: result.success, error: result.error };
	},
};

// ── Custom HTTP Plugin ──────────────────────────────────────────────────────

export const httpPlugin: UploadPlugin = {
	id: "http",
	name: "Custom HTTP Endpoint",
	icon: "Globe",
	description: "Upload via HTTP POST/PUT to any URL",
	configSchema: {
		url: { type: "text", label: "Upload URL", placeholder: "https://api.example.com/upload", required: true },
		method: {
			type: "select",
			label: "Method",
			options: [
				{ value: "POST", label: "POST" },
				{ value: "PUT", label: "PUT" },
			],
			defaultValue: "POST",
		},
		authHeader: { type: "text", label: "Auth Header Name", placeholder: "Authorization" },
		authValue: { type: "password", label: "Auth Header Value", placeholder: "Bearer token..." },
		responseUrlField: { type: "text", label: "Response URL field", placeholder: "url", defaultValue: "url" },
	},
	async upload(_filePath, _config, onProgress) {
		// HTTP upload would be handled by IPC in production
		onProgress?.(100);
		throw new Error("HTTP upload requires IPC handler — configure via Electron main process");
	},
};

// ── Local Copy Plugin ───────────────────────────────────────────────────────

export const localCopyPlugin: UploadPlugin = {
	id: "local",
	name: "Local / Network Directory",
	icon: "FolderOutput",
	description: "Copy the file to a local or network-mounted directory",
	configSchema: {
		destinationDir: { type: "text", label: "Destination Directory", placeholder: "/path/to/shared/folder", required: true },
	},
	async upload(_filePath, _config, onProgress) {
		// Local copy would be handled by IPC
		onProgress?.(100);
		throw new Error("Local copy requires IPC handler — configure via Electron main process");
	},
};

// ── Register All Built-in Plugins ───────────────────────────────────────────

export const BUILTIN_PLUGINS: UploadPlugin[] = [s3Plugin, httpPlugin, localCopyPlugin];

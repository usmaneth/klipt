import { describe, expect, it } from "vitest";
import { BUILTIN_PLUGINS } from "./builtinPlugins";
import { pluginManager } from "./pluginManager";
import {
	instagramReelsPlugin,
	tiktokPlugin,
	UPLOAD_POST_PLUGINS,
	youtubeShortsPlugin,
} from "./uploadPostPlugins";

describe("uploadPostPlugins", () => {
	it("exposes three platform plugins", () => {
		expect(UPLOAD_POST_PLUGINS).toHaveLength(3);
		expect(UPLOAD_POST_PLUGINS).toContain(tiktokPlugin);
		expect(UPLOAD_POST_PLUGINS).toContain(instagramReelsPlugin);
		expect(UPLOAD_POST_PLUGINS).toContain(youtubeShortsPlugin);
	});

	it("all plugins declare an apiKey + user config field", () => {
		for (const plugin of UPLOAD_POST_PLUGINS) {
			expect(plugin.configSchema.apiKey?.required).toBe(true);
			expect(plugin.configSchema.apiKey?.type).toBe("password");
			expect(plugin.configSchema.user).toBeDefined();
		}
	});

	it("plugin ids are unique and stable", () => {
		const ids = UPLOAD_POST_PLUGINS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual(["upload-post-tiktok", "upload-post-instagram", "upload-post-youtube"]);
	});

	it("are included in BUILTIN_PLUGINS so the UI registers them", () => {
		for (const plugin of UPLOAD_POST_PLUGINS) {
			expect(BUILTIN_PLUGINS).toContain(plugin);
		}
	});

	it("upload() rejects with a clear error when the API key is missing", async () => {
		const noop = () => undefined;
		await expect(tiktokPlugin.upload("/tmp/test.mp4", {}, noop)).rejects.toThrow(
			/API key is required/i,
		);
	});

	it("pluginManager can register each Upload-Post plugin once", () => {
		pluginManager.registerPlugin(tiktokPlugin);
		pluginManager.registerPlugin(instagramReelsPlugin);
		pluginManager.registerPlugin(youtubeShortsPlugin);
		expect(pluginManager.getPlugin("upload-post-tiktok")).toBe(tiktokPlugin);
		expect(pluginManager.getPlugin("upload-post-instagram")).toBe(instagramReelsPlugin);
		expect(pluginManager.getPlugin("upload-post-youtube")).toBe(youtubeShortsPlugin);
	});
});

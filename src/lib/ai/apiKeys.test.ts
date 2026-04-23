import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("apiKeys", () => {
	let store: Record<string, string> = {};

	beforeEach(() => {
		store = {};
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => (k in store ? store[k] : null),
			setItem: (k: string, v: string) => {
				store[k] = v;
			},
			removeItem: (k: string) => {
				delete store[k];
			},
			clear: () => {
				store = {};
			},
			key: (i: number) => Object.keys(store)[i] ?? null,
			length: 0,
		} as unknown as Storage);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.resetModules();
	});

	it("returns undefined when no key is configured and no env override exists", async () => {
		const { getApiKey, hasApiKey } = await import("./apiKeys");
		expect(getApiKey("gemini")).toBeUndefined();
		expect(hasApiKey("gemini")).toBe(false);
	});

	it("stores, retrieves, and clears keys", async () => {
		const { getApiKey, setApiKey, hasApiKey } = await import("./apiKeys");
		setApiKey("gemini", "  my-key  ");
		// Trims whitespace on read.
		expect(getApiKey("gemini")).toBe("my-key");
		expect(hasApiKey("gemini")).toBe(true);

		setApiKey("gemini", "");
		expect(getApiKey("gemini")).toBeUndefined();
		expect(hasApiKey("gemini")).toBe(false);

		setApiKey("gemini", "v2");
		setApiKey("gemini", undefined);
		expect(getApiKey("gemini")).toBeUndefined();
	});

	it("keeps different providers independent", async () => {
		const { getApiKey, setApiKey } = await import("./apiKeys");
		setApiKey("gemini", "g");
		setApiKey("elevenlabs", "e");
		setApiKey("deepl", "d");
		setApiKey("uploadPost", "u");
		expect(getApiKey("gemini")).toBe("g");
		expect(getApiKey("elevenlabs")).toBe("e");
		expect(getApiKey("deepl")).toBe("d");
		expect(getApiKey("uploadPost")).toBe("u");
	});

	it("returns empty map when no keys set and getAllApiKeys", async () => {
		const { getAllApiKeys, setApiKey } = await import("./apiKeys");
		expect(getAllApiKeys()).toEqual({});
		setApiKey("gemini", "g");
		setApiKey("deepl", "d");
		expect(getAllApiKeys()).toEqual({ gemini: "g", deepl: "d" });
	});

	it("tolerates corrupted localStorage entries", async () => {
		store["klipt-api-keys"] = "not-json";
		const { getAllApiKeys, getApiKey } = await import("./apiKeys");
		expect(getAllApiKeys()).toEqual({});
		expect(getApiKey("gemini")).toBeUndefined();
	});
});

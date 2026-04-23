import { describe, expect, it } from "vitest";
import { parseJsonReply } from "./geminiClient";

describe("parseJsonReply", () => {
	it("parses a clean JSON object", () => {
		expect(parseJsonReply<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
	});

	it("parses an object wrapped in ```json fences", () => {
		const raw = '```json\n{"title":"hi","n":2}\n```';
		expect(parseJsonReply<{ title: string; n: number }>(raw)).toEqual({ title: "hi", n: 2 });
	});

	it("parses an object wrapped in bare ``` fences", () => {
		const raw = '```\n{"ok":true}\n```';
		expect(parseJsonReply<{ ok: boolean }>(raw)).toEqual({ ok: true });
	});

	it("strips leading prose before JSON", () => {
		const raw = 'Here is your answer: {"score":42}';
		expect(parseJsonReply<{ score: number }>(raw)).toEqual({ score: 42 });
	});

	it("parses top-level arrays", () => {
		const raw = "```json\n[1,2,3]\n```";
		expect(parseJsonReply<number[]>(raw)).toEqual([1, 2, 3]);
	});

	it("throws on invalid JSON", () => {
		expect(() => parseJsonReply("not json")).toThrow();
	});
});

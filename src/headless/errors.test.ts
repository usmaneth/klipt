import { describe, expect, it } from "vitest";
import { describeExportError } from "./errors";

describe("describeExportError", () => {
	it("says that the input file is not a video when the demuxer cannot read it", () => {
		expect(describeExportError("get_media_info failed: undefined")).toBe(
			"the input is not a readable video file (get_media_info failed: undefined)",
		);
	});

	it("says that the host cannot encode when no H.264 profile works", () => {
		expect(
			describeExportError("Video encoding not supported on this system. Tried codecs: avc1.640033"),
		).toBe("this host cannot encode H.264 at the output size");
	});

	it("keeps any other message as it is", () => {
		expect(describeExportError("Export cancelled")).toBe("Export cancelled");
	});
});

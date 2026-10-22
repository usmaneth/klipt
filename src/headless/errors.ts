/** Turn an error of the exporter into a reason that a person can act on. */
export function describeExportError(message: string): string {
	if (/get_media_info failed|failed to load video resource|demux/i.test(message)) {
		return `the input is not a readable video file (${message})`;
	}
	if (/Video encoding not supported/i.test(message)) {
		return "this host cannot encode H.264 at the output size";
	}
	return message;
}

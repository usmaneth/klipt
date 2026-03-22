/**
 * Generate normalized amplitude values for waveform visualization.
 *
 * Samples the audio buffer at regular intervals and computes the RMS
 * for each segment. Returns an array of values in the range [0, 1].
 */
export function generateWaveform(audioBuffer: AudioBuffer, numBars: number): number[] {
	const channelData = audioBuffer.getChannelData(0);
	const samplesPerBar = Math.floor(channelData.length / numBars);

	if (samplesPerBar === 0) {
		return new Array(numBars).fill(0);
	}

	const bars: number[] = [];
	let maxRms = 0;

	for (let i = 0; i < numBars; i++) {
		const start = i * samplesPerBar;
		const end = Math.min(start + samplesPerBar, channelData.length);

		let sumSquares = 0;
		for (let j = start; j < end; j++) {
			sumSquares += channelData[j] * channelData[j];
		}
		const rms = Math.sqrt(sumSquares / (end - start));
		bars.push(rms);

		if (rms > maxRms) {
			maxRms = rms;
		}
	}

	// Normalize to [0, 1]
	if (maxRms === 0) {
		return bars;
	}

	return bars.map((rms) => rms / maxRms);
}

import AVFoundation
import Accelerate
import Foundation

// MARK: - WAV helpers

struct WAVHeader {
    var chunkID: (UInt8, UInt8, UInt8, UInt8) = (0x52, 0x49, 0x46, 0x46) // RIFF
    var chunkSize: UInt32 = 0
    var format: (UInt8, UInt8, UInt8, UInt8) = (0x57, 0x41, 0x56, 0x45) // WAVE
    var subchunk1ID: (UInt8, UInt8, UInt8, UInt8) = (0x66, 0x6D, 0x74, 0x20) // fmt
    var subchunk1Size: UInt32 = 16
    var audioFormat: UInt16 = 1 // PCM
    var numChannels: UInt16 = 1
    var sampleRate: UInt32 = 48000
    var byteRate: UInt32 = 96000
    var blockAlign: UInt16 = 2
    var bitsPerSample: UInt16 = 16
    var subchunk2ID: (UInt8, UInt8, UInt8, UInt8) = (0x64, 0x61, 0x74, 0x61) // data
    var subchunk2Size: UInt32 = 0
}

func readWAVFile(path: String) -> (samples: [Float], sampleRate: Double, channels: Int)? {
    guard let file = try? AVAudioFile(forReading: URL(fileURLWithPath: path)) else {
        fputs("Error: Cannot open input file: \(path)\n", stderr)
        return nil
    }

    let format = file.processingFormat
    let frameCount = AVAudioFrameCount(file.length)

    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frameCount) else {
        fputs("Error: Cannot allocate audio buffer\n", stderr)
        return nil
    }

    do {
        try file.read(into: buffer)
    } catch {
        fputs("Error: Cannot read audio file: \(error)\n", stderr)
        return nil
    }

    let channelCount = Int(format.channelCount)
    let sampleRate = format.sampleRate
    let length = Int(buffer.frameLength)

    // Mix down to mono
    var mono = [Float](repeating: 0, count: length)
    for ch in 0..<channelCount {
        guard let channelData = buffer.floatChannelData?[ch] else { continue }
        for i in 0..<length {
            mono[i] += channelData[i]
        }
    }
    if channelCount > 1 {
        var divisor = Float(channelCount)
        vDSP_vsdiv(mono, 1, &divisor, &mono, 1, vDSP_Length(length))
    }

    return (samples: mono, sampleRate: sampleRate, channels: channelCount)
}

func resampleTo48kHz(samples: [Float], fromRate: Double) -> [Float] {
    let targetRate: Double = 48000
    if abs(fromRate - targetRate) < 1.0 {
        return samples
    }

    let ratio = targetRate / fromRate
    let outputLength = Int(Double(samples.count) * ratio)
    var output = [Float](repeating: 0, count: outputLength)

    // Linear interpolation resampling
    for i in 0..<outputLength {
        let srcIndex = Double(i) / ratio
        let srcFloor = Int(srcIndex)
        let frac = Float(srcIndex - Double(srcFloor))

        let s0 = srcFloor < samples.count ? samples[srcFloor] : 0
        let s1 = (srcFloor + 1) < samples.count ? samples[srcFloor + 1] : s0
        output[i] = s0 + frac * (s1 - s0)
    }

    return output
}

func writeWAV(samples: [Float], sampleRate: UInt32, to path: String) -> Bool {
    let numSamples = samples.count
    let dataSize = UInt32(numSamples * 2) // 16-bit

    var header = WAVHeader()
    header.sampleRate = sampleRate
    header.byteRate = sampleRate * 2
    header.chunkSize = 36 + dataSize
    header.subchunk2Size = dataSize

    var data = Data()

    // Write header manually (avoid padding issues)
    withUnsafeBytes(of: header.chunkID) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.chunkSize.littleEndian) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.format) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.subchunk1ID) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.subchunk1Size.littleEndian) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.audioFormat.littleEndian) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.numChannels.littleEndian) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.sampleRate.littleEndian) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.byteRate.littleEndian) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.blockAlign.littleEndian) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.bitsPerSample.littleEndian) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.subchunk2ID) { data.append(contentsOf: $0) }
    withUnsafeBytes(of: header.subchunk2Size.littleEndian) { data.append(contentsOf: $0) }

    // Convert float samples to Int16
    for sample in samples {
        let clamped = max(-1.0, min(1.0, sample))
        let int16Val = Int16(clamped * 32767.0)
        withUnsafeBytes(of: int16Val.littleEndian) { data.append(contentsOf: $0) }
    }

    do {
        try data.write(to: URL(fileURLWithPath: path))
        return true
    } catch {
        fputs("Error: Cannot write output file: \(error)\n", stderr)
        return false
    }
}

// MARK: - Denoise mode

/// Simple noise gate + spectral subtraction using vDSP.
/// This is a lightweight denoiser that:
/// 1. Estimates noise floor from the first 0.5s of audio
/// 2. Applies spectral subtraction to reduce stationary noise
/// 3. Applies a smooth noise gate to suppress residual noise
func denoiseAudio(samples: [Float], sampleRate: Double) -> [Float] {
    let count = samples.count
    guard count > 0 else { return samples }

    // --- Parameters ---
    let frameSize = 2048
    let hopSize = frameSize / 2
    let noiseEstFrames = Int(0.5 * sampleRate / Double(hopSize)) // first 0.5s for noise estimation
    let gateThresholdDB: Float = -40.0
    let gateAttackSamples = Int(0.005 * sampleRate) // 5ms attack
    let gateReleaseSamples = Int(0.050 * sampleRate) // 50ms release
    let spectralFloor: Float = 0.02

    // --- FFT setup ---
    let log2n = vDSP_Length(log2(Float(frameSize)))
    guard let fftSetup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2)) else {
        fputs("Warning: FFT setup failed, returning original audio\n", stderr)
        return samples
    }
    defer { vDSP_destroy_fftsetup(fftSetup) }

    let halfN = frameSize / 2

    // --- Hann window ---
    var window = [Float](repeating: 0, count: frameSize)
    vDSP_hann_window(&window, vDSP_Length(frameSize), Int32(vDSP_HANN_NORM))

    // --- Estimate noise spectrum from first 0.5s ---
    var noiseSpectrum = [Float](repeating: 0, count: halfN)
    var noiseFrameCount: Float = 0

    var realPart = [Float](repeating: 0, count: halfN)
    var imagPart = [Float](repeating: 0, count: halfN)

    for frameIdx in 0..<noiseEstFrames {
        let start = frameIdx * hopSize
        if start + frameSize > count { break }

        // Window the frame
        var windowed = [Float](repeating: 0, count: frameSize)
        vDSP_vmul(Array(samples[start..<start+frameSize]), 1, window, 1, &windowed, 1, vDSP_Length(frameSize))

        // Forward FFT
        windowed.withUnsafeMutableBufferPointer { ptr in
            var splitComplex = DSPSplitComplex(realp: &realPart, imagp: &imagPart)
            ptr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                vDSP_ctoz(complexPtr, 2, &splitComplex, 1, vDSP_Length(halfN))
            }
            vDSP_fft_zrip(fftSetup, &splitComplex, 1, log2n, FFTDirection(FFT_FORWARD))
        }

        // Accumulate magnitude spectrum
        var magnitude = [Float](repeating: 0, count: halfN)
        var splitComplex = DSPSplitComplex(realp: &realPart, imagp: &imagPart)
        vDSP_zvmags(&splitComplex, 1, &magnitude, 1, vDSP_Length(halfN))

        vDSP_vadd(noiseSpectrum, 1, magnitude, 1, &noiseSpectrum, 1, vDSP_Length(halfN))
        noiseFrameCount += 1
    }

    // Average the noise spectrum
    if noiseFrameCount > 0 {
        vDSP_vsdiv(noiseSpectrum, 1, &noiseFrameCount, &noiseSpectrum, 1, vDSP_Length(halfN))
    }

    // Apply oversubtraction factor
    var oversubFactor: Float = 2.0
    vDSP_vsmul(noiseSpectrum, 1, &oversubFactor, &noiseSpectrum, 1, vDSP_Length(halfN))

    // --- Process all frames with spectral subtraction ---
    var output = [Float](repeating: 0, count: count)
    var normalization = [Float](repeating: 0, count: count)

    let totalFrames = (count - frameSize) / hopSize + 1

    for frameIdx in 0..<totalFrames {
        let start = frameIdx * hopSize

        // Window the frame
        var windowed = [Float](repeating: 0, count: frameSize)
        vDSP_vmul(Array(samples[start..<start+frameSize]), 1, window, 1, &windowed, 1, vDSP_Length(frameSize))

        // Forward FFT
        realPart = [Float](repeating: 0, count: halfN)
        imagPart = [Float](repeating: 0, count: halfN)

        windowed.withUnsafeMutableBufferPointer { ptr in
            var splitComplex = DSPSplitComplex(realp: &realPart, imagp: &imagPart)
            ptr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                vDSP_ctoz(complexPtr, 2, &splitComplex, 1, vDSP_Length(halfN))
            }
            vDSP_fft_zrip(fftSetup, &splitComplex, 1, log2n, FFTDirection(FFT_FORWARD))
        }

        // Compute magnitude
        var splitComplex = DSPSplitComplex(realp: &realPart, imagp: &imagPart)
        var magnitude = [Float](repeating: 0, count: halfN)
        vDSP_zvmags(&splitComplex, 1, &magnitude, 1, vDSP_Length(halfN))

        // Spectral subtraction: subtract noise, floor at spectralFloor
        for i in 0..<halfN {
            let origMag = magnitude[i]
            var newMag = origMag - noiseSpectrum[i]
            if newMag < spectralFloor * origMag {
                newMag = spectralFloor * origMag
            }
            if origMag > 0 {
                let gain = sqrt(newMag / origMag)
                realPart[i] *= gain
                imagPart[i] *= gain
            }
        }

        // Inverse FFT
        var inverseSplit = DSPSplitComplex(realp: &realPart, imagp: &imagPart)
        vDSP_fft_zrip(fftSetup, &inverseSplit, 1, log2n, FFTDirection(FFT_INVERSE))

        var reconstructed = [Float](repeating: 0, count: frameSize)
        reconstructed.withUnsafeMutableBufferPointer { ptr in
            var split = DSPSplitComplex(realp: &realPart, imagp: &imagPart)
            ptr.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: halfN) { complexPtr in
                vDSP_ztoc(&split, 1, complexPtr, 2, vDSP_Length(halfN))
            }
        }

        // Scale by 1/(2*N) for FFT normalization
        var scale = 1.0 / Float(2 * frameSize)
        vDSP_vsmul(reconstructed, 1, &scale, &reconstructed, 1, vDSP_Length(frameSize))

        // Apply window again for overlap-add
        vDSP_vmul(reconstructed, 1, window, 1, &reconstructed, 1, vDSP_Length(frameSize))

        // Overlap-add
        for i in 0..<frameSize {
            let idx = start + i
            if idx < count {
                output[idx] += reconstructed[i]
                normalization[idx] += window[i] * window[i]
            }
        }
    }

    // Normalize overlap-add
    for i in 0..<count {
        if normalization[i] > 1e-8 {
            output[i] /= normalization[i]
        }
    }

    // --- Apply smooth noise gate ---
    let gateLinear = powf(10.0, gateThresholdDB / 20.0)
    let rmsWindowSize = Int(0.02 * sampleRate) // 20ms RMS window
    var gateGain: Float = 1.0

    for i in 0..<count {
        // Compute local RMS
        let rmsStart = max(0, i - rmsWindowSize / 2)
        let rmsEnd = min(count, i + rmsWindowSize / 2)
        let rmsLen = rmsEnd - rmsStart
        var sumSq: Float = 0
        vDSP_svesq(Array(output[rmsStart..<rmsEnd]), 1, &sumSq, vDSP_Length(rmsLen))
        let rms = sqrtf(sumSq / Float(rmsLen))

        let targetGain: Float = rms > gateLinear ? 1.0 : (rms / max(gateLinear, 1e-10))
        let smoothing: Float = targetGain > gateGain
            ? 1.0 / Float(max(gateAttackSamples, 1))
            : 1.0 / Float(max(gateReleaseSamples, 1))
        gateGain += smoothing * (targetGain - gateGain)
        output[i] *= gateGain
    }

    return output
}

func runDenoise(inputPath: String, outputPath: String) -> Int32 {
    guard let audio = readWAVFile(path: inputPath) else {
        return 1
    }

    // Resample to 48kHz
    let samples48k = resampleTo48kHz(samples: audio.samples, fromRate: audio.sampleRate)

    // Denoise
    let denoised = denoiseAudio(samples: samples48k, sampleRate: 48000)

    // Write output
    if writeWAV(samples: denoised, sampleRate: 48000, to: outputPath) {
        let jsonResult: [String: Any] = [
            "success": true,
            "inputSamples": audio.samples.count,
            "outputSamples": denoised.count,
            "sampleRate": 48000
        ]
        if let jsonData = try? JSONSerialization.data(withJSONObject: jsonResult),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            print(jsonString)
        }
        return 0
    }
    return 1
}

// MARK: - Silence detection mode

struct SilenceRegion: Codable {
    let start: Double
    let end: Double
}

func detectSilence(inputPath: String, thresholdDB: Float, minDuration: Double) -> Int32 {
    guard let audio = readWAVFile(path: inputPath) else {
        return 1
    }

    let samples = audio.samples
    let sampleRate = audio.sampleRate
    let count = samples.count

    guard count > 0 else {
        print("[]")
        return 0
    }

    let thresholdLinear = powf(10.0, thresholdDB / 20.0)
    let windowSizeSamples = Int(0.02 * sampleRate) // 20ms RMS window
    let hopSizeSamples = Int(0.01 * sampleRate) // 10ms hop

    var regions: [SilenceRegion] = []
    var silenceStart: Double? = nil

    var frameIdx = 0
    while frameIdx * hopSizeSamples + windowSizeSamples <= count {
        let start = frameIdx * hopSizeSamples
        let windowLen = min(windowSizeSamples, count - start)

        // Compute RMS using vDSP
        var sumSq: Float = 0
        vDSP_svesq(Array(samples[start..<start+windowLen]), 1, &sumSq, vDSP_Length(windowLen))
        let rms = sqrtf(sumSq / Float(windowLen))

        let timeSec = Double(start) / sampleRate

        if rms < thresholdLinear {
            if silenceStart == nil {
                silenceStart = timeSec
            }
        } else {
            if let ss = silenceStart {
                let duration = timeSec - ss
                if duration >= minDuration {
                    regions.append(SilenceRegion(start: ss, end: timeSec))
                }
                silenceStart = nil
            }
        }

        frameIdx += 1
    }

    // Close trailing silence
    if let ss = silenceStart {
        let endTime = Double(count) / sampleRate
        let duration = endTime - ss
        if duration >= minDuration {
            regions.append(SilenceRegion(start: ss, end: endTime))
        }
    }

    // Output JSON
    let encoder = JSONEncoder()
    encoder.outputFormatting = .prettyPrinted
    if let jsonData = try? encoder.encode(regions),
       let jsonString = String(data: jsonData, encoding: .utf8) {
        print(jsonString)
    } else {
        print("[]")
    }

    return 0
}

// MARK: - CLI entry point

func printUsage() {
    fputs("""
    Usage:
      klipt-audio denoise -i <input.wav> -o <output.wav>
      klipt-audio silence -i <input.wav> [-threshold <dB>] [-min-duration <seconds>]

    Modes:
      denoise       Reduce background noise using spectral subtraction + noise gate
      silence       Detect silence regions, output JSON array

    Options:
      -i              Input WAV file path (required)
      -o              Output WAV file path (required for denoise)
      -threshold      Silence threshold in dB (default: -40)
      -min-duration   Minimum silence duration in seconds (default: 0.5)

    """, stderr)
}

func main() -> Int32 {
    let args = CommandLine.arguments

    guard args.count >= 2 else {
        printUsage()
        return 1
    }

    let mode = args[1]
    var inputPath: String? = nil
    var outputPath: String? = nil
    var threshold: Float = -40.0
    var minDuration: Double = 0.5

    var i = 2
    while i < args.count {
        switch args[i] {
        case "-i":
            i += 1
            if i < args.count { inputPath = args[i] }
        case "-o":
            i += 1
            if i < args.count { outputPath = args[i] }
        case "-threshold":
            i += 1
            if i < args.count { threshold = Float(args[i]) ?? -40.0 }
        case "-min-duration":
            i += 1
            if i < args.count { minDuration = Double(args[i]) ?? 0.5 }
        default:
            fputs("Unknown option: \(args[i])\n", stderr)
            printUsage()
            return 1
        }
        i += 1
    }

    guard let input = inputPath else {
        fputs("Error: Input file (-i) is required\n", stderr)
        printUsage()
        return 1
    }

    switch mode {
    case "denoise":
        guard let output = outputPath else {
            fputs("Error: Output file (-o) is required for denoise mode\n", stderr)
            printUsage()
            return 1
        }
        return runDenoise(inputPath: input, outputPath: output)

    case "silence":
        return detectSilence(inputPath: input, thresholdDB: threshold, minDuration: minDuration)

    default:
        fputs("Error: Unknown mode '\(mode)'. Use 'denoise' or 'silence'.\n", stderr)
        printUsage()
        return 1
    }
}

exit(main())

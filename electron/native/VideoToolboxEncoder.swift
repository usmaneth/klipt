import AVFoundation
import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

// MARK: - CLI Argument Parsing

struct EncoderOptions {
    var inputPath: String = ""
    var outputPath: String = ""
    var codec: String = "h264" // h264 or hevc
    var bitrate: Int = 16_000_000 // 16 Mbps default
    var fps: Double = 0 // 0 = use source fps
    var width: Int = 0 // 0 = use source dimensions
    var height: Int = 0 // 0 = use source dimensions
    var profileLevel: String = "high" // baseline, main, high
    var keyframeInterval: Int = 0 // 0 = auto (2s worth of frames)
    var verbose: Bool = false
}

func parseArguments() -> EncoderOptions? {
    var opts = EncoderOptions()
    let args = CommandLine.arguments
    var i = 1

    while i < args.count {
        switch args[i] {
        case "-i", "--input":
            i += 1
            guard i < args.count else { printUsage(); return nil }
            opts.inputPath = args[i]
        case "-o", "--output":
            i += 1
            guard i < args.count else { printUsage(); return nil }
            opts.outputPath = args[i]
        case "-codec", "--codec":
            i += 1
            guard i < args.count else { printUsage(); return nil }
            opts.codec = args[i].lowercased()
        case "-bitrate", "--bitrate":
            i += 1
            guard i < args.count else { printUsage(); return nil }
            opts.bitrate = Int(args[i]) ?? 16_000_000
        case "-fps", "--fps":
            i += 1
            guard i < args.count else { printUsage(); return nil }
            opts.fps = Double(args[i]) ?? 0
        case "-width", "--width":
            i += 1
            guard i < args.count else { printUsage(); return nil }
            opts.width = Int(args[i]) ?? 0
        case "-height", "--height":
            i += 1
            guard i < args.count else { printUsage(); return nil }
            opts.height = Int(args[i]) ?? 0
        case "-profile", "--profile":
            i += 1
            guard i < args.count else { printUsage(); return nil }
            opts.profileLevel = args[i].lowercased()
        case "-keyframe", "--keyframe-interval":
            i += 1
            guard i < args.count else { printUsage(); return nil }
            opts.keyframeInterval = Int(args[i]) ?? 0
        case "-v", "--verbose":
            opts.verbose = true
        case "-h", "--help":
            printUsage()
            exit(0)
        default:
            fputs("Unknown option: \(args[i])\n", stderr)
            printUsage()
            return nil
        }
        i += 1
    }

    guard !opts.inputPath.isEmpty else {
        fputs("Error: Input path is required.\n", stderr)
        printUsage()
        return nil
    }
    guard !opts.outputPath.isEmpty else {
        fputs("Error: Output path is required.\n", stderr)
        printUsage()
        return nil
    }
    guard opts.codec == "h264" || opts.codec == "hevc" else {
        fputs("Error: Codec must be 'h264' or 'hevc'.\n", stderr)
        return nil
    }

    return opts
}

func printUsage() {
    let usage = """
        Usage: klipt-vtenc -i <input> -o <output> [options]

        Options:
          -i, --input <path>          Input video file path (required)
          -o, --output <path>         Output MP4 file path (required)
          -codec, --codec <codec>     Video codec: h264, hevc (default: h264)
          -bitrate, --bitrate <bps>   Target bitrate in bps (default: 16000000)
          -fps, --fps <fps>           Output frame rate, 0 = source (default: 0)
          -width, --width <px>        Output width, 0 = source (default: 0)
          -height, --height <px>      Output height, 0 = source (default: 0)
          -profile, --profile <p>     H.264 profile: baseline, main, high (default: high)
          -keyframe, --keyframe-interval <n>  Keyframe interval in frames, 0 = auto
          -v, --verbose               Verbose logging
          -h, --help                  Show this help
        """
    fputs(usage, stderr)
}

// MARK: - Progress Reporting

func reportProgress(_ phase: String, _ percent: Double) {
    let json = "{\"phase\":\"\(phase)\",\"progress\":\(String(format: "%.1f", percent))}"
    print(json)
    fflush(stdout)
}

func reportError(_ message: String) {
    let escaped = message.replacingOccurrences(of: "\"", with: "\\\"")
    let json = "{\"error\":\"\(escaped)\"}"
    print(json)
    fflush(stdout)
}

func reportComplete(_ outputPath: String, durationMs: Double) {
    let json = "{\"complete\":true,\"output\":\"\(outputPath)\",\"duration_ms\":\(String(format: "%.0f", durationMs))}"
    print(json)
    fflush(stdout)
}

// MARK: - VideoToolbox Hardware Encoder

class VideoToolboxTranscoder {
    let options: EncoderOptions

    private var assetReader: AVAssetReader?
    private var assetWriter: AVAssetWriter?
    private var videoReaderOutput: AVAssetReaderTrackOutput?
    private var audioReaderOutput: AVAssetReaderTrackOutput?
    private var videoWriterInput: AVAssetWriterInput?
    private var audioWriterInput: AVAssetWriterInput?

    private var compressionSession: VTCompressionSession?

    private var sourceVideoTrack: AVAssetTrack?
    private var sourceAudioTrack: AVAssetTrack?
    private var totalFrames: Int64 = 0
    private var processedFrames: Int64 = 0

    init(options: EncoderOptions) {
        self.options = options
    }

    func run() -> Bool {
        let startTime = CFAbsoluteTimeGetCurrent()

        let inputURL = URL(fileURLWithPath: options.inputPath)
        let outputURL = URL(fileURLWithPath: options.outputPath)

        // Remove output file if it exists
        try? FileManager.default.removeItem(at: outputURL)

        let asset = AVAsset(url: inputURL)

        // Load tracks synchronously
        let semaphore = DispatchSemaphore(value: 0)
        var videoTracks: [AVAssetTrack] = []
        var audioTracks: [AVAssetTrack] = []

        if #available(macOS 12.0, *) {
            // Use modern async API wrapped in semaphore for CLI
            let group = DispatchGroup()

            group.enter()
            asset.loadTracks(withMediaType: .video) { tracks, error in
                videoTracks = tracks ?? []
                if let error = error {
                    self.log("Warning: Could not load video tracks: \(error)")
                }
                group.leave()
            }

            group.enter()
            asset.loadTracks(withMediaType: .audio) { tracks, error in
                audioTracks = tracks ?? []
                if let error = error {
                    self.log("Warning: Could not load audio tracks: \(error)")
                }
                group.leave()
            }

            group.notify(queue: .main) {
                semaphore.signal()
            }
            semaphore.wait()
        } else {
            videoTracks = asset.tracks(withMediaType: .video)
            audioTracks = asset.tracks(withMediaType: .audio)
        }

        guard let videoTrack = videoTracks.first else {
            reportError("No video track found in input file.")
            return false
        }
        sourceVideoTrack = videoTrack
        sourceAudioTrack = audioTracks.first

        // Determine source properties
        let naturalSize = videoTrack.naturalSize
        let sourceFPS = videoTrack.nominalFrameRate
        let duration = CMTimeGetSeconds(asset.duration)

        let outputWidth = options.width > 0 ? options.width : Int(naturalSize.width)
        let outputHeight = options.height > 0 ? options.height : Int(naturalSize.height)
        let outputFPS = options.fps > 0 ? options.fps : Double(sourceFPS)

        totalFrames = Int64(duration * outputFPS)

        log("Input: \(options.inputPath)")
        log("  Source: \(Int(naturalSize.width))x\(Int(naturalSize.height)) @ \(sourceFPS) fps, \(String(format: "%.2f", duration))s")
        log("  Output: \(outputWidth)x\(outputHeight) @ \(outputFPS) fps")
        log("  Codec: \(options.codec), Bitrate: \(options.bitrate / 1_000_000) Mbps")
        log("  Total frames (est): \(totalFrames)")

        // Setup AVAssetReader
        do {
            assetReader = try AVAssetReader(asset: asset)
        } catch {
            reportError("Failed to create AVAssetReader: \(error.localizedDescription)")
            return false
        }

        // Video reader output - request uncompressed frames
        let videoOutputSettings: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: outputWidth,
            kCVPixelBufferHeightKey as String: outputHeight,
        ]
        videoReaderOutput = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: videoOutputSettings)
        videoReaderOutput!.alwaysCopiesSampleData = false

        if assetReader!.canAdd(videoReaderOutput!) {
            assetReader!.add(videoReaderOutput!)
        } else {
            reportError("Cannot add video reader output.")
            return false
        }

        // Audio reader output (passthrough if available)
        if let audioTrack = sourceAudioTrack {
            let audioOutputSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: 48000,
                AVNumberOfChannelsKey: 2,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
                AVLinearPCMIsNonInterleaved: false,
            ]
            audioReaderOutput = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: audioOutputSettings)
            audioReaderOutput!.alwaysCopiesSampleData = false

            if assetReader!.canAdd(audioReaderOutput!) {
                assetReader!.add(audioReaderOutput!)
            }
        }

        // Setup AVAssetWriter
        do {
            assetWriter = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
        } catch {
            reportError("Failed to create AVAssetWriter: \(error.localizedDescription)")
            return false
        }

        // Video writer input with VideoToolbox compression settings
        let codecType: AVVideoCodecType = options.codec == "hevc" ? .hevc : .h264
        var compressionProperties: [String: Any] = [
            AVVideoAverageBitRateKey: options.bitrate,
            AVVideoExpectedSourceFrameRateKey: outputFPS,
            AVVideoMaxKeyFrameIntervalKey: options.keyframeInterval > 0
                ? options.keyframeInterval
                : Int(outputFPS * 2), // keyframe every 2 seconds
            AVVideoAllowFrameReorderingKey: true,
        ]

        // Hardware acceleration: enable it via the encoder specification
        // AVAssetWriter uses VideoToolbox under the hood; we set the hardware encoder hint
        compressionProperties[kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder as String] = true

        // H.264 profile level
        if options.codec == "h264" {
            switch options.profileLevel {
            case "baseline":
                compressionProperties[AVVideoProfileLevelKey] = AVVideoProfileLevelH264BaselineAutoLevel
            case "main":
                compressionProperties[AVVideoProfileLevelKey] = AVVideoProfileLevelH264MainAutoLevel
            default:
                compressionProperties[AVVideoProfileLevelKey] = AVVideoProfileLevelH264HighAutoLevel
            }
        }

        let videoSettings: [String: Any] = [
            AVVideoCodecKey: codecType,
            AVVideoWidthKey: outputWidth,
            AVVideoHeightKey: outputHeight,
            AVVideoCompressionPropertiesKey: compressionProperties,
        ]

        videoWriterInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
        videoWriterInput!.expectsMediaDataInRealTime = false

        // Preserve source transform
        videoWriterInput!.transform = videoTrack.preferredTransform

        if assetWriter!.canAdd(videoWriterInput!) {
            assetWriter!.add(videoWriterInput!)
        } else {
            reportError("Cannot add video writer input.")
            return false
        }

        // Audio writer input
        if sourceAudioTrack != nil {
            let audioSettings: [String: Any] = [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: 48000,
                AVNumberOfChannelsKey: 2,
                AVEncoderBitRateKey: 192_000,
            ]
            audioWriterInput = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
            audioWriterInput!.expectsMediaDataInRealTime = false

            if assetWriter!.canAdd(audioWriterInput!) {
                assetWriter!.add(audioWriterInput!)
            }
        }

        // Start reading and writing
        guard assetReader!.startReading() else {
            reportError("Failed to start reading: \(assetReader!.error?.localizedDescription ?? "unknown")")
            return false
        }

        guard assetWriter!.startWriting() else {
            reportError("Failed to start writing: \(assetWriter!.error?.localizedDescription ?? "unknown")")
            return false
        }

        assetWriter!.startSession(atSourceTime: .zero)

        reportProgress("encoding", 0)

        // Encode video and audio on separate queues
        let videoQueue = DispatchQueue(label: "com.klipt.vtenc.video")
        let audioQueue = DispatchQueue(label: "com.klipt.vtenc.audio")
        let completionGroup = DispatchGroup()

        // Video encoding
        completionGroup.enter()
        videoWriterInput!.requestMediaDataWhenReady(on: videoQueue) { [self] in
            while self.videoWriterInput!.isReadyForMoreMediaData {
                autoreleasepool {
                    guard let sampleBuffer = self.videoReaderOutput!.copyNextSampleBuffer() else {
                        self.videoWriterInput!.markAsFinished()
                        completionGroup.leave()
                        return
                    }

                    self.videoWriterInput!.append(sampleBuffer)
                    self.processedFrames += 1

                    // Report progress every 30 frames
                    if self.processedFrames % 30 == 0 {
                        let progress = self.totalFrames > 0
                            ? min(99.0, Double(self.processedFrames) / Double(self.totalFrames) * 100.0)
                            : 0
                        reportProgress("encoding", progress)
                    }
                }
            }
        }

        // Audio encoding
        if let audioInput = audioWriterInput, let audioOutput = audioReaderOutput {
            completionGroup.enter()
            audioInput.requestMediaDataWhenReady(on: audioQueue) {
                while audioInput.isReadyForMoreMediaData {
                    guard let sampleBuffer = audioOutput.copyNextSampleBuffer() else {
                        audioInput.markAsFinished()
                        completionGroup.leave()
                        return
                    }
                    audioInput.append(sampleBuffer)
                }
            }
        }

        // Wait for both to complete
        completionGroup.wait()

        // Finalize
        let finishSemaphore = DispatchSemaphore(value: 0)
        var writeSuccess = false

        assetWriter!.finishWriting {
            writeSuccess = self.assetWriter!.status == .completed
            finishSemaphore.signal()
        }
        finishSemaphore.wait()

        assetReader!.cancelReading()

        if !writeSuccess {
            reportError("Failed to finalize output: \(assetWriter!.error?.localizedDescription ?? "unknown")")
            return false
        }

        let elapsed = (CFAbsoluteTimeGetCurrent() - startTime) * 1000
        reportProgress("encoding", 100)
        reportComplete(options.outputPath, durationMs: elapsed)

        log("Encoding complete in \(String(format: "%.1f", elapsed))ms")
        log("  Frames processed: \(processedFrames)")
        log("  Output: \(options.outputPath)")

        // Print file size
        if let attrs = try? FileManager.default.attributesOfItem(atPath: options.outputPath),
           let fileSize = attrs[.size] as? Int64
        {
            let sizeMB = Double(fileSize) / (1024.0 * 1024.0)
            log("  File size: \(String(format: "%.2f", sizeMB)) MB")
        }

        return true
    }

    private func log(_ message: String) {
        if options.verbose {
            fputs("[vtenc] \(message)\n", stderr)
        }
    }
}

// MARK: - Main

guard let options = parseArguments() else {
    exit(1)
}

// Verify input file exists
guard FileManager.default.fileExists(atPath: options.inputPath) else {
    reportError("Input file does not exist: \(options.inputPath)")
    exit(1)
}

let transcoder = VideoToolboxTranscoder(options: options)
let success = transcoder.run()
exit(success ? 0 : 1)

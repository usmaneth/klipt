# Headless export

The headless export polishes a raw screen recording with the klipt exporter.
It needs no window and no GPU.
It runs on a server.

It uses the same code as the editor export: the PixiJS scene, the caption renderer, WebCodecs and mediabunny.
It adds a title card, one caption at a time, and zoom keyframes that come from a file.

## Run it

```bash
scripts/klipt-export --input raw.mp4 --output out.mp4 \
  --preset phone-demo \
  --title "anuma recommends people to group chats" \
  --captions captions.json \
  --zooms zooms.json
```

The script prints exactly one line of JSON on stdout.

```json
{"ok":true,"out":"/abs/out.mp4","bytes":5830506,"seconds":78.5,"faststart":true}
{"ok":false,"out":"","reason":"captions[0].text is longer than 40 characters"}
{"ok":false,"out":"","reason":"the export is stuck: no progress for 180s after frame 120 of 225","log":"/tmp/klipt-export.AbC123.log"}
```

The exit code is 0 only when the output file exists.
A failed run that started the exporter keeps its log and names it in the `log` field.
A failed check, such as a bad option, leaves no log.

## Options

| Option | Meaning |
| --- | --- |
| `--input` | The raw video. Required. |
| `--output` | The file to write. Required. The folder must exist. |
| `--preset` | `phone-demo`. This is the only preset. |
| `--title` | Text for a title card of 1.5 seconds before the video. 120 characters at most. |
| `--captions` | A JSON file with step captions. |
| `--zooms` | A JSON file with zoom keyframes. |

An unknown option is an error. The program never ignores a typo.

## The two JSON files

All times are seconds in the **raw video**. The title card does not move them.

`captions.json` is a list of step captions.

```json
[{ "t": 0.4, "text": "Open the group chat" }, { "t": 3.2, "text": "Ask Anuma who to add" }]
```

- A caption has 40 characters at most. It shows on one line. A longer text is an error.
- A caption ends when the next one starts, or after its reading time (1.2 to 4 seconds).
- The preset writes the copy in lowercase.

`zooms.json` is a list of zoom keyframes.

```json
[{ "t": 2.4, "x": 0.5, "y": 0.35, "scale": 1.8, "dur": 2.2 }]
```

- `x` and `y` are the focus point in the video frame, from 0 to 1.
- The editor has six fixed zoom depths. The nearest depth to `scale` is used (1.25, 1.5, 1.8, 2.2). A `scale` below 1.125 is dropped. The most is 2.5.
- `dur` is 0.3 to 10 seconds. A keyframe that overlaps the next one ends where the next one starts.
- A phone recording has no mouse. The editor auto-zoom cannot find the clicks. The caller makes the keyframes from the tap points.

## The phone-demo preset

- Output: 1080 by 1920, 30 frames per second, H.264 High, about 6 Mbit/s.
- Background `#0D0D0D`, accent `#E0000F`, font Inter, lowercase copy.
- The video sits in a rounded frame with the soft shadow of the editor.
- The captions sit at the lower third, white, with a soft glow, on a dark bar.

## Install on a server

```bash
npm ci --ignore-scripts          # the native input hook is not needed
node node_modules/electron/install.js
npm run build:headless           # vite build: writes dist/headless.html and dist-electron/headless-main.js
```

The host needs `xvfb-run` (or a display), `ffmpeg` (for the faststart copy), `node`, and the font Inter.
The script runs Electron with `--no-sandbox`. The SUID sandbox helper of Electron needs root.
The window opens only a local page that this repository built. It reads one input file and nothing else.

## Speed and memory

Measured on an aarch64 host with 20 cores and no GPU:

| Clip | Frames | Time | Peak memory (all processes) |
| --- | --- | --- | --- |
| 6 s of video with title, 2 captions, 1 zoom | 225 | 79 s | 1.1 GB |
| 2 s of video with title and 1 caption | 105 | 26 s | not measured |

Plan for about 3 frames per second. A video of 60 seconds takes about 10 minutes.

## How it works

1. `electron/headless/main.ts` checks the options and the two files. It opens a hidden window.
2. `src/headless/entry.ts` builds a `VideoExporter` from the job and runs it.
3. The exporter draws each frame with PixiJS on SwiftShader (a CPU WebGL). It encodes with the software H.264 encoder of Chromium.
4. The window gives the bytes to the main process. The main process writes the file and prints the result.
5. `scripts/klipt-export` copies the file again with the index first (`+faststart`), so Slack plays it at once.

The main process watches the renderer. It stops the run when the renderer sends no progress for 180 seconds.
This is a stuck detector. It is not a time limit. Change it with `KLIPT_HEADLESS_STALL_MS`.

## Traps

- A GPU-backed 2D canvas on SwiftShader stalls the frame read-back for minutes. The main process turns it off with `disable-accelerated-2d-canvas`. Do not remove that switch.
- WebCodecs works only in a secure context. A `data:` page has no `VideoEncoder`. The window loads a `file://` page.
- The production build removes every `console.*` call. The renderer reports progress through IPC, not through the console.
- An intro card needs a video with no audio track. The audio would start before the video. The export fails with a clear reason.
- `KLIPT_HEADLESS_SOFTWARE_GL=0` removes the SwiftShader switches. Use it only on a host with a real GPU.

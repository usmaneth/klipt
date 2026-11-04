# klipt CLI: record and render from a script

The klipt CLI records a screen and makes a finished demo video with no window, no prompt and no GPU.
A program, a CI job or an agent drives it. It runs on Linux (arm64 and x64) and macOS.

```
scripts/klipt record   start a recording of a Chrome tab, an Android device, an X display, or a file
scripts/klipt mark     add a caption, a tap, a still for the overview grid, a cut or a speed-up while it records
scripts/klipt stop     stop the recording: raw.mp4 + timeline.json
scripts/klipt render   raw.mp4 + timeline.json -> demo.mp4 + demo.poster.jpg
```

Each command prints **one JSON line** on stdout and nothing else. The exit code is `0` when the work is done,
`1` when it failed (the `reason` field says why), and `2` for bad usage (an unknown flag is an error, never ignored).

It needs Node 22.6 or later and `ffmpeg`/`ffprobe` on `PATH`. `npm install` is not needed: `scripts/klipt` runs
the TypeScript source in `src/cli` directly. Android needs `adb` (and uses `scrcpy` when it is installed).
X11 needs `xwininfo`, and `xdotool` to find a window by name.

## The 3 commands an agent needs

### 1. Record a specific Chrome tab by CDP

The tab is captured with the DevTools screencast (`Page.startScreencast`). Chrome can be headless.
No window is shown and the tab does not need focus. Point `--source` at the DevTools port and pick the tab
by a part of its URL or title:

```bash
OUT=/tmp/demo-slack
scripts/klipt record --source tab:127.0.0.1:9222 --tab app.slack.com --out "$OUT" --detach --max-s 120 \
  --title "Invite a teammate"
# {"ok":true,"state":"recording","pid":4242,"cdp":"ws://127.0.0.1:9222/devtools/page/9F...","url":"https://app.slack.com/...",...}

scripts/klipt mark --out "$OUT" --state "Empty channel"          # a still for the overview grid
scripts/klipt mark --out "$OUT" --caption "Open the invite dialog"
#   ... drive the tab (Playwright, CDP, a person). A click in the tab becomes a tap by itself.
scripts/klipt mark --out "$OUT" --state "Invite sent"
scripts/klipt stop --out "$OUT"
# {"ok":true,"raw":"/tmp/demo-slack/raw.mp4","timeline":"/tmp/demo-slack/timeline.json","seconds":21.4,...}
```

Other tab sources:

| Source | Meaning |
| --- | --- |
| `tab:9222`, `tab:host:9222`, `tab:http://host:9222` | A DevTools port. `--tab TEXT` picks the tab; else the first normal tab. |
| `tab:ws://host:9222/devtools/page/<id>` | One page target. |
| `tab:ws://host:9222/devtools/browser/<id>` | A browser connection (for example `browser.wsEndpoint()` of Playwright), with `--tab`. |
| `tab:https://example.com` | klipt starts its own headless Chrome at `--size 1280x720` and opens the URL. The `record` JSON has `cdp` and `browserCdp`, so the caller can drive that tab (`chromium.connectOverCDP(browserCdp)`). |

`--chrome PATH` or `KLIPT_CHROME` picks the browser for `tab:<url>`. Else klipt looks in the Playwright cache, then on `PATH`.
`--no-auto-taps` turns off the click hook.

### 2. Record the Android emulator

```bash
OUT=/tmp/demo-android
scripts/klipt record --source android:emulator-5554 --out "$OUT" --detach --adb ~/Android/Sdk/platform-tools/adb
scripts/klipt mark --out "$OUT" --caption "Open the group chat"
scripts/klipt mark --out "$OUT" --tap 540,1650     # pixels of the device screen, or 0..1
#   ... run the Maestro flow or adb input
scripts/klipt stop --out "$OUT"
```

`android:` with no serial takes the one connected device. klipt uses `scrcpy` with no window when it is on `PATH`;
else `adb shell screenrecord` in segments of 180 s (its limit), joined at the end. Force one with
`--android-backend scrcpy|screenrecord`. The adb binary comes from `--adb`, `ADB`, `PATH`, `ANDROID_HOME`, or `~/Android/Sdk`.

### 3. Render with an overview grid

```bash
scripts/klipt render --input /tmp/demo-slack --preset desktop-demo --max-mb 20 --json
# {"ok":true,"mp4":"/tmp/demo-slack/demo.mp4","poster":"/tmp/demo-slack/demo.poster.jpg","seconds":25.1,
#  "bytes":3120044,"width":1920,"height":1080,"reason":"","preset":"desktop-demo","crf":23,"warnings":[]}
```

`--input` takes a record folder (it reads `raw.mp4` and `timeline.json`) or any video file with `--timeline FILE`.
The video starts with the intro card: the title and the overview grid of the `state` stills, numbered in order.
The poster is the overview grid, so a Slack or PR preview shows the whole flow at a glance.
With no stills, the intro is a title card and the poster is a frame at 40 % of the video.

## Other sources

```bash
scripts/klipt record --source x11::99 --out /tmp/x --detach                 # a whole X display
scripts/klipt record --source x11::99:0x1a00007 --out /tmp/x --detach       # one window, by id
scripts/klipt record --source x11::99:Chromium --out /tmp/x --detach        # one window, by name (xdotool)
scripts/klipt record --source file:/tmp/playwright.webm --out /tmp/f         # a recording that exists
```

For `file:`, put markers with `t` (seconds in the file) in `<out>/markers.jsonl` before you run it, or pass
`--started-at <epoch ms>` so markers with `ts` line up.

## Markers

`klipt mark` appends one line to `<out>/markers.jsonl`. A caller can also append the lines itself:

| Line | Effect |
| --- | --- |
| `{"caption": "Open the sheet"}` | A step caption, from now until the next caption or its reading time (2 to 5 s). Add `"dur": 3` to set it. |
| `{"tap": {"x": 0.42, "y": 0.8}}` | A tap ring and a zoom to that point. `x`, `y` are 0..1, or pixels of the tab viewport, device screen or X window. |
| `{"state": "Invite sent"}` | A still of this moment in the overview grid (9 at most). |
| `{"speed": 4}` ... `{"speed": 1}` | Play this range 4 times faster. |
| `{"cut": true}` ... `{"cut": false}` | Remove this range. |
| `{"title": "Invite a teammate"}` | The title of the intro card. |
| `{"stop": true}` | Stop the recording (this is what `klipt stop` writes). |

The time of a marker is `t` (seconds in the recording) when it is given, else `ts` (epoch ms), else the moment
the recorder read the line (within 0.1 s). `klipt mark` writes `ts` for you. A bad line is skipped with a warning.

The recording also stops at `--max-s` (default 600), on SIGINT or SIGTERM, or when the source ends (the tab closes).

## timeline.json

`klipt stop` writes it from the markers. A caller can write or edit it before `klipt render`.
All times are seconds in **raw.mp4**. An unknown key or a bad value is an error that names the field.

```json
{
  "version": 1,
  "title": { "text": "Invite a teammate", "subtitle": "seeded local backend" },
  "overview": { "seconds": 3.5, "stills": [{ "t": 0.5, "label": "Empty channel" }, { "image": "/tmp/end.png", "label": "Invite sent" }] },
  "captions": [{ "t": 1.0, "text": "Open the invite dialog" }],
  "taps": [{ "t": 2.4, "x": 0.62, "y": 0.31 }],
  "zooms": [{ "t": 6.0, "x": 0.5, "y": 0.7, "scale": 1.8, "dur": 2.0 }],
  "cuts": [{ "from": 8.0, "to": 14.0 }],
  "speed": [{ "from": 15.0, "to": 25.0, "factor": 4 }],
  "voiceover": { "endpoint": "http://100.64.72.29:8792/tts", "voice": "narrator" }
}
```

| Key | Rules |
| --- | --- |
| `title` | A string or `{text, subtitle?, seconds?}`. 120 characters at most. The card shows for 2 s, or for the overview time. |
| `overview.stills` | 9 at most. Each has `label` (60 characters) and either `t` (a frame of raw.mp4) or `image` (a PNG or JPEG). |
| `captions` | `t`, `text` (160 characters, 2 lines on screen), optional `dur` (0.5 to 15 s). |
| `taps` | `t`, `x`, `y` in 0..1. Each tap draws a ring for 0.7 s and zooms in (1.6x for 1.6 s, starting 0.3 s before). A burst of taps makes one zoom. |
| `zooms` | `t`, `x`, `y`, `scale` (1.05 to 3, default 1.6), `dur` (0.3 to 10 s, default 1.6). The zoom eases in and out. |
| `cuts`, `speed` | `from` < `to`. `factor` is 1.25 to 16. Ranges must not overlap. A caption inside a cut is dropped. |
| `voiceover` | `endpoint` (http or https), optional `voice`, `style` (300 characters), `speed` (0.25 to 4), `duck` (0 to 1), `warmup` (a URL). |

### Voiceover

With `voiceover`, `klipt render` sends each caption text to the endpoint and puts each clip at its caption time.

```json
"voiceover": {
  "endpoint": "http://100.64.72.29:8792/tts",
  "voice": "narrator",
  "style": "warm, upbeat product demo narrator",
  "warmup": "http://100.64.72.29:8792/warmup"
}
```

- The request is `POST <endpoint>` with `{"text", "voice"?, "style"?, "speed"?}`, one caption at a time.
  The answer is audio bytes (`audio/wav` or `audio/mpeg`). The `X-Duration-Ms` header gives the clip length;
  without it, ffprobe reads the clip. An error status with `{"detail": ...}` skips the voiceover.
- `warmup`, when it is set, gets one `POST` before the first line, so a cold engine starts early.
- Each line has `--tts-timeout-s` (default 600, enough for a cold engine) to arrive.
- A caption stays on screen until its clip ends, plus 0.3 s. When a clip runs into the next caption, the frame
  before the next caption freezes for the extra time, so the voice and the screen stay in step.
- The video audio, when there is one, is ducked to `duck` (default 0.25) while a clip plays. The mp4 gets an AAC track.
- When the endpoint is down, too slow, or a clip is bad, the render goes on without the voice. The result has
  `"voiceover": "skipped: <reason>"` and a warning. The render does not fail.

### The spark voice service (`100.64.72.29:8792`)

The endpoint in the examples is the narration service on spark3 (Tailscale only). It has two engines, and each one
starts on demand and stops after 10 idle minutes, so the first line after an idle period meets a cold engine.

| Engine | Model | Cold start | Speed (RTF, warm) | Notes |
| --- | --- | --- | --- | --- |
| `drama3` (default) | Fish Audio Drama 3, FP8 | about 6.5 min (it loads 39 GB) | 1.0 | Runs on the first idle spark. Applies `style`. |
| `qwen3` (fallback) | Qwen3-TTS 12Hz 0.6B | about 30 s | 0.55 | Serves when drama3 is down, out of memory, or no spark has a free GPU lease. `style` has little or no effect: built-in voices (`aiden`, `ryan`) ignore it. |

- Always set `warmup` to `http://100.64.72.29:8792/warmup`, so each video starts with one `POST /warmup`. It returns at
  once and starts drama3, or qwen3 when drama3 cannot start.
- A line that meets a cold drama3 waits for it for up to 600 s, then qwen3 serves it. For drama3 narration, `POST /warmup`
  when the recording starts, not only at render time, and render with `--tts-timeout-s 900`.
- The answer headers say what served each line: `X-Engine`, `X-Fallback-From` (only after a fallback), and
  `X-Style-Applied`. When drama3 comes up in the middle of a render, the clips before it are qwen3, so one video
  can have two engines. Warm up early to keep one voice.
- `GET /voices` lists the voices (`narrator`, `narrator_male`, `aiden`, `ryan`). `GET /health` shows each engine's state.

## Presets and the size cap

| Preset | Output | Use |
| --- | --- | --- |
| `desktop-demo` | 1920x1080 | A tab, the admin console, a desktop. |
| `phone-demo` | 1080x1920 | A phone recording. |
| `auto` (default) | from the aspect of the input | |

Both put the video in a rounded frame on `#0D0D0D`, with captions in Inter (or `--font FILE`, `KLIPT_FONT`).
The output is H.264 High, yuv420p, 30 fps, `+faststart`, so Slack plays it inline.
klipt renders a master once, then encodes it at crf 23, 27, 31, 35, 38 until the file fits `--max-mb` (default 20, `0` for no cap).
When nothing fits, the render fails with `cannot fit under N MB: ...`.

## Result JSON

`klipt render`:

| Field | Meaning |
| --- | --- |
| `ok` | `true` only when the mp4 exists and passed the checks (h264, yuv420p, faststart, under the cap). |
| `mp4`, `poster` | Absolute paths. Empty on failure. |
| `seconds`, `bytes`, `width`, `height` | Of the mp4. |
| `reason` | Empty on success. On failure, one sentence. |
| `preset`, `crf`, `warnings` | The preset and crf that were used, and things that did not stop the render. |
| `voiceover` | Only with a voiceover: `ok: N clips` or `skipped: <reason>`. |
| `log` | Only on failure: the ffmpeg log. |

`klipt record`, `klipt stop`: `{ok, out, raw, timeline, markers, seconds, bytes, width, height, reason, source, stoppedBy, warnings, session}`.
The same JSON is in `<out>/record.json`. `<out>/session.json` holds the state (`starting`, `recording`, `stopping`, `done`, `failed`),
the pid, and the source facts. `record --detach` returns at `recording`. Without `--detach`, `record` blocks until it stops.

## The old headless export

`scripts/klipt-export --input raw.mp4 --output out.mp4 [--preset phone-demo] [--title T] [--captions captions.json] [--zooms zooms.json]`
is `klipt export`: the flags and the JSON line of the first headless export, on top of `klipt render`.
`captions.json` is `[{"t", "text"}]`. `zooms.json` is `[{"t", "x", "y", "scale", "dur"}]`.

## Smoke test

`scripts/smoke-record-tab.mjs` starts a headless Chromium with a DevTools port, records a tab for 10 s with 3 markers
and 4 clicks, renders it, and writes 3 stills (the poster, a caption frame, a zoom frame):

```bash
PLAYWRIGHT_CORE=~/.local/share/ui-demo/node_modules/playwright-core \
CHROME=~/.cache/ms-playwright/chromium-1243/chrome-linux-arm64/chrome \
  node scripts/smoke-record-tab.mjs /tmp/klipt-smoke
```

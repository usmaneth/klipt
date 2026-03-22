<p align="center">
  <img src="./icons/klipt-logo.png" width="120" alt="klipt logo">
</p>

<h1 align="center">klipt</h1>

<p align="center">
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-111827?style=for-the-badge" alt="macOS Windows Linux" />
  <img src="https://img.shields.io/badge/open%20source-MIT-E0000F?style=for-the-badge" alt="MIT license" />
</p>

<h3 align="center">edit at the speed of thought.</h3>

<p align="center">
klipt is an <b>open-source AI-powered screen recorder and editor</b> for creating <b>polished walkthroughs, demos, tutorials, and product videos</b>. Contributions welcome.
</p>

<p align="center">
klipt includes AI captions, studio sound enhancement, auto-zoom, cursor animations, native macOS and Windows recording, background removal, and more.
</p>

---

## What is klipt?

klipt lets you record your screen and automatically transform it into a polished video. It handles the heavy lifting of zooming into important actions, enhancing audio, generating captions, and smoothing out jittery cursor movement so your demos look professional by default.

klipt runs on:

- **macOS** 12.3+
- **Windows** 10 Build 19041+
- **Linux** (modern distros)

---

## Features

- **AI Captions** — Local Whisper-powered transcription with word-level timestamps
- **Studio Sound** — One-click audio enhancement (noise removal via RNNoise)
- **Auto-Zoom** — Automatically zooms into clicks, scrolls, and key actions
- **Background Removal** — AI-powered webcam background removal/blur
- **AI Thumbnails** — Smart frame extraction with aesthetic scoring
- **Cursor Animations** — Smooth cursor rendering with sway, click bounce, motion blur, and looping
- **Native Recording** — ScreenCaptureKit on macOS, Windows.Graphics.Capture on Windows
- **Background Wallpapers** — Built-in gradient and image backgrounds
- **Annotations** — Add shapes, arrows, text, and highlights
- **Audio Support** — System audio and microphone recording with separate tracks
- **Export Options** — MP4 and GIF export with quality presets
- **Crop & Aspect Ratio** — Flexible cropping with standard aspect ratios
- **Project Files** — Save and load `.klipt` project files

---

## Getting Started

### Prerequisites

- Node.js 22+
- npm

### Install

```bash
git clone https://github.com/usmaneth/klipt.git
cd klipt
npm install
```

### Development

```bash
npm run dev
```

### Build

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

---

## Brand

See the [brand kit](./branding/) for logos, colors, and guidelines.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## License

[MIT](LICENSE.md)

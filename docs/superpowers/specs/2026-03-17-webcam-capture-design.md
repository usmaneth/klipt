# Webcam Capture & Camera Editing — Design Spec

## Overview

Add webcam capture to klipt so users can record their camera alongside their screen, then edit the camera overlay (position, size, shape, styling) in the editor before export.

## Recording Phase

### Webcam Capture

- Webcam recorded as a **separate video file** alongside the screen recording.
- Uses `navigator.mediaDevices.getUserMedia({ video: { deviceId, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } })` in the renderer process.
- Recorded via `MediaRecorder` with the same mimeType logic as the screen recording.
- Saved to the recordings directory as `webcam-{timestamp}.webm`.
- Recording starts/stops in sync with the screen recording — triggered from the same `toggleRecording()` flow.
- **Webcam state lives in `useWebcamRecorder.ts`** (new hook), not inlined into `useScreenRecorder.ts`. `LaunchWindow` coordinates both hooks — starts webcam when screen starts, stops webcam when screen stops.

### Camera Device Selection

- Device enumeration via `navigator.mediaDevices.enumerateDevices()` filtered to `videoinput`.
- Follows the existing `useMicrophoneDevices` hook pattern — new `useWebcamDevices` hook.
- Device selector dropdown in the HUD overlay, same style as the microphone selector.
- **When zero cameras available**: camera toggle button is disabled with tooltip "No camera found".

### HUD Overlay Changes

- **Camera toggle button** — enables/disables webcam recording. Icon: `Camera` / `CameraOff` from lucide-react.
- **Device selector dropdown** — appears when camera is enabled, lists available cameras.
- **Live preview thumbnail** — small circular preview of the webcam feed in the HUD. Toggleable via a button so users can hide it if distracting. Preview uses a `<video>` element with the webcam stream as `srcObject`.
- HUD width may need slight increase to accommodate the preview (currently 500px).

### Camera Permission (macOS)

- Before starting webcam, check camera permission status via `systemPreferences.getMediaAccessStatus('camera')`.
- If not granted, call `systemPreferences.askForMediaAccess('camera')` via IPC.
- If denied, show toast: "klipt needs camera permission. Open System Settings > Privacy & Security > Camera to enable it."
- Screen recording proceeds without webcam if camera permission is denied — graceful degradation.

### Camera Disconnect Mid-Recording

- Listen for `track.onended` event on the webcam video track.
- On disconnect: stop webcam `MediaRecorder` gracefully (finalize existing chunks), save partial webcam file.
- Screen recording continues uninterrupted.
- Show toast notification: "Camera disconnected. Screen recording continues."
- Partial webcam file is still usable in the editor (plays until disconnect point).

### IPC Changes

- `store-webcam-video` — saves webcam ArrayBuffer to file in recordings dir (follows `store-recorded-video` pattern).
- `get-webcam-video-path` — returns the path of the last recorded webcam file.
- `check-camera-permission` — returns camera permission status (macOS).
- `request-camera-permission` — triggers macOS camera permission prompt.
- No new IPC needed for device enumeration — `enumerateDevices()` runs in the renderer.

### Recording Stop — Both Paths

The codebase has two stop paths:
- **Native path** (macOS ScreenCaptureKit / Windows WGC): calls `stopNativeScreenRecording()` then `switchToEditor()`.
- **Browser path**: stops `MediaRecorder`, triggers `onstop` for blob processing.

The webcam `MediaRecorder` must be stopped and its blob finalized in **both** branches, before `switchToEditor()` is called. `useWebcamRecorder` exposes a `stopAndSave()` async method that returns a Promise resolving when the webcam file is written. `LaunchWindow` awaits this before calling `switchToEditor()`.

### Recording State

State managed by `useWebcamRecorder.ts`:
- `webcamStream: MediaStream | null`
- `webcamRecorder: MediaRecorder | null`
- `webcamChunks: Blob[]`
- `webcamEnabled: boolean` (user toggle)
- `webcamDeviceId: string` (selected camera)
- `webcamPreviewVisible: boolean` (preview toggle)

### Webcam File Cleanup

Webcam `.webm` files included in the existing auto-cleanup policy in `electron/main.ts`. The cleanup logic uses `AUTO_RECORDING_PREFIX` and `AUTO_RECORDING_RETENTION_COUNT` — extend it to also match `webcam-` prefixed files with the same retention rules.

## Editor Phase

### Camera Panel

New "Camera" **accordion section** in `SettingsPanel.tsx` (matching the existing Accordion pattern — Background, Cursor, Zoom, etc.), visible only when the project has a webcam recording.

**Controls:**
- **Visible** — toggle switch, show/hide the camera overlay
- **Shape** — toggle group: Circle (default), Rounded Rectangle, Square
- **Size** — slider control (50px–400px diameter/width, default 150px)
- **Opacity** — slider 0–100% (default 100%)
- **Border Color** — color picker (same `@uiw/react-color-block` as existing)
- **Border Width** — slider 0–8px (default 2px)
- **Shadow** — intensity slider 0–100% (default 30%, reuses existing shadow pattern)

### Camera Position (Draggable)

- Camera bubble rendered as a **DOM overlay** positioned absolutely over the PixiJS canvas (same pattern as `AnnotationOverlay.tsx`).
- Uses `react-rnd` (already a dependency) for drag-and-drop positioning on the DOM element.
- During export, the webcam is composited into the PixiJS scene at the corresponding position.
- Position stored as `{ x: number, y: number }` in normalized coordinates (0–1 range relative to video dimensions) so it scales across resolutions.
- Default position: bottom-right corner with 5% margin.

### Editor State

New fields added to `VideoEditor.tsx` state (alongside existing ~50 useState hooks):
```typescript
const [webcamVisible, setWebcamVisible] = useState(true);
const [webcamShape, setWebcamShape] = useState<'circle' | 'rounded-rect' | 'square'>('circle');
const [webcamSize, setWebcamSize] = useState(150);
const [webcamOpacity, setWebcamOpacity] = useState(100);
const [webcamBorderColor, setWebcamBorderColor] = useState('#ffffff');
const [webcamBorderWidth, setWebcamBorderWidth] = useState(2);
const [webcamShadow, setWebcamShadow] = useState(30);
const [webcamPosition, setWebcamPosition] = useState({ x: 0.9, y: 0.85 });
```

## Playback Rendering

### Dual Approach: DOM for Editor, PixiJS for Export

**In the editor (VideoPlayback.tsx):**
- Webcam preview rendered as a DOM `<video>` element inside `WebcamOverlay.tsx`, positioned absolutely over the PixiJS canvas.
- Shape achieved via CSS `border-radius` (circle: 50%, rounded-rect: 12px, square: 0).
- Border, shadow, opacity via CSS properties.
- Draggable via `react-rnd`.
- Webcam `<video>` element's `currentTime` synced to the screen video on seek/play/pause.

**In export (FrameRenderer):**
- Webcam composited in the PixiJS scene as a sprite with mask:
```
app.stage
├── cameraContainer (zoom transforms applied)
│   ├── videoContainer (screen video + filters)
│   ├── cursorContainer
│   └── webcamContainer (NEW — export only)
│       ├── webcamSprite (Texture from HTMLVideoElement)
│       ├── webcamMask (Graphics — circle, rounded rect, or square)
│       ├── webcamBorder (Graphics — stroke around mask shape)
│       └── webcamShadow (DropShadowFilter from pixi-filters v6)
```

Shadow uses `DropShadowFilter` from `pixi-filters` (v6, already a dependency — NOT the stale `@pixi/filter-drop-shadow` v5 package).

### Sync Strategy

- Both `<video>` elements (screen + webcam) controlled by the same playback logic.
- On seek: set both `video.currentTime` to the same timestamp.
- On play/pause: both play/pause together.
- If webcam video is shorter than screen video, webcam overlay is hidden (removed from DOM / scene) after its duration ends.

## Export Pipeline

### FrameRenderer Changes

`frameRenderer.ts` extended:
- Accept optional `webcamVideoElement: HTMLVideoElement` and `webcamState` parameters.
- On each frame render, if webcam is present, visible, and timestamp is within webcam duration:
  1. Seek webcam video to the frame's timestamp and **await the `seeked` event** before reading the texture.
  2. Update webcam texture from the video element's current frame.
  3. Apply shape mask, border, shadow, opacity to the webcam sprite.
  4. Position and scale the webcam sprite based on editor state.
  5. PixiJS renders the full composite (screen + cursor + webcam) in one pass.
- If `sourceTimestampMs > webcamDuration`, skip webcam compositing entirely (remove sprite from scene, not freeze on last frame).

### Decoder Changes

`videoExporter.ts` extended:
- If project has a webcam file, load it as a second `HTMLVideoElement`.
- Seek webcam video to match each frame's timestamp during export.
- Await `seeked` event before passing to `FrameRenderer.renderFrame()`.
- Pass webcam element to `FrameRenderer.renderFrame()`.

### GIF Export

`gifExporter.ts` also uses `FrameRenderer` — extend `GifExporterConfig` to accept optional webcam video element and state, passed through to `FrameRenderer` the same way as MP4 export.

## Project File Format

### Schema Addition

`projectPersistence.ts` — `ProjectEditorState` extended:
```typescript
webcam?: {
  path: string;              // absolute path to webcam video file
  visible: boolean;
  shape: 'circle' | 'rounded-rect' | 'square';
  size: number;              // pixels
  opacity: number;           // 0-100
  borderColor: string;       // hex
  borderWidth: number;       // pixels
  shadow: number;            // 0-100 intensity
  position: { x: number; y: number }; // normalized 0-1
};
```

Backward compatible — missing `webcam` field means no camera layer. Old `.pixelcast` files load without issue.

### Normalization

`normalizeProjectEditor()` extended to validate the `webcam` field:
- `shape`: must be `'circle' | 'rounded-rect' | 'square'`, default `'circle'`
- `size`: clamped to 50–400, default 150
- `opacity`: clamped to 0–100, default 100
- `borderColor`: must be valid hex string, default `'#ffffff'`
- `borderWidth`: clamped to 0–8, default 2
- `shadow`: clamped to 0–100, default 30
- `position.x` and `position.y`: clamped to 0–1, default `{ x: 0.9, y: 0.85 }`
- `path`: must be non-empty string, if invalid the entire `webcam` field is set to `undefined`

### Editor Preferences

`editorPreferences.ts` — persist webcam defaults so new recordings inherit the user's preferred shape, size, position, etc.

## i18n

New strings added to existing English locale files:
- `src/i18n/locales/en/launch.json` — camera toggle, device selector, preview toggle, permission messages
- `src/i18n/locales/en/editor.json` — Camera accordion section header and all control labels
- `src/i18n/locales/en/settings.json` — webcam-related settings if any

Run `npm run i18n:check` after locale file updates to verify structure.

## New Files

| File | Purpose |
|------|---------|
| `src/hooks/useWebcamDevices.ts` | Enumerate video input devices (mirrors `useMicrophoneDevices.ts`) |
| `src/hooks/useWebcamRecorder.ts` | Manage webcam stream, MediaRecorder, preview state, `stopAndSave()` |
| `src/components/video-editor/WebcamPanel.tsx` | Camera editing controls (shape, size, border, shadow, opacity) |
| `src/components/video-editor/WebcamOverlay.tsx` | Draggable DOM webcam bubble over the video canvas |

## Modified Files

| File | Changes |
|------|---------|
| `src/hooks/useScreenRecorder.ts` | Call `useWebcamRecorder.stopAndSave()` in both native and browser stop paths |
| `src/components/launch/LaunchWindow.tsx` | Add camera toggle, device selector, live preview, coordinate webcam hook |
| `src/components/video-editor/VideoPlayback.tsx` | Mount `WebcamOverlay` DOM element, sync webcam video playback |
| `src/components/video-editor/VideoEditor.tsx` | Add webcam state, pass to playback and panel |
| `src/components/video-editor/SettingsPanel.tsx` | Add Camera accordion section |
| `src/lib/exporter/frameRenderer.ts` | Composite webcam into export frames (PixiJS sprite + mask) |
| `src/lib/exporter/videoExporter.ts` | Load webcam video, seek + await per frame, pass to FrameRenderer |
| `src/lib/exporter/gifExporter.ts` | Extend GifExporterConfig with webcam, pass to FrameRenderer |
| `src/components/video-editor/projectPersistence.ts` | Extend schema with webcam field + normalization |
| `src/components/video-editor/editorPreferences.ts` | Persist webcam defaults |
| `electron/ipc/handlers.ts` | Add webcam video storage + camera permission IPC |
| `electron/electron-env.d.ts` | Add webcam IPC type declarations |
| `electron/preload.ts` | Expose webcam IPC methods |
| `electron/main.ts` | Extend auto-cleanup to include webcam files |
| `src/i18n/locales/en/launch.json` | Camera recording strings |
| `src/i18n/locales/en/editor.json` | Camera editor panel strings |

## Out of Scope (Future)

- Background removal / blur behind the person
- Per-segment show/hide on timeline
- Animated position transitions between timeline segments
- Webcam-only recording mode (no screen)
- Multiple webcam sources

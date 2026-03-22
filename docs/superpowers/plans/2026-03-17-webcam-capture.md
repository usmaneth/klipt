# Webcam Capture Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add webcam capture alongside screen recording, with a full camera editing panel in the editor.

**Architecture:** Webcam is captured as a separate `.webm` file via `MediaRecorder`. In the editor, the webcam appears as a draggable DOM overlay (like annotations) with shape/size/border/shadow controls. During export, the webcam is composited into the PixiJS scene as a masked sprite.

**Tech Stack:** Electron IPC, React hooks, PixiJS 8, react-rnd, MediaRecorder API, getUserMedia API

**Spec:** `docs/superpowers/specs/2026-03-17-webcam-capture-design.md`

---

## File Map

### New Files
| File | Responsibility |
|------|---------------|
| `src/hooks/useWebcamDevices.ts` | Enumerate video input devices (mirrors useMicrophoneDevices) |
| `src/hooks/useWebcamRecorder.ts` | Manage webcam stream, MediaRecorder, start/stop/save |
| `src/components/video-editor/WebcamPanel.tsx` | Camera accordion section with shape/size/border/shadow/opacity controls |
| `src/components/video-editor/WebcamOverlay.tsx` | Draggable DOM bubble over the video canvas |

### Modified Files
| File | Changes |
|------|---------|
| `electron/preload.ts` | Expose webcam IPC methods |
| `electron/electron-env.d.ts` | Webcam IPC type declarations |
| `electron/ipc/handlers.ts` | Webcam storage + camera permission IPC handlers |
| `electron/main.ts` | Extend auto-cleanup for webcam files |
| `src/i18n/locales/en/launch.json` | Camera recording strings |
| `src/i18n/locales/en/editor.json` | Camera editor panel strings |
| `src/components/launch/LaunchWindow.tsx` | Camera toggle, device selector, preview |
| `src/hooks/useScreenRecorder.ts` | Coordinate webcam stop in both native+browser paths |
| `src/components/video-editor/VideoEditor.tsx` | Webcam state + pass props |
| `src/components/video-editor/SettingsPanel.tsx` | Add Camera accordion section |
| `src/components/video-editor/VideoPlayback.tsx` | Mount WebcamOverlay, sync playback |
| `src/components/video-editor/projectPersistence.ts` | Webcam schema + normalization |
| `src/components/video-editor/editorPreferences.ts` | Persist webcam defaults |
| `src/lib/exporter/frameRenderer.ts` | Composite webcam sprite in export |
| `src/lib/exporter/videoExporter.ts` | Load webcam video, seek per frame |
| `src/lib/exporter/gifExporter.ts` | Pass webcam to FrameRenderer |

---

## Task 1: Webcam Device Enumeration Hook

**Files:**
- Create: `src/hooks/useWebcamDevices.ts`

- [ ] **Step 1: Create useWebcamDevices hook**

Mirror `src/hooks/useMicrophoneDevices.ts` exactly, but filter by `videoinput` and request `{ video: true }` for permission.

```typescript
import { useCallback, useEffect, useRef, useState } from "react";

export interface WebcamDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

export function useWebcamDevices(enabled = false) {
  const [devices, setDevices] = useState<WebcamDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const enumerateDevices = useCallback(async () => {
    if (!enabled) {
      setDevices([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      if (!mounted.current) return;
      const videoDevices = allDevices
        .filter((d) => d.kind === "videoinput")
        .map((d) => ({ deviceId: d.deviceId, label: d.label || `Camera ${d.deviceId.slice(0, 4)}`, groupId: d.groupId }));
      setDevices(videoDevices);
      if (videoDevices.length > 0 && !videoDevices.some((d) => d.deviceId === selectedDeviceId)) {
        setSelectedDeviceId(videoDevices[0].deviceId);
      }
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : "Failed to enumerate cameras");
      setDevices([]);
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  }, [enabled, selectedDeviceId]);

  useEffect(() => {
    mounted.current = true;
    enumerateDevices();
    const handler = () => enumerateDevices();
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      mounted.current = false;
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, [enumerateDevices]);

  return { devices, selectedDeviceId, setSelectedDeviceId, isLoading, error };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useWebcamDevices.ts
git commit -m "feat: add useWebcamDevices hook for camera enumeration"
```

---

## Task 2: Webcam Recorder Hook

**Files:**
- Create: `src/hooks/useWebcamRecorder.ts`

- [ ] **Step 1: Create useWebcamRecorder hook**

Manages webcam stream, MediaRecorder, chunks, and exposes `startRecording`, `stopAndSave`, preview stream.

```typescript
import { useCallback, useRef, useState } from "react";
import { fixWebmDuration } from "@fix-webm-duration/fix";

export interface UseWebcamRecorderOptions {
  enabled: boolean;
  deviceId: string;
  previewVisible: boolean;
}

export interface UseWebcamRecorderReturn {
  stream: MediaStream | null;
  recording: boolean;
  previewVisible: boolean;
  setPreviewVisible: (v: boolean) => void;
  startRecording: () => Promise<void>;
  stopAndSave: () => Promise<string | null>;
}

export function useWebcamRecorder(options: UseWebcamRecorderOptions): UseWebcamRecorderReturn {
  const { enabled, deviceId } = options;
  const [recording, setRecording] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(options.previewVisible);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    if (!enabled || !deviceId) return;
    try {
      const webcamStream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: deviceId },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30 },
        },
      });
      streamRef.current = webcamStream;
      setStream(webcamStream);

      // Handle camera disconnect
      const videoTrack = webcamStream.getVideoTracks()[0];
      videoTrack.onended = () => {
        console.warn("Webcam disconnected during recording");
        stopAndSave();
      };

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(webcamStream, { mimeType, videoBitsPerSecond: 2_500_000 });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorderRef.current = recorder;
      startTimeRef.current = Date.now();
      recorder.start(1000);
      setRecording(true);
    } catch (err) {
      console.error("Failed to start webcam recording:", err);
    }
  }, [enabled, deviceId]);

  const stopAndSave = useCallback(async (): Promise<string | null> => {
    const recorder = recorderRef.current;
    const webcamStream = streamRef.current;

    if (!recorder || recorder.state === "inactive") {
      // Clean up stream even if recorder is gone
      webcamStream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setStream(null);
      setRecording(false);
      return null;
    }

    return new Promise<string | null>((resolve) => {
      recorder.onstop = async () => {
        webcamStream?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setStream(null);
        setRecording(false);

        if (chunksRef.current.length === 0) {
          resolve(null);
          return;
        }

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const duration = Date.now() - startTimeRef.current;
        const fixedBlob = await fixWebmDuration(blob, duration);
        const arrayBuffer = await fixedBlob.arrayBuffer();

        try {
          const result = await window.electronAPI.storeWebcamVideo(
            arrayBuffer,
            `webcam-${Date.now()}.webm`,
          );
          resolve(result.success ? (result.path ?? null) : null);
        } catch {
          resolve(null);
        }
      };

      recorder.stop();
    });
  }, []);

  return { stream, recording, previewVisible, setPreviewVisible, startRecording, stopAndSave };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useWebcamRecorder.ts
git commit -m "feat: add useWebcamRecorder hook for camera recording"
```

---

## Task 3: Electron IPC for Webcam

**Files:**
- Modify: `electron/preload.ts`
- Modify: `electron/electron-env.d.ts`
- Modify: `electron/ipc/handlers.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Add IPC type declarations to electron-env.d.ts**

Add inside the `Window.electronAPI` interface:

```typescript
storeWebcamVideo: (
  videoData: ArrayBuffer,
  fileName: string,
) => Promise<{ success: boolean; path?: string; message?: string }>;
getWebcamVideoPath: () => Promise<{ success: boolean; path?: string; message?: string }>;
checkCameraPermission: () => Promise<{ success: boolean; status: string }>;
requestCameraPermission: () => Promise<{ success: boolean; granted: boolean }>;
```

- [ ] **Step 2: Expose IPC methods in preload.ts**

Add to the `contextBridge.exposeInMainWorld("electronAPI", { ... })` object:

```typescript
storeWebcamVideo: (videoData: ArrayBuffer, fileName: string) => {
  return ipcRenderer.invoke("store-webcam-video", videoData, fileName);
},
getWebcamVideoPath: () => {
  return ipcRenderer.invoke("get-webcam-video-path");
},
checkCameraPermission: () => {
  return ipcRenderer.invoke("check-camera-permission");
},
requestCameraPermission: () => {
  return ipcRenderer.invoke("request-camera-permission");
},
```

- [ ] **Step 3: Add IPC handlers in handlers.ts**

Add near the existing `store-recorded-video` handler. Use the same `RECORDINGS_DIR` import and file-writing pattern.

```typescript
let lastWebcamVideoPath = '';

ipcMain.handle('store-webcam-video', async (_event, videoData: ArrayBuffer, fileName: string) => {
  try {
    const filePath = path.join(RECORDINGS_DIR, fileName);
    await fs.writeFile(filePath, Buffer.from(videoData));
    lastWebcamVideoPath = filePath;
    return { success: true, path: filePath };
  } catch (error) {
    return { success: false, message: String(error) };
  }
});

ipcMain.handle('get-webcam-video-path', async () => {
  return { success: true, path: lastWebcamVideoPath };
});

ipcMain.handle('check-camera-permission', async () => {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('camera');
    return { success: true, status };
  }
  return { success: true, status: 'granted' };
});

ipcMain.handle('request-camera-permission', async () => {
  if (process.platform === 'darwin') {
    const granted = await systemPreferences.askForMediaAccess('camera');
    return { success: true, granted };
  }
  return { success: true, granted: true };
});
```

- [ ] **Step 4: Extend auto-cleanup in main.ts**

Find the existing cleanup logic that uses `AUTO_RECORDING_PREFIX`. Add webcam files to the cleanup — they use `webcam-` prefix. In the cleanup function, add a second pass or extend the filter:

```typescript
// Existing: files starting with AUTO_RECORDING_PREFIX ('recording-')
// Add: also match files starting with 'webcam-'
const isAutoFile = (name: string) =>
  name.startsWith(AUTO_RECORDING_PREFIX) || name.startsWith('webcam-');
```

- [ ] **Step 5: Commit**

```bash
git add electron/preload.ts electron/electron-env.d.ts electron/ipc/handlers.ts electron/main.ts
git commit -m "feat: add Electron IPC handlers for webcam storage and permissions"
```

---

## Task 4: i18n Strings

**Files:**
- Modify: `src/i18n/locales/en/launch.json`
- Modify: `src/i18n/locales/en/editor.json`

- [ ] **Step 1: Add camera strings to launch.json**

Add a `"camera"` section inside the `"recording"` object:

```json
"camera": {
  "enable": "Enable camera",
  "disable": "Disable camera",
  "noDevices": "No camera found",
  "showPreview": "Show camera preview",
  "hidePreview": "Hide camera preview",
  "permissionNeeded": "klipt needs camera permission. Open System Settings > Privacy & Security > Camera to enable it.",
  "disconnected": "Camera disconnected. Screen recording continues."
}
```

- [ ] **Step 2: Add camera strings to editor.json**

Add a `"camera"` section:

```json
"camera": {
  "title": "Camera",
  "visible": "Show camera",
  "shape": "Shape",
  "shapeCircle": "Circle",
  "shapeRoundedRect": "Rounded",
  "shapeSquare": "Square",
  "size": "Size",
  "opacity": "Opacity",
  "borderColor": "Border color",
  "borderWidth": "Border width",
  "shadow": "Shadow"
}
```

- [ ] **Step 3: Run i18n check and commit**

```bash
npm run i18n:check
git add src/i18n/locales/en/launch.json src/i18n/locales/en/editor.json
git commit -m "feat: add i18n strings for webcam recording and editor"
```

---

## Task 5: HUD Overlay — Camera Controls

**Files:**
- Modify: `src/components/launch/LaunchWindow.tsx`

- [ ] **Step 1: Add webcam hooks and state**

Import and wire up the new hooks at the top of the component:

```typescript
import { useWebcamDevices } from "@/hooks/useWebcamDevices";
import { useWebcamRecorder } from "@/hooks/useWebcamRecorder";
import { Camera, CameraOff } from "lucide-react";

// Inside the component:
const [cameraEnabled, setCameraEnabled] = useState(false);
const { devices: cameraDevices, selectedDeviceId: cameraDeviceId, setSelectedDeviceId: setCameraDeviceId } = useWebcamDevices(cameraEnabled);
const webcamRecorder = useWebcamRecorder({
  enabled: cameraEnabled,
  deviceId: cameraDeviceId,
  previewVisible: true,
});
```

- [ ] **Step 2: Coordinate webcam with screen recording**

In the existing recording start/stop logic, add webcam coordination:

For **start** — after screen recording starts successfully:
```typescript
if (cameraEnabled) {
  await webcamRecorder.startRecording();
}
```

For **stop** — before `switchToEditor()` in BOTH the native and browser stop paths:
```typescript
const webcamPath = await webcamRecorder.stopAndSave();
// Store webcamPath so the editor can access it
if (webcamPath) {
  await window.electronAPI.setCurrentWebcamPath(webcamPath);
}
```

Note: This requires adding `setCurrentWebcamPath` / `getCurrentWebcamPath` IPC — add to preload/handlers/types following the existing `setCurrentVideoPath` pattern.

- [ ] **Step 3: Add camera UI to the HUD bar**

Add between the microphone toggle and the countdown delay dropdown. Follow the existing button pattern:

```tsx
{/* Camera Toggle */}
<Button
  size="icon"
  variant="ghost"
  className="h-7 w-7"
  onClick={() => setCameraEnabled(!cameraEnabled)}
  disabled={cameraDevices.length === 0 && !cameraEnabled}
  title={cameraEnabled ? t("recording.camera.disable") : t("recording.camera.enable")}
>
  {cameraEnabled ? <Camera className="h-3.5 w-3.5 text-green-400" /> : <CameraOff className="h-3.5 w-3.5" />}
</Button>

{/* Camera Device Selector (conditional) */}
{cameraEnabled && cameraDevices.length > 1 && (
  <select
    className="h-6 max-w-[100px] truncate rounded bg-white/10 px-1 text-[10px] text-white/80"
    value={cameraDeviceId}
    onChange={(e) => setCameraDeviceId(e.target.value)}
  >
    {cameraDevices.map((d) => (
      <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
    ))}
  </select>
)}
```

- [ ] **Step 4: Add camera preview row (above HUD bar)**

Add a conditional preview row, similar to the existing microphone controls row:

```tsx
{/* Camera Preview Row */}
{cameraEnabled && webcamRecorder.previewVisible && webcamRecorder.stream && (
  <div className="flex items-center gap-2">
    <video
      autoPlay
      muted
      playsInline
      ref={(el) => { if (el && webcamRecorder.stream) el.srcObject = webcamRecorder.stream; }}
      className="h-16 w-16 rounded-full object-cover border border-white/20"
    />
    <Button
      size="icon"
      variant="ghost"
      className="h-5 w-5"
      onClick={() => webcamRecorder.setPreviewVisible(false)}
      title={t("recording.camera.hidePreview")}
    >
      <FiX className="h-3 w-3" />
    </Button>
  </div>
)}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/launch/LaunchWindow.tsx
git commit -m "feat: add camera toggle, device selector, and preview to HUD overlay"
```

---

## Task 6: Project Persistence — Webcam Schema

**Files:**
- Modify: `src/components/video-editor/projectPersistence.ts`
- Modify: `src/components/video-editor/editorPreferences.ts`

- [ ] **Step 1: Add WebcamState type and extend ProjectEditorState**

```typescript
export interface WebcamState {
  path: string;
  visible: boolean;
  shape: "circle" | "rounded-rect" | "square";
  size: number;
  opacity: number;
  borderColor: string;
  borderWidth: number;
  shadow: number;
  position: { x: number; y: number };
}
```

Add to `ProjectEditorState`:
```typescript
webcam?: WebcamState;
```

- [ ] **Step 2: Add normalization in normalizeProjectEditor**

Add at the end of `normalizeProjectEditor`, before the return:

```typescript
let webcam: WebcamState | undefined;
if (editor.webcam && typeof editor.webcam === "object" && typeof (editor.webcam as any).path === "string" && (editor.webcam as any).path.length > 0) {
  const raw = editor.webcam as Record<string, unknown>;
  const validShapes = ["circle", "rounded-rect", "square"] as const;
  const rawShape = String(raw.shape ?? "");
  webcam = {
    path: String(raw.path),
    visible: typeof raw.visible === "boolean" ? raw.visible : true,
    shape: validShapes.includes(rawShape as any) ? (rawShape as WebcamState["shape"]) : "circle",
    size: isFiniteNumber(raw.size) ? clamp(raw.size as number, 50, 400) : 150,
    opacity: isFiniteNumber(raw.opacity) ? clamp(raw.opacity as number, 0, 100) : 100,
    borderColor: typeof raw.borderColor === "string" && /^#[0-9a-fA-F]{6}$/.test(raw.borderColor) ? raw.borderColor : "#ffffff",
    borderWidth: isFiniteNumber(raw.borderWidth) ? clamp(raw.borderWidth as number, 0, 8) : 2,
    shadow: isFiniteNumber(raw.shadow) ? clamp(raw.shadow as number, 0, 100) : 30,
    position: {
      x: isFiniteNumber((raw.position as any)?.x) ? clamp((raw.position as any).x, 0, 1) : 0.9,
      y: isFiniteNumber((raw.position as any)?.y) ? clamp((raw.position as any).y, 0, 1) : 0.85,
    },
  };
}
```

Include `webcam` in the return object.

- [ ] **Step 3: Add webcam defaults to editorPreferences.ts**

Add webcam fields to `PersistedEditorControls` pick type and `DEFAULT_EDITOR_PREFERENCES`.

- [ ] **Step 4: Commit**

```bash
git add src/components/video-editor/projectPersistence.ts src/components/video-editor/editorPreferences.ts
git commit -m "feat: add webcam schema and normalization to project persistence"
```

---

## Task 7: Editor State & WebcamPanel

**Files:**
- Create: `src/components/video-editor/WebcamPanel.tsx`
- Modify: `src/components/video-editor/VideoEditor.tsx`
- Modify: `src/components/video-editor/SettingsPanel.tsx`

- [ ] **Step 1: Add webcam state to VideoEditor.tsx**

Add useState hooks for all webcam properties (see spec). Initialize from loaded project data if webcam field exists.

```typescript
const [webcamPath, setWebcamPath] = useState<string | null>(null);
const [webcamVisible, setWebcamVisible] = useState(true);
const [webcamShape, setWebcamShape] = useState<"circle" | "rounded-rect" | "square">("circle");
const [webcamSize, setWebcamSize] = useState(150);
const [webcamOpacity, setWebcamOpacity] = useState(100);
const [webcamBorderColor, setWebcamBorderColor] = useState("#ffffff");
const [webcamBorderWidth, setWebcamBorderWidth] = useState(2);
const [webcamShadow, setWebcamShadow] = useState(30);
const [webcamPosition, setWebcamPosition] = useState({ x: 0.9, y: 0.85 });
```

When loading a project, populate from `project.editor.webcam` if present. When saving a project, include the webcam state.

- [ ] **Step 2: Create WebcamPanel.tsx**

An accordion-style panel matching the existing SettingsPanel sections. Uses the same component patterns: `SliderControl`, `Switch`, `ToggleGroup`, color picker.

```tsx
import { Camera } from "lucide-react";
import Block from "@uiw/react-color-block";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import SliderControl from "./SliderControl";
import { useI18n } from "@/contexts/I18nContext";

interface WebcamPanelProps {
  visible: boolean;
  setVisible: (v: boolean) => void;
  shape: "circle" | "rounded-rect" | "square";
  setShape: (s: "circle" | "rounded-rect" | "square") => void;
  size: number;
  setSize: (n: number) => void;
  opacity: number;
  setOpacity: (n: number) => void;
  borderColor: string;
  setBorderColor: (c: string) => void;
  borderWidth: number;
  setBorderWidth: (n: number) => void;
  shadow: number;
  setShadow: (n: number) => void;
}

export function WebcamPanel(props: WebcamPanelProps) {
  const { t } = useI18n();

  return (
    <AccordionItem value="camera" className="border-white/5">
      <AccordionTrigger className="px-3 py-2 text-xs font-medium text-white/70 hover:text-white/90">
        <span className="flex items-center gap-2">
          <Camera className="h-3.5 w-3.5" />
          {t("editor.camera.title", "Camera")}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3">
        <div className="space-y-3">
          {/* Visible Toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/60">{t("editor.camera.visible", "Show camera")}</span>
            <Switch checked={props.visible} onCheckedChange={props.setVisible} />
          </div>

          {/* Shape Selector */}
          <div>
            <span className="text-xs text-white/60">{t("editor.camera.shape", "Shape")}</span>
            <ToggleGroup type="single" value={props.shape} onValueChange={(v) => v && props.setShape(v as any)} className="mt-1">
              <ToggleGroupItem value="circle" className="text-xs">
                {t("editor.camera.shapeCircle", "Circle")}
              </ToggleGroupItem>
              <ToggleGroupItem value="rounded-rect" className="text-xs">
                {t("editor.camera.shapeRoundedRect", "Rounded")}
              </ToggleGroupItem>
              <ToggleGroupItem value="square" className="text-xs">
                {t("editor.camera.shapeSquare", "Square")}
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Size Slider */}
          <SliderControl label={t("editor.camera.size", "Size")} value={props.size} min={50} max={400} step={10} onChange={props.setSize} />

          {/* Opacity Slider */}
          <SliderControl label={t("editor.camera.opacity", "Opacity")} value={props.opacity} min={0} max={100} step={1} onChange={props.setOpacity} suffix="%" />

          {/* Border Color */}
          <div>
            <span className="text-xs text-white/60">{t("editor.camera.borderColor", "Border color")}</span>
            <Block color={props.borderColor} onChange={(c) => props.setBorderColor(c.hex)} className="mt-1" />
          </div>

          {/* Border Width Slider */}
          <SliderControl label={t("editor.camera.borderWidth", "Border width")} value={props.borderWidth} min={0} max={8} step={1} onChange={props.setBorderWidth} suffix="px" />

          {/* Shadow Slider */}
          <SliderControl label={t("editor.camera.shadow", "Shadow")} value={props.shadow} min={0} max={100} step={1} onChange={props.setShadow} suffix="%" />
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
```

- [ ] **Step 3: Add WebcamPanel to SettingsPanel.tsx**

Import `WebcamPanel` and add it as a new `AccordionItem` inside the existing `<Accordion>`, conditionally rendered when `webcamPath` is not null. Pass all webcam state props through from VideoEditor.

- [ ] **Step 4: Commit**

```bash
git add src/components/video-editor/WebcamPanel.tsx src/components/video-editor/VideoEditor.tsx src/components/video-editor/SettingsPanel.tsx
git commit -m "feat: add Camera accordion panel with shape/size/border/shadow controls"
```

---

## Task 8: WebcamOverlay — Draggable DOM Bubble

**Files:**
- Create: `src/components/video-editor/WebcamOverlay.tsx`
- Modify: `src/components/video-editor/VideoPlayback.tsx`

- [ ] **Step 1: Create WebcamOverlay.tsx**

A DOM element positioned absolutely over the PixiJS canvas. Uses `react-rnd` for drag. Follows the `AnnotationOverlay.tsx` pattern with normalized coordinates.

```tsx
import { useEffect, useRef } from "react";
import { Rnd } from "react-rnd";

interface WebcamOverlayProps {
  videoPath: string;
  currentTime: number;
  playing: boolean;
  containerWidth: number;
  containerHeight: number;
  visible: boolean;
  shape: "circle" | "rounded-rect" | "square";
  size: number;
  opacity: number;
  borderColor: string;
  borderWidth: number;
  shadow: number;
  position: { x: number; y: number };
  onPositionChange: (pos: { x: number; y: number }) => void;
}

export function WebcamOverlay(props: WebcamOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Sync playback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - props.currentTime) > 0.1) {
      video.currentTime = props.currentTime;
    }
  }, [props.currentTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (props.playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [props.playing]);

  if (!props.visible) return null;

  const pixelSize = props.size;
  const pixelX = props.position.x * props.containerWidth - pixelSize / 2;
  const pixelY = props.position.y * props.containerHeight - pixelSize / 2;

  const borderRadius = props.shape === "circle" ? "50%" : props.shape === "rounded-rect" ? "12px" : "0";

  return (
    <Rnd
      position={{ x: pixelX, y: pixelY }}
      size={{ width: pixelSize, height: pixelSize }}
      enableResizing={false}
      bounds="parent"
      onDragStop={(_e, d) => {
        const nx = (d.x + pixelSize / 2) / props.containerWidth;
        const ny = (d.y + pixelSize / 2) / props.containerHeight;
        props.onPositionChange({
          x: Math.max(0, Math.min(1, nx)),
          y: Math.max(0, Math.min(1, ny)),
        });
      }}
    >
      <div
        style={{
          width: pixelSize,
          height: pixelSize,
          borderRadius,
          overflow: "hidden",
          opacity: props.opacity / 100,
          border: props.borderWidth > 0 ? `${props.borderWidth}px solid ${props.borderColor}` : "none",
          boxShadow: props.shadow > 0 ? `0 ${props.shadow / 10}px ${props.shadow / 3}px rgba(0,0,0,${props.shadow / 100})` : "none",
          cursor: "grab",
        }}
      >
        <video
          ref={videoRef}
          src={`file://${props.videoPath}`}
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    </Rnd>
  );
}
```

- [ ] **Step 2: Mount WebcamOverlay in VideoPlayback.tsx**

Add the `WebcamOverlay` component inside the video canvas container div (the same parent that holds the PixiJS canvas and annotation overlay). Position it absolutely. Pass through all webcam props from VideoEditor, plus the current video playback state (currentTime, playing).

- [ ] **Step 3: Commit**

```bash
git add src/components/video-editor/WebcamOverlay.tsx src/components/video-editor/VideoPlayback.tsx
git commit -m "feat: add draggable webcam overlay on video canvas"
```

---

## Task 9: Export Pipeline — Webcam Compositing

**Files:**
- Modify: `src/lib/exporter/frameRenderer.ts`
- Modify: `src/lib/exporter/videoExporter.ts`
- Modify: `src/lib/exporter/gifExporter.ts`

- [ ] **Step 1: Extend FrameRenderer with webcam support**

Add optional webcam parameters to the renderer. In `frameRenderer.ts`:

- Add a `webcamSprite`, `webcamMask`, `webcamBorder` Graphics to the PixiJS scene (inside `cameraContainer`, after cursor).
- Add `setWebcamState(state: WebcamState | undefined)` method to configure visibility, shape, size, position, opacity, border, shadow.
- Add `updateWebcamTexture(videoElement: HTMLVideoElement)` method called per-frame to refresh the texture.
- For the mask: use `Graphics` filled shape (circle via `drawCircle`, rounded rect via `drawRoundedRect`, square via `drawRect`).
- For the border: use `Graphics` with `lineStyle` matching the mask shape.
- For the shadow: use `DropShadowFilter` from `pixi-filters`.
- If `webcamState` is undefined or `visible === false`, remove webcam sprite from scene.
- If the current frame timestamp exceeds webcam video duration, hide the webcam.

- [ ] **Step 2: Extend videoExporter.ts**

In the `VideoExporter` class:
- Accept optional `webcamVideoPath: string` in the export config.
- If present, create an `HTMLVideoElement` for the webcam video.
- Before each frame render, seek the webcam video to the current frame's timestamp and await the `seeked` event:

```typescript
async function seekVideo(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - timeSeconds) < 0.01) {
      resolve();
      return;
    }
    video.onseeked = () => resolve();
    video.currentTime = timeSeconds;
  });
}
```

- Pass the webcam video element to `FrameRenderer.updateWebcamTexture()` before each `renderFrame()` call.

- [ ] **Step 3: Extend gifExporter.ts**

Same pattern as videoExporter — accept optional webcam video path in `GifExporterConfig`, load video element, seek per frame, pass to FrameRenderer.

- [ ] **Step 4: Commit**

```bash
git add src/lib/exporter/frameRenderer.ts src/lib/exporter/videoExporter.ts src/lib/exporter/gifExporter.ts
git commit -m "feat: composite webcam into MP4 and GIF export pipeline"
```

---

## Task 10: Integration & Wiring

**Files:**
- Modify: `src/components/video-editor/VideoEditor.tsx`
- Modify: `src/hooks/useScreenRecorder.ts`

- [ ] **Step 1: Wire webcam path from recording to editor**

In `useScreenRecorder.ts`, after the webcam file is saved (both native and browser stop paths), store the path via IPC so the editor can retrieve it. In `VideoEditor.tsx`, on mount check for a webcam path and load it.

- [ ] **Step 2: Wire webcam state to project save/load**

In `VideoEditor.tsx`:
- When saving a project, include webcam state in the `ProjectEditorState`.
- When loading a project, restore webcam state from the loaded data.
- Pass webcam state to `SettingsPanel` (which renders `WebcamPanel`) and to `VideoPlayback` (which renders `WebcamOverlay`).

- [ ] **Step 3: Wire webcam state to export dialog**

In the export flow, pass `webcamPath` and webcam styling state through to the `VideoExporter` / `GifExporter` config.

- [ ] **Step 4: Test the full flow manually**

1. Open klipt, enable camera in HUD, start recording
2. Stop recording, verify editor opens with webcam overlay
3. Drag the webcam bubble, change shape/size/border in Camera panel
4. Save project, reopen, verify webcam state persists
5. Export to MP4, verify webcam is composited correctly
6. Export to GIF, verify webcam is composited correctly

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: wire webcam capture end-to-end — recording, editing, export"
```

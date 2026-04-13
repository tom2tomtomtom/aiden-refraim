# refrAIm UI Component Specification

Ports the Video Reformatter's editor/export UI into refrAIm's client architecture. Replaces browser-side FFmpeg/COCO-SSD processing with server API calls. Replaces Redux with React Context + hooks.

## Architecture Overview

```
client/src/
  contexts/
    AuthContext.tsx          (existing, unchanged)
    ApiContext.tsx            (existing, unchanged)
    VideoContext.tsx          (NEW)
    FocusPointsContext.tsx    (NEW)
    ScanContext.tsx           (NEW)
  pages/
    Dashboard.tsx            (MODIFY - add video cards with status)
    Login.tsx                (existing, unchanged)
    Editor.tsx               (NEW)
    Export.tsx                (NEW)
  components/
    Navbar.tsx               (MODIFY - add nav links, AIDEN styling)
    Toast.tsx                (existing, unchanged)
    VideoUpload.tsx          (MODIFY - AIDEN styling)
    VideoList.tsx            (MODIFY - video cards with thumbnails + status)
    ProcessingDialog.tsx     (existing, unchanged)
    editor/
      VideoPlayer.tsx        (NEW)
      VideoTimeline.tsx      (NEW)
      FocusSelector.tsx      (NEW)
      ScanReviewPanel.tsx    (NEW)
      ScanConfigPanel.tsx    (NEW)
    video/
      AspectRatioPreview.tsx (NEW)
      VideoExporter.tsx      (NEW)
  hooks/
    useActiveFocusPoint.ts   (NEW)
    usePollStatus.ts         (NEW)
  types/
    video.ts                 (NEW)
    focusPoint.ts            (NEW)
    scan.ts                  (NEW)
  App.tsx                    (MODIFY - add routes for /editor/:id, /export/:id)
```

---

## Shared Types

### `client/src/types/video.ts`

```typescript
export interface Video {
  id: string;
  user_id: string;
  original_url: string;
  status: 'pending' | 'uploading' | 'ready' | 'processing' | 'completed' | 'failed';
  platform_outputs: Record<string, PlatformOutput> | null;
  processing_metadata: {
    duration: number;
    fps: number;
    resolution: { width: number; height: number };
  } | null;
  title: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
  focus_points_count?: number;
}

export interface PlatformOutput {
  url: string;
  format: string;
  width: number;
  height: number;
  status: 'pending' | 'processing' | 'complete' | 'error';
  progress?: number;
  error?: string;
}

export type ExportQuality = 'low' | 'medium' | 'high';
```

### `client/src/types/focusPoint.ts`

```typescript
export interface FocusPoint {
  id: string;
  video_id: string;
  time_start: number;
  time_end: number;
  x: number;          // 0-100 percentage
  y: number;          // 0-100 percentage
  width: number;      // 0-100 percentage
  height: number;     // 0-100 percentage
  description: string;
  created_at?: string;
}

export interface FocusPointCreate {
  time_start: number;
  time_end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
}
```

### `client/src/types/scan.ts`

```typescript
export interface ScanOptions {
  interval?: number;            // seconds between frames, default 1.0
  min_score?: number;           // 0-1, default 0.5
  similarity_threshold?: number; // 0-1, default 0.6
  min_detections?: number;      // default 2
}

export interface ScanProgress {
  current_frame: number;
  total_frames: number;
  elapsed_time: number;
  estimated_time_remaining: number;
  percent_complete: number;
}

export interface Subject {
  id: string;
  class_name: string;
  first_seen: number;
  last_seen: number;
  positions: SubjectPosition[];
}

export interface SubjectPosition {
  time: number;
  bbox: [number, number, number, number]; // [x, y, width, height] in pixels
  score: number;
}

export type ScanStatus = 'idle' | 'scanning' | 'review' | 'finalizing';
```

---

## Context Providers

### `client/src/contexts/VideoContext.tsx`

Manages video playback state for the editor. Wraps Editor and Export pages only (not Dashboard).

```typescript
interface VideoContextValue {
  videoUrl: string | null;
  videoId: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (p: boolean) => void;
  setDuration: (d: number) => void;
  loadVideo: (id: string) => Promise<void>;  // calls GET /api/videos/:id
}
```

**State:** All local to the provider via `useState`.

**API calls:**
- `loadVideo(id)` calls `api.getVideo(id)` to fetch the video URL and metadata.

**Loading state:** While `loadVideo` is in progress, `videoUrl` is null. Components show a skeleton/spinner.

**Error state:** If `loadVideo` fails, stores error string. Components show error message with retry.

### `client/src/contexts/FocusPointsContext.tsx`

Manages focus points for the current video. Persists to server.

```typescript
interface FocusPointsContextValue {
  focusPoints: FocusPoint[];
  selectedPointId: string | null;
  isLoading: boolean;
  error: string | null;
  loadFocusPoints: (videoId: string) => Promise<void>;
  addFocusPoint: (fp: FocusPointCreate) => Promise<void>;
  addFocusPointsBatch: (fps: FocusPointCreate[]) => Promise<void>;
  updateFocusPoint: (id: string, fp: Partial<FocusPointCreate>) => void;
  removeFocusPoint: (id: string) => Promise<void>;
  setSelectedPoint: (id: string | null) => void;
  activeFocusPoint: FocusPoint | null;  // computed from currentTime via VideoContext
}
```

**State:** `focusPoints[]`, `selectedPointId`, `isLoading`, `error` via `useState`. `activeFocusPoint` is a `useMemo` that reads `currentTime` from `VideoContext`.

**API calls:**
- `loadFocusPoints(videoId)`: `GET /api/videos/:id/focus-points`
- `addFocusPoint(fp)`: `POST /api/videos/:id/focus-points` (single)
- `addFocusPointsBatch(fps)`: `POST /api/videos/:id/focus-points` with array body
- `removeFocusPoint(id)`: `DELETE /api/videos/:id/focus-points/:fpId`

**Depends on:** `VideoContext` for `videoId` and `currentTime`.

### `client/src/contexts/ScanContext.tsx`

Manages the scan workflow: start scan, poll progress, review subjects, finalize.

```typescript
interface ScanContextValue {
  scanStatus: ScanStatus;       // 'idle' | 'scanning' | 'review' | 'finalizing'
  progress: ScanProgress | null;
  detectedSubjects: Subject[];
  acceptedIds: Set<string>;
  rejectedIds: Set<string>;
  scanOptions: ScanOptions;
  setScanOptions: (opts: Partial<ScanOptions>) => void;
  startScan: () => Promise<void>;
  stopScan: () => void;
  acceptSubject: (id: string) => void;
  rejectSubject: (id: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  finalize: () => Promise<void>;
  cancelReview: () => void;
}
```

**State:** All local via `useState`. `acceptedIds`/`rejectedIds` are `Set<string>` stored as state.

**API calls:**
- `startScan()`: `POST /api/videos/:id/scan` with `scanOptions` body. Returns `{ scan_id }`.
- Poll loop: `GET /api/videos/:id/scan/:scanId/status` every 2s until `status === 'complete'`. Updates `progress`. On completion, sets `detectedSubjects` from response and moves to `'review'`.
- `stopScan()`: Clears the polling interval. Optionally `POST /api/videos/:id/scan/:scanId/cancel`.
- `finalize()`: Converts accepted subjects to `FocusPointCreate[]` and calls `FocusPointsContext.addFocusPointsBatch()`. Resets scan state to `'idle'`.

**Depends on:** `VideoContext` for `videoId` and `currentTime`. `FocusPointsContext` for `addFocusPointsBatch`.

---

## Hooks

### `client/src/hooks/useActiveFocusPoint.ts`

```typescript
function useActiveFocusPoint(
  focusPoints: FocusPoint[],
  currentTime: number
): FocusPoint | null
```

Returns the first focus point where `currentTime >= time_start && currentTime <= time_end`. Pure computation, no API calls.

### `client/src/hooks/usePollStatus.ts`

```typescript
function usePollStatus(
  pollFn: () => Promise<{ done: boolean; data: any }>,
  intervalMs: number,
  enabled: boolean
): { data: any; isPolling: boolean; error: string | null }
```

Generic polling hook. Calls `pollFn` every `intervalMs` while `enabled` is true. Stops when `done` is true or `enabled` becomes false. Used by ScanContext and Export page.

---

## API Client Extensions

Add these methods to the existing `ApiClient` class in `client/src/api.ts`:

```typescript
// Video details
async getVideo(id: string): Promise<Video>
// GET /api/videos/:id

// Focus points
async getFocusPoints(videoId: string): Promise<FocusPoint[]>
// GET /api/videos/:videoId/focus-points

async createFocusPoints(videoId: string, points: FocusPointCreate[]): Promise<FocusPoint[]>
// POST /api/videos/:videoId/focus-points
// Body: { focus_points: FocusPointCreate[] }

async deleteFocusPoint(videoId: string, pointId: string): Promise<void>
// DELETE /api/videos/:videoId/focus-points/:pointId

// Scanning
async startScan(videoId: string, options: ScanOptions): Promise<{ scan_id: string }>
// POST /api/videos/:videoId/scan

async getScanStatus(videoId: string, scanId: string): Promise<{
  status: 'pending' | 'scanning' | 'complete' | 'failed';
  progress: ScanProgress;
  subjects?: Subject[];
  error?: string;
}>
// GET /api/videos/:videoId/scan/:scanId/status

async cancelScan(videoId: string, scanId: string): Promise<void>
// POST /api/videos/:videoId/scan/:scanId/cancel

// Export / Processing
async processVideo(videoId: string, options: {
  platforms: string[];
  letterbox: boolean;
  quality: ExportQuality;
}): Promise<{ job_id: string }>
// POST /api/videos/:videoId/process

async getProcessingStatus(videoId: string): Promise<{
  status: string;
  platforms: Record<string, { status: string; progress: number; url?: string; error?: string }>;
}>
// GET /api/videos/:videoId/status

async getOutputDownloadUrl(videoId: string, platform: string): Promise<{ url: string }>
// GET /api/videos/:videoId/outputs/:platform
```

---

## Page Specifications

### App.tsx (MODIFY)

Add routes and context provider wrapping.

```typescript
// New routes inside <Routes>:
<Route path="/editor/:videoId" element={
  <PrivateRoute>
    <VideoProvider>
      <FocusPointsProvider>
        <ScanProvider>
          <Navbar />
          <Editor />
        </ScanProvider>
      </FocusPointsProvider>
    </VideoProvider>
  </PrivateRoute>
} />

<Route path="/export/:videoId" element={
  <PrivateRoute>
    <VideoProvider>
      <FocusPointsProvider>
        <Navbar />
        <ExportPage />
      </FocusPointsProvider>
    </VideoProvider>
  </PrivateRoute>
} />
```

### Dashboard.tsx (MODIFY)

**Changes from current:**
- Video cards show thumbnail (first frame from `original_url`), status badge, focus point count.
- Clicking a video card navigates to `/editor/:videoId`.
- "New Video" upload button uses AIDEN styling (bg-red-hot, uppercase, tracking-wide, no border-radius).
- Status badges: `pending` (orange-accent), `ready` (green), `processing` (pulsing orange-accent), `completed` (green), `failed` (red-hot).

**Loading state:** Skeleton cards (3 placeholder cards with pulse animation).

**Empty state:** Full-width panel with upload prompt.

**Error state:** Red banner with retry button.

### Editor.tsx (NEW)

**File:** `client/src/pages/Editor.tsx`

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ HEADER (via Navbar)                             │
├──────────────────────────┬──────────────────────┤
│ LEFT (lg:col-span-2)    │ RIGHT (lg:col-span-1)│
│                          │                      │
│ <VideoPlayer />          │ <AspectRatioPreview  │
│                          │   ratio="9:16" />    │
│ <VideoTimeline />        │ <AspectRatioPreview  │
│                          │   ratio="1:1" />     │
│ <FocusSelector />        │ <AspectRatioPreview  │
│                          │   ratio="4:5" />     │
│                          │                      │
│                          │ [Continue to Export]  │
└──────────────────────────┴──────────────────────┘
```

**Props:** None. Reads `videoId` from `useParams()`.

**State:** None locally. All state from VideoContext, FocusPointsContext, ScanContext.

**On mount:** Calls `videoContext.loadVideo(videoId)` and `focusPointsContext.loadFocusPoints(videoId)`.

**Loading state:** Full-page skeleton with video player placeholder (aspect-video bg-black-card) and sidebar placeholders.

**Error state:** If video not found, show error with "Back to Dashboard" button.

**Responsive:** Single column on mobile (video player, timeline, focus selector, then previews stacked). Two-column (2/3 + 1/3) on lg breakpoint.

### Export.tsx (NEW)

**File:** `client/src/pages/Export.tsx`

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ HEADER (via Navbar)                             │
├──────────────────────────┬──────────────────────┤
│ LEFT                     │ RIGHT                │
│ <VideoExporter />        │ Live Previews        │
│                          │ Letterbox + Fill      │
│                          │ for each ratio        │
│                          │                      │
│                          │ [Back to Editor]      │
└──────────────────────────┴──────────────────────┘
```

**Props:** None. Reads `videoId` from `useParams()`.

**On mount:** Loads video and focus points if not already loaded.

**Loading state:** Skeleton layout.

**Responsive:** Single column on mobile, two-column on lg.

---

## Component Specifications

### VideoPlayer

**File:** `client/src/components/editor/VideoPlayer.tsx`

**Props:**
```typescript
interface VideoPlayerProps {
  onVideoElementReady?: (el: HTMLVideoElement) => void;
}
```

**State (local):**
- `videoError: boolean`
- `isLoading: boolean`

**State (from context):**
- `videoUrl`, `currentTime`, `isPlaying`, `duration` from `VideoContext`

**Implementation:**
- Native HTML5 `<video>` element. No ReactPlayer dependency.
- `ref` on the `<video>` element for imperative control (seek, play/pause).
- Syncs `currentTime` to context via `onTimeUpdate` (throttled to 100ms via `requestAnimationFrame`).
- When `currentTime` changes externally (from timeline seek), seeks video if delta > 0.5s.
- When `isPlaying` changes externally, calls `video.play()` or `video.pause()`.
- Keyboard controls: Space/K = play/pause, Arrow Left/J = -5s, Arrow Right/L = +5s.
- Calls `onVideoElementReady` with the HTMLVideoElement ref after first load (needed by ScanReviewPanel thumbnails).

**Loading state:** Dark skeleton with "Loading video..." text over bg-black-card.

**Error state:** Red border panel with "Unable to load video" and retry button.

**Empty state:** bg-black-card panel with "No video loaded."

**Responsive:** Full width, maintains 16:9 aspect ratio via `aspect-video`.

**AIDEN styling:** `bg-black-ink`, no border-radius. Loading spinner uses `border-red-hot`.

### VideoTimeline

**File:** `client/src/components/editor/VideoTimeline.tsx`

**Props:**
```typescript
interface VideoTimelineProps {
  // No props. Reads from context.
}
```

**State (local):**
- `isDragging: boolean`

**State (from context):**
- `duration`, `currentTime`, `isPlaying` from `VideoContext`
- `focusPoints` from `FocusPointsContext`

**Implementation:**
- Timeline bar: `bg-black-card` container, `bg-red-hot` progress fill.
- Focus point markers: Yellow (`border-yellow-500`) vertical lines at `(time_start / duration) * 100%`.
- Current time cursor: White 2px line, draggable.
- Play/Pause button to the left of the timeline.
- Time display: `currentTime / duration` in `MM:SS` format, monospace font.
- Dragging: `onMouseDown` on cursor sets `isDragging`. `mousemove` on `window` updates `currentTime` via context. `mouseup` clears dragging.
- Keyboard (when timeline focused): ArrowRight +5s, ArrowLeft -5s, Home = 0, End = duration, Space = toggle play.

**Loading state:** Disabled timeline bar with 0:00 / 0:00.

**Empty state:** Same as loading (no focus points, empty bar).

**Responsive:** Full width of its container.

**AIDEN styling:** No border-radius on any elements. Text uses `text-white-muted`. Play button uses `bg-red-hot` with uppercase text.

### FocusSelector

**File:** `client/src/components/editor/FocusSelector.tsx`

**Props:**
```typescript
interface FocusSelectorProps {
  videoElement: HTMLVideoElement | null;
}
```

**State (local):**
- `detectError: string | null`

**State (from context):**
- `focusPoints`, `addFocusPoint` from `FocusPointsContext`
- `scanStatus`, `progress`, `detectedSubjects`, `startScan`, `stopScan` from `ScanContext`
- `videoId`, `currentTime`, `duration` from `VideoContext`

**Implementation:**
- "Detect Subjects" button: Calls `scanContext.startScan()` with single-frame mode (server scans one frame at current time).
- "Scan Entire Video" button: Calls `scanContext.startScan()` with full scan.
- While scanning: Shows `<ScanProgressPanel>` with progress bar and live stats.
- After scan completes: Shows `<ScanReviewPanel>` inline.
- Canvas overlay: Hidden `<canvas>` element. Not used for client-side detection (that's server-side now). Only used if manual focus point placement is added later.
- No browser-side COCO-SSD or TensorFlow. All detection is server-side.

**API calls (via ScanContext):**
- `POST /api/videos/:id/scan` to start
- `GET /api/videos/:id/scan/:scanId/status` to poll

**Loading state:** Buttons disabled with "Scanning..." text.

**Error state:** Red text below buttons with error message. "Reset" link to clear stuck states.

**Empty state:** Instructions text: "Click Detect Subjects to find subjects in the current frame, or Scan Entire Video to automatically detect subjects throughout."

**Responsive:** Full width. Button row wraps on small screens.

**AIDEN styling:** Buttons use `bg-red-hot` (detect) and `bg-orange-accent` (scan). Panel border: `border-border-subtle`. Uppercase headings.

### ScanReviewPanel

**File:** `client/src/components/editor/ScanReviewPanel.tsx`

**Props:**
```typescript
interface ScanReviewPanelProps {
  videoElement: HTMLVideoElement | null;
}
```

**State (local):** None significant. All state from ScanContext.

**State (from context):**
- `detectedSubjects`, `acceptedIds`, `rejectedIds`, `acceptSubject`, `rejectSubject`, `acceptAll`, `rejectAll`, `finalize`, `cancelReview` from `ScanContext`
- `setCurrentTime`, `setIsPlaying` from `VideoContext`

**Implementation:**
- Grid of `SubjectCard` components (1 col mobile, 2 col sm, 3 col md, 4 col lg).
- Each card shows: class name, frame count badge, time range, duration.
- Thumbnail: Uses `videoElement` to seek + canvas draw for frame capture. Same approach as original.
- Accept/Reject buttons per card. Accepted = orange-accent border. Rejected = red-hot border.
- Bulk action buttons: Accept All, Reject All, Finalize, Cancel.
- "Finalize" calls `scanContext.finalize()` which batch-creates focus points via API.
- Clicking thumbnail calls `setCurrentTime(subject.first_seen)` and `setIsPlaying(false)`.

**API calls (via ScanContext.finalize):**
- `POST /api/videos/:id/focus-points` with batch of accepted subjects converted to FocusPointCreate[].

**Loading state:** "Finalizing..." spinner on the Finalize button.

**Empty state:** "No subjects detected" message if subjects array is empty.

**AIDEN styling:** Card borders use `border-border-subtle`, accepted uses `border-orange-accent`, rejected uses `border-red-hot`. Badge uses `bg-black-deep text-orange-accent`.

### ScanConfigPanel

**File:** `client/src/components/editor/ScanConfigPanel.tsx`

**Props:**
```typescript
interface ScanConfigPanelProps {
  // No props. Reads/writes ScanContext.
}
```

**State (from context):**
- `scanOptions`, `setScanOptions` from `ScanContext`

**Implementation:**
- Collapsible panel (hidden by default, toggle with "Scan Settings" link).
- Fields: Interval (number input, 0.5-5.0), Min Score (range slider, 0.1-1.0), Similarity Threshold (range slider, 0.1-1.0), Min Detections (number input, 1-10).
- Changes call `setScanOptions({ field: value })`.

**AIDEN styling:** Inputs with `bg-black-card border-border-subtle`. Labels uppercase, `text-white-dim`.

### AspectRatioPreview

**File:** `client/src/components/video/AspectRatioPreview.tsx`

**Props:**
```typescript
interface AspectRatioPreviewProps {
  ratio: '9:16' | '1:1' | '4:5';
  width: number;
}
```

**State (from context):**
- `videoUrl` from `VideoContext`
- `activeFocusPoint`, `selectedPointId`, `focusPoints` from `FocusPointsContext`

**Implementation:**
- Shows two preview modes per ratio: "Fill and Crop" and "With Letterboxing".
- Fill mode: Uses CSS `object-fit: cover` with `object-position` calculated from the active focus point's x/y percentages.
- Letterbox mode: Uses CSS `object-fit: contain` on a black background.
- Each preview contains a `<video>` element (muted, no controls) synced to main player's `currentTime`.
- Alternatively, uses a static `<div>` with CSS background simulation for lighter weight. Decision: Use CSS-only simulation with a poster frame for performance. Full video sync is optional enhancement.

**Loading state:** Dark placeholder with ratio label.

**Empty state:** "Upload a video" text in placeholder.

**AIDEN styling:** Labels use `text-orange-accent uppercase`. Container has `border-border-subtle`.

### VideoExporter

**File:** `client/src/components/video/VideoExporter.tsx`

**Props:**
```typescript
interface VideoExporterProps {
  // No props. Reads from context.
}
```

**State (local):**
- `selectedPlatforms: string[]` (keys from OUTPUT_FORMATS)
- `useLetterboxing: boolean` (default true)
- `quality: ExportQuality` (default 'medium')
- `isExporting: boolean`
- `exportProgress: Record<string, { status: string; progress: number; url?: string; error?: string }>`
- `error: string | null`

**State (from context):**
- `videoId` from `VideoContext`
- `focusPoints` from `FocusPointsContext`

**Implementation:**
- Platform selection: Checkboxes for each platform from `OUTPUT_FORMATS` (instagram-story, instagram-feed-square, instagram-feed-portrait, facebook-story, facebook-feed, tiktok, youtube-main, youtube-shorts).
- Letterbox toggle: Two radio cards (Letterboxed vs Cropped).
- Quality selector: Three radio buttons (Low, Medium, High).
- Export button: Calls `api.processVideo(videoId, { platforms, letterbox, quality })`.
- After submitting: Polls `api.getProcessingStatus(videoId)` every 3s via `usePollStatus`.
- Per-platform progress bars with status text.
- When a platform completes, shows download link that calls `api.getOutputDownloadUrl(videoId, platform)`.
- No client-side FFmpeg. All processing is server-side.

**API calls:**
- `POST /api/videos/:id/process` to start export
- `GET /api/videos/:id/status` to poll progress (every 3s)
- `GET /api/videos/:id/outputs/:platform` to get download URLs

**Loading state:** Export button shows "Exporting..." with overall progress percentage. Per-platform progress bars.

**Error state:** Red banner with error message per platform.

**Empty state:** Platform list with nothing selected. Export button disabled.

**AIDEN styling:** Radio cards use `border-red-hot bg-black-deep` when selected, `border-border-subtle bg-black-card` when not. Progress bars use `bg-red-hot`. Export button: `bg-red-hot text-white uppercase font-bold tracking-wide`.

---

## Tailwind Theme Extension

Update `client/tailwind.config.cjs` to add the AIDEN design tokens:

```javascript
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        'black-ink': '#050505',
        'black-card': '#0f0f0f',
        'black-deep': '#0a0a0a',
        'red-hot': '#ff2e2e',
        'red-dim': '#cc2424',
        'orange-accent': '#ff6b00',
        'yellow-electric': '#facc15',
        'border-subtle': '#1a1a1a',
        'white-muted': 'rgba(255, 255, 255, 0.6)',
        'white-dim': 'rgba(255, 255, 255, 0.4)',
      },
      borderRadius: {
        DEFAULT: '0px',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
```

Apply globally in `index.css`:

```css
body {
  background-color: #050505;
  color: rgba(255, 255, 255, 0.6);
  background-image:
    linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 20px 20px;
}

* {
  border-radius: 0 !important;
}
```

---

## Navbar Modifications

**File:** `client/src/components/Navbar.tsx`

**Changes:**
- Background: `bg-black-card` instead of `bg-gray-800`.
- Logo: "AIDEN // REFORMATTER" in uppercase, `text-red-hot`, `tracking-widest`.
- Add nav links: Dashboard, Editor (if on editor/export page), Export (if on export page).
- Active link: `text-red-hot`. Inactive: `text-white-dim hover:text-white-muted`.
- User email and Logout button. Logout button: `border-2 border-red-hot text-red-hot hover:bg-red-hot hover:text-white`.

---

## Data Flow Summary

```
Dashboard
  GET /api/videos         -> VideoList (cards with status)
  POST /api/videos/upload -> Upload flow, redirect to /editor/:id

Editor (/editor/:videoId)
  GET /api/videos/:id                    -> VideoContext.loadVideo
  GET /api/videos/:id/focus-points       -> FocusPointsContext.loadFocusPoints
  POST /api/videos/:id/scan              -> ScanContext.startScan
  GET /api/videos/:id/scan/:sid/status   -> ScanContext poll loop
  POST /api/videos/:id/focus-points      -> FocusPointsContext.addFocusPointsBatch (on finalize)
  DELETE /api/videos/:id/focus-points/:fp -> FocusPointsContext.removeFocusPoint

Export (/export/:videoId)
  POST /api/videos/:id/process           -> VideoExporter.handleExport
  GET /api/videos/:id/status             -> VideoExporter poll loop
  GET /api/videos/:id/outputs/:platform  -> Download link
```

---

## Key Differences from Video Reformatter

| Aspect | Video Reformatter (browser) | refrAIm (server-backed) |
|--------|---------------------------|------------------------|
| State management | Redux (5 slices) | React Context (3 providers) |
| Video player | ReactPlayer | Native `<video>` element |
| Subject detection | Browser-side COCO-SSD/TensorFlow | Server-side via API |
| Video scanning | Browser-side frame-by-frame | Server-side, poll for progress |
| Export/transcode | Browser-side FFmpeg.wasm | Server-side FFmpeg, poll + download |
| Focus points | In-memory Redux only | Persisted to Supabase via API |
| Auth | None | Supabase auth with Bearer JWT |
| Video storage | Browser object URLs | Supabase Storage, signed URLs |
| Design system | AIDEN dark brutalist | Same (ported) |

## Implementation Order

1. Tailwind theme + global styles
2. Shared types (`types/`)
3. API client extensions
4. VideoContext + FocusPointsContext
5. VideoPlayer + VideoTimeline
6. AspectRatioPreview
7. Editor page (wiring)
8. ScanContext + usePollStatus
9. FocusSelector + ScanReviewPanel + ScanConfigPanel
10. VideoExporter
11. Export page (wiring)
12. Dashboard modifications (video cards, AIDEN styling)
13. Navbar updates
14. App.tsx route additions

# refrAIm Port Specification

## Overview

Port the Video Reformatter's UI (focus point editor, AI detection, multi-segment export, aspect ratio previews, AIDEN design system) into refrAIm's server-side architecture (server-side FFmpeg, Supabase auth/storage, platform-specific formats). The result is a cloud-backed video reformatting tool where all processing happens server-side, focus points persist to the database, and users authenticate via Supabase.

## Source Repos
- UI source: `~/video-reformatter` (Vite + React, browser-side FFmpeg WASM, Redux, TensorFlow.js COCO-SSD)
- Target: `~/refraim` (Express server + React client, server-side FFmpeg, Supabase)

## Architecture Decision Record

| Aspect | Browser (was) | Server (now) |
|--------|--------------|--------------|
| State management | Redux (5 slices) | React Context (3 providers) |
| Video player | ReactPlayer | Native `<video>` element |
| Subject detection | Browser COCO-SSD/TensorFlow | Server-side via API |
| Export/transcode | FFmpeg WASM | Server-side FFmpeg CLI |
| Focus points | In-memory Redux | Persisted to Supabase |
| Auth | None | Supabase JWT |
| Storage | Browser object URLs | Supabase Storage |
| Design system | AIDEN dark brutalist | Same (ported) |

---

## Detailed specs (separate files)

- **API Endpoints**: See `API_SPEC.md` (14 endpoints: 6 existing, 8 new)
- **Database Schema**: See migration `supabase/migrations/20260412_focus_points_scan_jobs_projects.sql` (3 new tables: focus_points, scan_jobs, projects)
- **UI Components**: See `UI_COMPONENT_SPEC.md` (3 contexts, 7 new components, 2 hooks, 3 type files)

---

## Execution Waves

### Wave 1: Foundation (parallel tasks, no dependencies)

| Task | Files | Description |
|------|-------|-------------|
| 1a. Tailwind + Global CSS | `client/tailwind.config.cjs`, `client/src/index.css` | AIDEN design tokens, grid background, zero border-radius |
| 1b. Shared types | `client/src/types/video.ts`, `focusPoint.ts`, `scan.ts` | TypeScript interfaces matching API spec |
| 1c. DB migration | `supabase/migrations/20260412_*.sql` | Already written. Run against Supabase. |
| 1d. API client extensions | `client/src/api.ts` | Add 9 new methods to ApiClient class |

### Wave 2: Server endpoints (parallel, depends on Wave 1c)

| Task | Files | Description |
|------|-------|-------------|
| 2a. Focus points CRUD | `server/src/routes/focusPointRoutes.ts`, `server/src/controllers/focusPointController.ts` | 5 endpoints: list, batch create, update, delete one, delete all |
| 2b. Scan endpoints | `server/src/routes/scanRoutes.ts`, `server/src/controllers/scanController.ts`, `server/src/services/scanService.ts` | Start scan (async), poll status. Server-side frame extraction + object detection |
| 2c. Enhanced processing | Modify `server/src/services/videoProcessingService.ts`, `server/src/services/ffmpegService.ts` | Read focus points from DB, build segments, per-segment crop, concat |
| 2d. Download endpoint | `server/src/routes/videoRoutes.ts` | GET /api/videos/:id/outputs/:platform |

### Wave 3: Client contexts + core components (parallel, depends on Wave 1)

| Task | Files | Description |
|------|-------|-------------|
| 3a. VideoContext | `client/src/contexts/VideoContext.tsx` | Playback state, loadVideo from API |
| 3b. FocusPointsContext | `client/src/contexts/FocusPointsContext.tsx` | CRUD focus points via API, activeFocusPoint |
| 3c. VideoPlayer | `client/src/components/editor/VideoPlayer.tsx` | Native `<video>`, keyboard controls, time sync |
| 3d. VideoTimeline | `client/src/components/editor/VideoTimeline.tsx` | Scrubber, focus point markers, play/pause |
| 3e. AspectRatioPreview | `client/src/components/video/AspectRatioPreview.tsx` | CSS-based crop preview for 9:16, 1:1, 4:5 |
| 3f. Hooks | `client/src/hooks/useActiveFocusPoint.ts`, `usePollStatus.ts` | Active focus point lookup, generic polling |

### Wave 4: Scan + Export (depends on Wave 2 + 3)

| Task | Files | Description |
|------|-------|-------------|
| 4a. ScanContext | `client/src/contexts/ScanContext.tsx` | Start scan, poll, review state, finalize |
| 4b. FocusSelector | `client/src/components/editor/FocusSelector.tsx` | Detect/Scan buttons, progress display |
| 4c. ScanReviewPanel | `client/src/components/editor/ScanReviewPanel.tsx` | Subject cards with thumbnails, accept/reject/finalize |
| 4d. ScanConfigPanel | `client/src/components/editor/ScanConfigPanel.tsx` | Detection parameter inputs |
| 4e. VideoExporter | `client/src/components/video/VideoExporter.tsx` | Platform checkboxes, letterbox toggle, quality, server-side export |

### Wave 5: Pages + Wiring (depends on Wave 3 + 4)

| Task | Files | Description |
|------|-------|-------------|
| 5a. Editor page | `client/src/pages/Editor.tsx` | Compose VideoPlayer + Timeline + FocusSelector + Previews |
| 5b. Export page | `client/src/pages/Export.tsx` | Compose VideoExporter + Previews |
| 5c. Dashboard updates | `client/src/pages/Dashboard.tsx`, `client/src/components/VideoList.tsx` | Video cards with status, AIDEN styling |
| 5d. Navbar + App routing | `client/src/components/Navbar.tsx`, `client/src/App.tsx` | Nav links, /editor/:id and /export/:id routes |

### Wave 6: Deploy (depends on all)

| Task | Files | Description |
|------|-------|-------------|
| 6a. Dockerfile | `Dockerfile` (server), `client/Dockerfile` or combined | Multi-stage build for server + client |
| 6b. Railway config | `railway.toml` | Service config, health check, env vars |
| 6c. DNS | GoDaddy API | CNAME: reformatter.aiden.services |
| 6d. Supabase setup | CLI | Create project, run migrations, configure auth |

---

## Server-Side Object Detection Approach

The browser-based COCO-SSD (TensorFlow.js) needs a server equivalent. Options:

**Option A: FFmpeg scene/motion analysis (what refrAIm already has)**
- Uses FFmpeg's `select` filter for scene detection and motion estimation
- No ML model needed, fast, works with any video
- Less accurate than COCO-SSD (detects motion regions, not specific objects)
- Already implemented in `server/src/services/videoAnalysisService.ts`

**Option B: Python COCO-SSD via subprocess**
- Run a Python script with TensorFlow/PyTorch for real object detection
- Same accuracy as browser version
- Requires Python + ML dependencies on the server
- Slower to set up, heavier deployment

**Option C: ONNX Runtime in Node.js**
- Run COCO-SSD model directly in Node.js via `onnxruntime-node`
- No Python dependency
- Requires model conversion to ONNX format
- Moderate complexity

**Recommended: Option A for MVP, Option B/C as enhancement.**
The FFmpeg motion analysis already works and gives decent focus regions. Ship with that, then add ML-based detection as a premium feature.

---

## Key Data Contracts

### Focus Point (client <-> server)

```typescript
// API response / DB row
interface FocusPoint {
  id: string;
  video_id: string;
  time_start: number;    // seconds
  time_end: number;
  x: number;             // 0-100 percentage
  y: number;             // 0-100 percentage
  width: number;         // 0-100 percentage
  height: number;        // 0-100 percentage
  description: string;
  source: 'manual' | 'ai_detection';
  created_at: string;
  updated_at: string;
}
```

### Segment (server internal, for FFmpeg processing)

```typescript
// Built from focus points, used by FFmpegService
interface CropSegment {
  start_time: number;
  end_time: number;
  focus_x: number;    // 0-1 (converted from 0-100)
  focus_y: number;    // 0-1
  label: string;
}
```

### Export Flow (server)

```
1. Read focus_points from DB for video_id, ordered by time_start
2. Build CropSegment[] timeline (fill gaps with center-crop)
3. For each platform:
   a. Get target dimensions from OUTPUT_FORMATS
   b. For each segment:
      - ffmpeg -i input.mp4 -ss {start} -to {end} -vf "crop=...,scale=..." seg_N.mp4
   c. Write concat list, ffmpeg -f concat output.mp4
   d. Upload to Supabase Storage
   e. Update platform_outputs JSONB on video record
```

---

## Testing Plan

### Server
- Unit: Focus point validation (bounds, time ranges)
- Unit: Segment builder (gap filling, overlap handling, edge cases)
- Unit: FFmpeg filter chain generation (crop params, letterbox params)
- Integration: Focus points CRUD endpoints with test DB
- Integration: Process endpoint with sample video file

### Client
- Unit: useActiveFocusPoint hook (time range matching)
- Unit: usePollStatus hook (polling lifecycle)
- Component: ScanReviewPanel (accept/reject state, finalize flow)
- E2E: Upload video -> Editor -> Scan -> Accept -> Export -> Download

---

## Open Questions (resolved)

1. **Focus point storage**: Separate `focus_points` table (chosen for query flexibility)
2. **Temporal transitions**: Hard cuts between segments (chosen for reliability)
3. **Object detection**: FFmpeg motion analysis for MVP (chosen for deployment simplicity)
4. **State management**: React Context (chosen to match refrAIm's existing pattern)

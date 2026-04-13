# Port Client-Side Scanning to refrAIm

## Problem
refrAIm's server-side scanning is a black box. No visual feedback, no yellow bounding boxes, previews don't play. The Video Reformatter's browser-based scanning was visually superior.

## Solution
Port TensorFlow.js COCO-SSD detection from Video Reformatter to refrAIm's client. Keep server-side FFmpeg for export. Client does detection, server does encoding.

## What to Port from ~/video-reformatter/src/

### Services (copy and adapt)
1. `services/SubjectDetectionService.ts` - COCO-SSD model loading + frame detection
2. `services/VideoScannerService.ts` - Frame-by-frame scanning with IoU tracking

### Key Changes from Video Reformatter
- Remove Redux dependencies, use refrAIm's React Context
- Subject results save to server via API (POST /api/videos/:id/focus-points)
- Keep the canvas overlay for yellow bounding boxes during scan

## Implementation

### 1. Install TensorFlow.js in client
```bash
cd ~/refraim/client && npm install @tensorflow/tfjs @tensorflow-models/coco-ssd
```

### 2. Create client/src/services/SubjectDetectionService.ts
Copy from video-reformatter, remove Redux imports. Keep:
- `loadModel()` - lazy loads COCO-SSD
- `detectObjects(canvas)` - returns DetectedObject[]
- Yellow bbox drawing on canvas

### 3. Create client/src/services/VideoScannerService.ts  
Copy from video-reformatter, adapt:
- `scanVideo(videoElement, options)` - samples frames, runs detection
- IoU tracking across frames
- Returns Subject[] with positions and time ranges
- Emits progress + live detection events via callbacks

### 4. Update FocusSelector.tsx
- Add hidden canvas element for frame capture
- On "Scan Video" click: run client-side scan (not server API)
- Show canvas with yellow bounding boxes during scan (like video-reformatter)
- Show live detection stats (objects in frame, subjects tracked)
- On completion: enter review mode with detected subjects

### 5. Update ScanContext.tsx
- Replace server scan API calls with client-side scanner
- Keep the same state shape (scanStatus, progress, detectedSubjects)
- Finalize still saves to server via POST /api/videos/:id/focus-points

### 6. Fix AspectRatioPreview.tsx
- Sync preview videos with main player currentTime
- Play/pause previews when main player plays/pauses
- Use requestAnimationFrame for smooth sync

### 7. Add scan polling timeout
- Max 2 minutes for any scan operation
- Auto-cancel and show error if exceeded

## Files to Create/Modify
- CREATE: client/src/services/SubjectDetectionService.ts
- CREATE: client/src/services/VideoScannerService.ts
- MODIFY: client/src/components/editor/FocusSelector.tsx (major rewrite)
- MODIFY: client/src/contexts/ScanContext.tsx (switch to client-side)
- MODIFY: client/src/components/video/AspectRatioPreview.tsx (sync playback)
- MODIFY: client/package.json (add tensorflow deps)

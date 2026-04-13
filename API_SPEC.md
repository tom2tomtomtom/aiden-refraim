# refrAIm API Specification

Base path: `/api/videos`
Auth: All endpoints require `requireAuth` middleware. User ID extracted from `(req as any).user.id`.

## Common Types

```typescript
// Standard error response (all endpoints)
interface ErrorResponse {
  error: string;
  details?: string;
}

// Existing video record from DB
interface Video {
  id: string;
  user_id: string;
  original_url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  platform_outputs: Record<string, string>;
  title: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}
```

---

## Existing Endpoints (unchanged)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/videos/upload` | Upload video + platforms |
| GET | `/api/videos` | List user's videos |
| GET | `/api/videos/:id` | Get single video |
| DELETE | `/api/videos/:id` | Delete video |
| GET | `/api/videos/:id/status` | Check processing status |

---

## New Endpoints

### 1. Focus Points

```typescript
interface FocusPoint {
  id: string;
  video_id: string;
  time_start: number;     // seconds
  time_end: number;       // seconds
  x: number;              // 0-100 percentage
  y: number;              // 0-100 percentage
  width: number;          // 0-100 percentage
  height: number;         // 0-100 percentage
  description: string;    // label ("person", "dog", etc.)
  source: 'manual' | 'ai_detection';
  created_at: string;
  updated_at: string;
}
```

#### GET `/api/videos/:id/focus-points`

List all focus points for a video.

| Field | Value |
|-------|-------|
| Auth | Required |
| Params | `id` - video UUID |
| Request body | None |
| Query params | None |

**Response 200:**
```typescript
interface ListFocusPointsResponse {
  focus_points: FocusPoint[];
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 401 | Missing or invalid auth |
| 404 | Video not found or not owned by user |
| 500 | Database error |

**Validation:**
- Video must exist and belong to authenticated user.

---

#### POST `/api/videos/:id/focus-points`

Create one or more focus points (batch).

| Field | Value |
|-------|-------|
| Auth | Required |
| Params | `id` - video UUID |
| Content-Type | `application/json` |

**Request body:**
```typescript
interface CreateFocusPointsRequest {
  focus_points: Array<{
    time_start: number;
    time_end: number;
    x: number;
    y: number;
    width: number;
    height: number;
    description: string;
    source: 'manual' | 'ai_detection';
  }>;
}
```

**Response 201:**
```typescript
interface CreateFocusPointsResponse {
  focus_points: FocusPoint[];
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Missing required fields, invalid ranges, empty array |
| 401 | Missing or invalid auth |
| 404 | Video not found or not owned by user |
| 500 | Database error |

**Validation:**
- `focus_points` array must be non-empty, max 100 items per batch.
- `time_start` >= 0, `time_end` > `time_start`.
- `x`, `y`, `width`, `height` each 0-100.
- `x + width` <= 100, `y + height` <= 100.
- `source` must be `'manual'` or `'ai_detection'`.
- `description` must be a non-empty string, max 255 characters.

---

#### PUT `/api/videos/:id/focus-points/:fpId`

Update a single focus point.

| Field | Value |
|-------|-------|
| Auth | Required |
| Params | `id` - video UUID, `fpId` - focus point UUID |
| Content-Type | `application/json` |

**Request body (all fields optional):**
```typescript
interface UpdateFocusPointRequest {
  time_start?: number;
  time_end?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  description?: string;
  source?: 'manual' | 'ai_detection';
}
```

**Response 200:**
```typescript
interface UpdateFocusPointResponse {
  focus_point: FocusPoint;
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Invalid field values, empty body |
| 401 | Missing or invalid auth |
| 404 | Video or focus point not found, or not owned by user |
| 500 | Database error |

**Validation:**
- Same range rules as POST, applied only to provided fields.
- If both `time_start` and `time_end` provided, `time_end` > `time_start`.
- If only one time field provided, validate against the existing stored value.

---

#### DELETE `/api/videos/:id/focus-points/:fpId`

Delete a single focus point.

| Field | Value |
|-------|-------|
| Auth | Required |
| Params | `id` - video UUID, `fpId` - focus point UUID |
| Request body | None |

**Response 200:**
```typescript
interface DeleteFocusPointResponse {
  deleted: true;
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 401 | Missing or invalid auth |
| 404 | Video or focus point not found, or not owned by user |
| 500 | Database error |

---

#### DELETE `/api/videos/:id/focus-points`

Delete all focus points for a video. Used when resetting or re-scanning.

| Field | Value |
|-------|-------|
| Auth | Required |
| Params | `id` - video UUID |
| Request body | None |

**Response 200:**
```typescript
interface DeleteAllFocusPointsResponse {
  deleted_count: number;
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 401 | Missing or invalid auth |
| 404 | Video not found or not owned by user |
| 500 | Database error |

---

### 2. AI Detection / Video Scan

```typescript
interface Subject {
  id: string;
  class: string;           // e.g. "person", "dog", "car"
  first_seen: number;       // seconds
  last_seen: number;        // seconds
  positions: Array<{
    time: number;           // seconds
    bbox: [number, number, number, number]; // [x, y, width, height] as 0-100
    score: number;          // 0-1 confidence
  }>;
}

interface ScanJob {
  id: string;
  video_id: string;
  status: 'scanning' | 'completed' | 'failed';
  progress: number;         // 0-100
  subjects: Subject[] | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
```

#### POST `/api/videos/:id/scan`

Start an async video scan job. Replaces browser-side TensorFlow.js detection.

| Field | Value |
|-------|-------|
| Auth | Required |
| Params | `id` - video UUID |
| Content-Type | `application/json` |

**Request body (all fields optional):**
```typescript
interface StartScanRequest {
  interval?: number;              // seconds between sampled frames, default 1.0
  min_score?: number;             // minimum detection confidence 0-1, default 0.5
  similarity_threshold?: number;  // how close bboxes must be to merge into same subject 0-1, default 0.3
  min_detections?: number;        // minimum frame appearances to keep a subject, default 3
}
```

**Response 202:**
```typescript
interface StartScanResponse {
  scan_id: string;
  status: 'scanning';
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Video status is not 'pending' or 'completed' (no source file available). Invalid parameter values. |
| 401 | Missing or invalid auth |
| 404 | Video not found or not owned by user |
| 409 | A scan is already in progress for this video |
| 500 | Failed to start scan job |

**Validation:**
- `interval` > 0, max 60.
- `min_score` 0-1.
- `similarity_threshold` 0-1.
- `min_detections` >= 1, max 100.
- Only one active scan per video at a time.

---

#### GET `/api/videos/:id/scan/:scanId/status`

Poll scan job progress.

| Field | Value |
|-------|-------|
| Auth | Required |
| Params | `id` - video UUID, `scanId` - scan job UUID |
| Request body | None |

**Response 200 (scanning):**
```typescript
interface ScanStatusResponse {
  status: 'scanning';
  progress: number;        // 0-100
  subjects?: undefined;
}
```

**Response 200 (completed):**
```typescript
interface ScanStatusResponse {
  status: 'completed';
  progress: 100;
  subjects: Subject[];
}
```

**Response 200 (failed):**
```typescript
interface ScanStatusResponse {
  status: 'failed';
  progress: number;
  error_message: string;
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 401 | Missing or invalid auth |
| 404 | Video or scan job not found, or not owned by user |
| 500 | Database error |

---

### 3. Enhanced Processing

#### POST `/api/videos/:id/process`

Trigger video processing with focus-point-aware cropping. Replaces the existing simple processing endpoint.

| Field | Value |
|-------|-------|
| Auth | Required |
| Params | `id` - video UUID |
| Content-Type | `application/json` |

**Request body:**
```typescript
interface ProcessVideoRequest {
  platforms: string[];               // e.g. ["youtube", "instagram", "tiktok"]
  letterbox?: boolean;               // pad instead of crop, default false
  quality?: 'low' | 'medium' | 'high'; // encoding quality, default 'medium'
}
```

**Processing logic:**
1. Read focus points from DB for the given video.
2. Build time segments from focus point time ranges.
3. For each platform, compute target aspect ratio.
4. For each segment, apply crop/letterbox centered on the focus point coordinates.
5. Gaps between focus points use center-crop (default behavior).
6. Concatenate processed segments into final output per platform.
7. Upload outputs to storage, update `platform_outputs` on the video record.

**Response 202:**
```typescript
interface ProcessVideoResponse {
  job_id: string;
  status: 'processing';
  platforms: string[];
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 400 | Missing or empty `platforms`, invalid platform value, invalid quality value |
| 401 | Missing or invalid auth |
| 404 | Video not found or not owned by user |
| 409 | Video is already being processed |
| 500 | Failed to start processing job |

**Validation:**
- `platforms` must be a non-empty array. Valid values: `youtube`, `instagram`, `tiktok`.
- `quality` must be `'low'`, `'medium'`, or `'high'` if provided.
- Video must have a valid `original_url` (source file must exist in storage).

---

### 4. Processed Video Download

#### GET `/api/videos/:id/outputs/:platform`

Get a download URL for a processed video output.

| Field | Value |
|-------|-------|
| Auth | Required |
| Params | `id` - video UUID, `platform` - platform key |
| Request body | None |

**Response 200:**
```typescript
interface GetOutputResponse {
  url: string;          // signed download URL
  platform: string;
  expires_in: number;   // seconds until URL expires
  file_size: number;    // bytes
}
```

**Errors:**

| Status | Condition |
|--------|-----------|
| 401 | Missing or invalid auth |
| 404 | Video not found, not owned by user, or no output exists for the requested platform |
| 500 | Failed to generate download URL |

**Validation:**
- `platform` must be a valid platform key (`youtube`, `instagram`, `tiktok`).
- Video must have a completed processing job with an output for the requested platform in `platform_outputs`.

---

## Database Schema (new tables)

### `focus_points`

```sql
CREATE TABLE focus_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  time_start NUMERIC NOT NULL,
  time_end NUMERIC NOT NULL,
  x NUMERIC NOT NULL CHECK (x >= 0 AND x <= 100),
  y NUMERIC NOT NULL CHECK (y >= 0 AND y <= 100),
  width NUMERIC NOT NULL CHECK (width >= 0 AND width <= 100),
  height NUMERIC NOT NULL CHECK (height >= 0 AND height <= 100),
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('manual', 'ai_detection')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (time_end > time_start),
  CHECK (x + width <= 100),
  CHECK (y + height <= 100)
);

CREATE INDEX idx_focus_points_video_id ON focus_points(video_id);
CREATE INDEX idx_focus_points_time ON focus_points(video_id, time_start, time_end);

-- RLS
ALTER TABLE focus_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage focus points for their own videos"
  ON focus_points FOR ALL
  USING (video_id IN (SELECT id FROM videos WHERE user_id = auth.uid()));
```

### `scan_jobs`

```sql
CREATE TABLE scan_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'scanning' CHECK (status IN ('scanning', 'completed', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  config JSONB NOT NULL DEFAULT '{}',
  subjects JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scan_jobs_video_id ON scan_jobs(video_id);
CREATE INDEX idx_scan_jobs_status ON scan_jobs(video_id, status);
```

---

## Endpoint Summary

| Method | Path | Status | Description |
|--------|------|--------|-------------|
| GET | `/api/videos` | Existing | List user's videos |
| POST | `/api/videos/upload` | Existing | Upload video |
| GET | `/api/videos/:id` | Existing | Get video |
| DELETE | `/api/videos/:id` | Existing | Delete video |
| GET | `/api/videos/:id/status` | Existing | Processing status |
| POST | `/api/videos/:id/process` | **Modified** | Process with focus points + letterbox + quality |
| GET | `/api/videos/:id/focus-points` | **New** | List focus points |
| POST | `/api/videos/:id/focus-points` | **New** | Create focus point(s) |
| PUT | `/api/videos/:id/focus-points/:fpId` | **New** | Update focus point |
| DELETE | `/api/videos/:id/focus-points/:fpId` | **New** | Delete focus point |
| DELETE | `/api/videos/:id/focus-points` | **New** | Delete all focus points |
| POST | `/api/videos/:id/scan` | **New** | Start AI scan |
| GET | `/api/videos/:id/scan/:scanId/status` | **New** | Poll scan progress |
| GET | `/api/videos/:id/outputs/:platform` | **New** | Download processed output |

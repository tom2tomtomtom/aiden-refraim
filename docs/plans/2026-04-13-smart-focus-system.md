# Smart Focus System Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Transform the focus point system from static single-position detection into a smart, interpolated, AI-assisted editor that tracks moving subjects and makes intelligent framing decisions.

**Architecture:** 4-layer system: (1) existing COCO-SSD detection stays, (2) new interpolation engine creates smooth tracking from multiple detected positions, (3) manual editing overlay lets users click/drag to create and adjust focus points, (4) AI editor agent analyzes scan data and returns composition-aware focus strategies via server-side LLM call.

**Tech Stack:** TensorFlow.js (existing), TypeScript, React, Supabase, Claude API (server-side)

**DB Constraint:** The `focus_points` table has fixed columns `(time_start, time_end, x, y, width, height, description, source, position_order)` with `source IN ('manual', 'ai_detection')`. No schema changes needed -- we create multiple consecutive focus points per subject and use `position_order` to enable interpolation.

---

## Phase 1: Smart Interpolation

### Task 1.1: Create FocusInterpolationService

**Files:**
- Create: `client/src/services/FocusInterpolationService.ts`

Core interpolation engine. Given sorted focus points and a current time, returns smoothly interpolated x/y/width/height.

Key behaviors:
- Find two bracketing focus points for current time
- Linear interpolation (lerp) between them based on time position
- Before first point: use first point's values
- After last point: use last point's values
- Single point: return it directly
- Group by description (subject name) for multi-subject support

### Task 1.2: Rewrite finalize() to create segmented focus points

**Files:**
- Modify: `client/src/components/editor/FocusSelector.tsx` (finalize function ~L292-331)

Instead of using only `positions[0]`, segment each subject's positions into 2-second windows and create one focus point per window using averaged position within that window.

For a subject detected at t=0,1,2,3,4,5,6,7,8:
- Focus point 1: time_start=0, time_end=2, x/y = avg of positions at t=0,1,2
- Focus point 2: time_start=2, time_end=4, x/y = avg of positions at t=2,3,4
- Focus point 3: time_start=4, time_end=6, x/y = avg of positions at t=4,5,6
- etc.

Use `position_order` to sequence them. Use `description` to identify the subject.

### Task 1.3: Replace useActiveFocusPoint with interpolation

**Files:**
- Modify: `client/src/hooks/useActiveFocusPoint.ts`

Replace the simple `.find()` with interpolation-aware lookup using FocusInterpolationService.

### Task 1.4: Update AspectRatioPreview

**Files:**
- Modify: `client/src/components/video/AspectRatioPreview.tsx`

Already reads `activeFocusPoint` from context -- should work automatically after Task 1.3, but verify the preview updates smoothly during playback.

---

## Phase 2: Manual Focus Point Editing

### Task 2.1: Create FocusPointOverlay component

**Files:**
- Create: `client/src/components/editor/FocusPointOverlay.tsx`

Transparent overlay on top of VideoPlayer that:
- Shows current focus point bounding box as a draggable rectangle
- Click anywhere to create a manual focus point at that position
- Drag box to reposition
- Drag edges/corners to resize
- Shows all focus points for current time with different colors (active=yellow, others=dim)

### Task 2.2: Create FocusPointEditor panel

**Files:**
- Create: `client/src/components/editor/FocusPointEditor.tsx`

Editing panel for the selected focus point:
- Name/description (text input)
- Position sliders (x, y, 0-100)
- Size sliders (width, height, 0-100)
- Time range inputs (start, end)
- Delete button
- Source badge (manual / ai_detection)
- "Jump to" button to seek video to focus point's time

### Task 2.3: Make timeline focus markers interactive

**Files:**
- Modify: `client/src/components/editor/VideoTimeline.tsx`

Focus point markers currently have `pointer-events-none`. Change to:
- Click marker to select that focus point
- Selected marker highlighted differently
- Double-click to jump to focus point start time

### Task 2.4: Wire up Editor page

**Files:**
- Modify: `client/src/pages/Editor.tsx`

Add FocusPointOverlay inside VideoPlayer container.
Add FocusPointEditor panel below FocusSelector.
Pass selectedPointId and handlers.

---

## Phase 3: AI Editor Agent

### Task 3.1: Create AI editor server service

**Files:**
- Create: `server/src/services/aiEditorService.ts`

Calls Claude API with structured prompt containing:
- All detected subjects (class, duration, screen coverage, position count)
- Target platform and aspect ratio
- Video duration

Returns structured JSON with focus strategy:
- Hero subject selection per time segment
- Composition offsets (rule of thirds, center, headroom)
- Transition suggestions (smooth pan vs hard cut)

### Task 3.2: Create AI editor API routes

**Files:**
- Create: `server/src/routes/aiEditorRoutes.ts`
- Create: `server/src/controllers/aiEditorController.ts`
- Modify: `server/src/app.ts` (mount new routes)

POST `/api/videos/:videoId/ai-edit` accepts scan subjects + platform, returns focus strategy.

### Task 3.3: Add client API method

**Files:**
- Modify: `client/src/api.ts`

Add `getAIFocusStrategy(videoId, subjects, platform)` method.

### Task 3.4: Integrate AI suggestions in FocusSelector

**Files:**
- Modify: `client/src/components/editor/FocusSelector.tsx`

Add "AI Suggest" button in review state. When clicked:
1. Sends detected subjects to AI editor endpoint
2. Shows AI recommendations with reasoning
3. User can accept (creates focus points from AI strategy) or dismiss

---

## Phase 4: Platform-Specific Intelligence

### Task 4.1: Extend AI prompts with platform rules

**Files:**
- Modify: `server/src/services/aiEditorService.ts`

Add platform-specific composition rules to the AI prompt:
- TikTok: center-weighted, fast cuts, faces prominent
- Instagram Story: center-weighted, text-safe zones top/bottom
- YouTube Shorts: similar to TikTok but more headroom
- YouTube Main: 16:9 already, focus on rule of thirds
- Instagram Feed Square: center composition, tight framing

### Task 4.2: Add platform selector in editor

**Files:**
- Modify: `client/src/components/editor/FocusSelector.tsx`

Dropdown to select target platform before running AI suggest. Affects composition decisions.

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useVideo } from '../../contexts/VideoContext';
import { useFocusPoints } from '../../contexts/FocusPointsContext';
import { useApi } from '../../contexts/ApiContext';
import VideoScannerService from '../../services/VideoScannerService';
import type { Subject as ScannerSubject } from '../../services/VideoScannerService';
import type { Subject, ScanOptions, ScanStatus } from '../../types/scan';
import type { FocusPointCreate } from '../../types/focusPoint';
import { segmentPositionsToFocusPoints } from '../../services/FocusInterpolationService';
import { Sparkles, Play, Pause, PenTool, X, Star, ChevronDown, ChevronRight, BookOpen, ShieldCheck, AlertTriangle, XCircle, Wrench, RefreshCw, SlidersHorizontal, Move, Maximize2, Type } from 'lucide-react';

const PLATFORM_ASPECT_RATIOS: Record<string, [number, number]> = {
  'tiktok': [9, 16],
  'instagram-story': [9, 16],
  'instagram-feed-square': [1, 1],
  'instagram-feed-portrait': [4, 5],
  'youtube-shorts': [9, 16],
  'youtube-main': [16, 9],
  'facebook-story': [9, 16],
  'facebook-feed': [1, 1],
};

interface AIStrategy {
  segments: Array<{
    time_start: number;
    time_end: number;
    follow_subject: string;
    composition: string;
    offset_x: number;
    offset_y: number;
    transition: string;
    reason: string;
  }>;
  reasoning: string;
}

interface LiveDetection {
  frameTime: number;
  objects: Array<{
    bbox: [number, number, number, number];
    class: string;
    score: number;
  }>;
}

interface KeyFrame {
  time: number;
  imageBase64: string;
}

export interface StoryAnnotation {
  id: string;
  time: number;
  bbox: [number, number, number, number];
  label: string;
  isKeyMoment: boolean;
  frameImageBase64?: string;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

/** Convert VideoScannerService subjects (pixel bbox) to refrAIm Subject type (percentage bbox) */
function convertScannerSubjects(
  scannerSubjects: ScannerSubject[],
  videoWidth: number,
  videoHeight: number
): Subject[] {
  return scannerSubjects.map(s => ({
    id: s.id,
    class: s.class,
    first_seen: s.firstSeen,
    last_seen: s.lastSeen,
    positions: s.positions.map(p => ({
      time: p.time,
      bbox: [
        (p.bbox[0] / videoWidth) * 100,
        (p.bbox[1] / videoHeight) * 100,
        (p.bbox[2] / videoWidth) * 100,
        (p.bbox[3] / videoHeight) * 100,
      ] as [number, number, number, number],
      score: p.score,
    })),
  }));
}

function AIReframePreview({
  strategy,
  platform,
  detectedSubjects,
}: {
  strategy: AIStrategy;
  platform: string;
  detectedSubjects: Subject[];
}) {
  const { videoUrl, videoElementRef, isPlaying, currentTime } = useVideo();
  const previewRef = useRef<HTMLVideoElement>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  const [ratioW, ratioH] = PLATFORM_ASPECT_RATIOS[platform] || [9, 16];
  const previewWidth = 280;
  const previewHeight = Math.round(previewWidth / (ratioW / ratioH));

  // Sync preview with main video time
  useEffect(() => {
    const main = videoElementRef.current;
    const preview = previewRef.current;
    if (!main || !preview) return;

    let raf: number;
    const sync = () => {
      if (Math.abs(preview.currentTime - main.currentTime) > 0.15) {
        preview.currentTime = main.currentTime;
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [videoElementRef, videoUrl]);

  // Mirror play/pause
  useEffect(() => {
    const preview = previewRef.current;
    if (!preview) return;
    if (isPlaying) {
      preview.play().catch(() => {});
      setPreviewPlaying(true);
    } else {
      preview.pause();
      setPreviewPlaying(false);
    }
  }, [isPlaying]);

  // Compute focus position from AI strategy at current time (face-weighted for people)
  const focusPosition = useMemo(() => {
    const t = currentTime;
    const activeSeg = strategy.segments.find(
      s => t >= s.time_start && t < s.time_end
    ) || strategy.segments[strategy.segments.length - 1];

    if (!activeSeg) return { x: 50, y: 50 };

    const subject = detectedSubjects.find(s => s.class === activeSeg.follow_subject);
    if (!subject || subject.positions.length === 0) {
      return { x: 50 + (activeSeg.offset_x || 0), y: 50 + (activeSeg.offset_y || 0) };
    }

    const positions = subject.positions.filter(
      p => p.time >= activeSeg.time_start && p.time <= activeSeg.time_end
    );
    const pool = positions.length > 0 ? positions : subject.positions;

    const avgX = pool.reduce((s, p) => s + p.bbox[0] + p.bbox[2] / 2, 0) / pool.length;
    const avgY = pool.reduce((s, p) => s + p.bbox[1] + p.bbox[3] / 2, 0) / pool.length;
    const avgH = pool.reduce((s, p) => s + p.bbox[3], 0) / pool.length;

    const isPerson = subject.class === 'person';
    const faceOffset = isPerson ? -(avgH * 0.2) : 0;

    return {
      x: Math.max(0, Math.min(100, avgX + (activeSeg.offset_x || 0))),
      y: Math.max(0, Math.min(100, avgY + (activeSeg.offset_y || 0) + faceOffset)),
    };
  }, [currentTime, strategy, detectedSubjects]);

  const activeSegIdx = strategy.segments.findIndex(
    s => currentTime >= s.time_start && currentTime < s.time_end
  );
  const activeSeg = activeSegIdx >= 0 ? strategy.segments[activeSegIdx] : null;

  const togglePlay = useCallback(() => {
    const main = videoElementRef.current;
    if (!main) return;
    if (main.paused) { main.play(); } else { main.pause(); }
  }, [videoElementRef]);

  if (!videoUrl) return null;

  return (
    <div className="mt-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 bg-green-500 animate-pulse rounded-full" />
        <span className="text-[10px] font-bold text-white-muted uppercase tracking-wide">
          Live Reframe Preview — {platform.replace(/-/g, ' ')} ({ratioW}:{ratioH})
        </span>
      </div>

      <div className="flex gap-3 items-start">
        {/* Reframed preview */}
        <div className="relative shrink-0">
          <div
            className="overflow-hidden bg-black-ink border-2 border-orange-accent"
            style={{ width: `${previewWidth}px`, height: `${previewHeight}px` }}
          >
            <video
              ref={previewRef}
              src={videoUrl}
              crossOrigin="anonymous"
              className="w-full h-full"
              style={{
                objectFit: 'cover',
                objectPosition: `${focusPosition.x}% ${focusPosition.y}%`,
              }}
              muted
              playsInline
              preload="auto"
            />
          </div>
          <button
            onClick={togglePlay}
            className="absolute bottom-2 left-2 bg-black/70 p-1.5 border border-border-subtle hover:bg-black/90 transition-colors"
          >
            {previewPlaying ? (
              <Pause className="w-3 h-3 text-white" />
            ) : (
              <Play className="w-3 h-3 text-white" />
            )}
          </button>
        </div>

        {/* Active segment info */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-white-dim uppercase tracking-wide mb-1">Current Segment</div>
          {activeSeg ? (
            <div className="bg-black-card border border-border-subtle p-2 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-orange-accent font-bold uppercase text-xs">{activeSeg.follow_subject}</span>
                <span className={`text-[10px] px-1 ${activeSeg.transition === 'hard_cut' ? 'text-red-hot' : 'text-green-500'}`}>
                  {activeSeg.transition === 'hard_cut' ? 'CUT' : 'PAN'}
                </span>
              </div>
              <div className="text-[10px] text-white-dim">{activeSeg.composition}</div>
              <div className="text-[10px] text-white-dim font-mono">
                {activeSeg.time_start.toFixed(1)}s — {activeSeg.time_end.toFixed(1)}s
              </div>
              {activeSeg.reason && (
                <div className="text-[10px] text-white-dim italic">{activeSeg.reason}</div>
              )}
            </div>
          ) : (
            <div className="text-[10px] text-white-dim italic">No segment at current time</div>
          )}

          {/* Segment timeline mini-bar */}
          <div className="mt-2 flex gap-px h-2">
            {strategy.segments.map((seg, idx) => {
              const widthPct = ((seg.time_end - seg.time_start) / (strategy.segments[strategy.segments.length - 1]?.time_end || 1)) * 100;
              return (
                <div
                  key={idx}
                  className={`h-full transition-colors ${idx === activeSegIdx ? 'bg-orange-accent' : 'bg-border-subtle'}`}
                  style={{ width: `${widthPct}%` }}
                  title={`${seg.follow_subject} ${seg.time_start.toFixed(1)}s-${seg.time_end.toFixed(1)}s`}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FocusSelector() {
  const { videoId, videoElementRef, duration } = useVideo();
  const { focusPoints, addFocusPointsBatch, removeAllFocusPoints, updateFocusPoint } = useFocusPoints();
  const { api } = useApi();

  // Local scan state
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveDetection, setLiveDetection] = useState<LiveDetection | null>(null);
  const [subjectsTrackedCount, setSubjectsTrackedCount] = useState(0);

  // Review sub-step: guides user through the review phase
  // 'subjects' = pick subjects, 'story' = brief + annotate, 'ai' = generate strategy, 'adjust' = QA + fix
  const [reviewStep, setReviewStep] = useState<'subjects' | 'story' | 'ai' | 'adjust'>('subjects');

  // Review state
  const [detectedSubjects, setDetectedSubjects] = useState<Subject[]>([]);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());

  // AI editor state
  const [targetPlatform, setTargetPlatform] = useState('tiktok');
  const [aiStrategy, setAiStrategy] = useState<AIStrategy | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // Story brief
  const [storyBrief, setStoryBrief] = useState('');
  const [briefExpanded, setBriefExpanded] = useState(false);

  // Key frames captured during scan
  const [keyFrames, setKeyFrames] = useState<KeyFrame[]>([]);

  // Manual story annotations
  const [annotations, setAnnotations] = useState<StoryAnnotation[]>([]);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [drawingBox, setDrawingBox] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const [pendingAnnotation, setPendingAnnotation] = useState<{ bbox: [number, number, number, number]; time: number; frameBase64?: string } | null>(null);
  const [annotationLabel, setAnnotationLabel] = useState('');
  const [annotationKeyMoment, setAnnotationKeyMoment] = useState(true);
  const annotationOverlayRef = useRef<HTMLDivElement>(null);

  // Crop QA review state
  const [cropReviews, setCropReviews] = useState<Array<{
    time: number;
    quality: 'good' | 'needs_adjustment' | 'bad';
    issues: string[];
    suggestion: string;
    cropImage?: string;
  }> | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);

  // Scan options (local)
  const [scanOptions, setScanOptions] = useState<ScanOptions>({
    interval: 0.5,
    min_score: 0.2,
    similarity_threshold: 0.2,
    min_detections: 1,
  });

  // Thumbnails: map subject class+position key to data URL captured during scan
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scannerRef = useRef<VideoScannerService | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current?.isRunning()) {
        scannerRef.current.stopScan();
      }
    };
  }, []);

  // ---- Canvas drawing ----
  const drawLiveDetections = useCallback((
    objects: Array<{ bbox: [number, number, number, number]; class: string; score: number }>
  ) => {
    const canvas = canvasRef.current;
    const video = videoElementRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw current video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Draw bounding boxes
    objects.forEach((obj) => {
      const [x, y, width, height] = obj.bbox;
      const confidence = Math.round(obj.score * 100);

      ctx.strokeStyle = '#FFFF00';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);

      const label = `${obj.class} ${confidence}%`;
      ctx.font = 'bold 16px Arial';
      const textMetrics = ctx.measureText(label);
      ctx.fillStyle = 'rgba(255, 255, 0, 0.85)';
      ctx.fillRect(x, y - 24, textMetrics.width + 8, 24);
      ctx.fillStyle = '#000000';
      ctx.fillText(label, x + 4, y - 6);
    });

    if (objects.length === 0) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(10, 10, 200, 30);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '14px Arial';
      ctx.fillText('No subjects in this frame', 20, 30);
    }
  }, [videoElementRef]);

  // ---- Scan controls ----
  const startScan = useCallback(async () => {
    const video = videoElementRef.current;
    if (!video) {
      setError('Video element not found. Make sure a video is loaded.');
      return;
    }

    setError(null);
    setScanStatus('scanning');
    setProgress(0);
    setLiveDetection(null);
    setSubjectsTrackedCount(0);
    setDetectedSubjects([]);
    setAcceptedIds(new Set());
    setRejectedIds(new Set());
    setThumbnails(new Map());
    setKeyFrames([]);
    setAnnotations([]);

    // Create a thumbnail canvas for capturing frames
    if (!thumbCanvasRef.current) {
      thumbCanvasRef.current = document.createElement('canvas');
    }

    const wasPlaying = !video.paused;
    if (wasPlaying) video.pause();

    // Reset video to beginning before scanning to avoid stale frame issues on re-scan
    if (video.currentTime > 0) {
      video.currentTime = 0;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        setTimeout(() => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        }, 2000);
      });
    }

    try {
      const scanner = new VideoScannerService();
      scanner.initialize(video);
      scannerRef.current = scanner;

      let uniqueCount = 0;
      const capturedThumbs = new Map<string, string>();
      const capturedKeyFrames: KeyFrame[] = [];

      const subjects = await scanner.scanVideo(duration, {
        interval: scanOptions.interval,
        minScore: scanOptions.min_score,
        similarityThreshold: scanOptions.similarity_threshold,
        minDetections: scanOptions.min_detections,
        onProgress: (p) => {
          setProgress(p.percentComplete);
        },
        onFrameProcessed: (frameTime, objects) => {
          const mapped = objects.map(obj => ({
            bbox: obj.bbox as [number, number, number, number],
            class: obj.class,
            score: obj.score,
          }));

          setLiveDetection({ frameTime, objects: mapped });
          drawLiveDetections(mapped);

          // Capture key frame thumbnail (~1 per second for filmstrip)
          const tc = thumbCanvasRef.current;
          if (tc && video) {
            tc.width = 160;
            tc.height = 90;
            const tctx = tc.getContext('2d');
            if (tctx) {
              tctx.drawImage(video, 0, 0, tc.width, tc.height);
              capturedKeyFrames.push({
                time: frameTime,
                imageBase64: tc.toDataURL('image/jpeg', 0.6),
              });
            }
          }

          if (objects.length > 0) {
            uniqueCount = Math.max(uniqueCount, objects.length);
            setSubjectsTrackedCount(uniqueCount);

            // Capture thumbnails for each detected object
            const tc = thumbCanvasRef.current;
            if (tc && video) {
              tc.width = 320;
              tc.height = 180;
              const tctx = tc.getContext('2d');
              if (tctx) {
                objects.forEach(obj => {
                  const key = `${obj.class}_${frameTime}`;
                  tctx.drawImage(video, 0, 0, tc.width, tc.height);
                  // Draw yellow bbox on thumbnail
                  const sx = (obj.bbox[0] / video.videoWidth) * tc.width;
                  const sy = (obj.bbox[1] / video.videoHeight) * tc.height;
                  const sw = (obj.bbox[2] / video.videoWidth) * tc.width;
                  const sh = (obj.bbox[3] / video.videoHeight) * tc.height;
                  tctx.strokeStyle = '#FFFF00';
                  tctx.lineWidth = 2;
                  tctx.strokeRect(sx, sy, sw, sh);
                  tctx.fillStyle = 'rgba(255, 255, 0, 0.85)';
                  tctx.font = 'bold 11px Arial';
                  const label = `${obj.class} ${Math.round(obj.score * 100)}%`;
                  const tm = tctx.measureText(label);
                  tctx.fillRect(sx, sy - 14, tm.width + 6, 14);
                  tctx.fillStyle = '#000';
                  tctx.fillText(label, sx + 3, sy - 3);
                  const dataUrl = tc.toDataURL('image/jpeg', 0.7);
                  capturedThumbs.set(key, dataUrl);
                });
              }
            }
          }
        },
      });

      // Convert scanner subjects (pixel coords) to refrAIm subjects (percentage coords)
      const vw = video.videoWidth || 1920;
      const vh = video.videoHeight || 1080;
      const converted = convertScannerSubjects(subjects, vw, vh);

      // Map thumbnails to subject IDs (use first position's time to match)
      const subjectThumbs = new Map<string, string>();
      for (const s of converted) {
        const firstPos = s.positions[0];
        if (firstPos) {
          const key = `${s.class}_${firstPos.time}`;
          const thumb = capturedThumbs.get(key);
          if (thumb) {
            subjectThumbs.set(s.id, thumb);
          } else {
            // Try to find any thumb for this class
            for (const [k, v] of capturedThumbs) {
              if (k.startsWith(s.class + '_')) {
                subjectThumbs.set(s.id, v);
                break;
              }
            }
          }
        }
      }
      setThumbnails(subjectThumbs);
      setDetectedSubjects(converted);
      setAcceptedIds(new Set(converted.map(s => s.id)));
      setSubjectsTrackedCount(converted.length);
      setKeyFrames(capturedKeyFrames);
      setLiveDetection(null);
      setScanStatus('review');
      setReviewStep('subjects');
    } catch (err) {
      setError('Scan failed: ' + (err instanceof Error ? err.message : String(err)));
      setScanStatus('idle');
    } finally {
      scannerRef.current = null;
      if (wasPlaying && video) video.play();
    }
  }, [videoElementRef, duration, scanOptions, drawLiveDetections]);

  const stopScan = useCallback(() => {
    if (scannerRef.current?.isRunning()) {
      scannerRef.current.stopScan();
    }
    setScanStatus('idle');
    setLiveDetection(null);
    setProgress(0);
  }, []);

  // ---- Review controls ----
  const acceptSubject = useCallback((id: string) => {
    setAcceptedIds(prev => { const next = new Set(prev); next.add(id); return next; });
    setRejectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const rejectSubject = useCallback((id: string) => {
    setRejectedIds(prev => { const next = new Set(prev); next.add(id); return next; });
    setAcceptedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const acceptAll = useCallback(() => {
    setAcceptedIds(new Set(detectedSubjects.map(s => s.id)));
    setRejectedIds(new Set());
  }, [detectedSubjects]);

  const rejectAll = useCallback(() => {
    setRejectedIds(new Set(detectedSubjects.map(s => s.id)));
    setAcceptedIds(new Set());
  }, [detectedSubjects]);

  const finalize = useCallback(async () => {
    setScanStatus('finalizing');
    const accepted = detectedSubjects.filter(s => acceptedIds.has(s.id));

    // Create segmented focus points with position interpolation
    const allFocusPoints: FocusPointCreate[] = [];

    for (const subject of accepted) {
      const segments = segmentPositionsToFocusPoints(
        subject.positions,
        subject.class || 'detected_region',
        2.0
      );

      for (const seg of segments) {
        allFocusPoints.push({
          time_start: seg.time_start,
          time_end: seg.time_end,
          x: seg.x,
          y: seg.y,
          width: seg.width,
          height: seg.height,
          description: seg.description,
          source: seg.source,
        });
      }
    }

    if (allFocusPoints.length > 0) {
      await addFocusPointsBatch(allFocusPoints);
    }

    setScanStatus('idle');
    setDetectedSubjects([]);
    setAcceptedIds(new Set());
    setRejectedIds(new Set());
  }, [detectedSubjects, acceptedIds, addFocusPointsBatch]);

  const cancelReview = useCallback(() => {
    setScanStatus('idle');
    setDetectedSubjects([]);
    setAcceptedIds(new Set());
    setRejectedIds(new Set());
    setAiStrategy(null);
    setAnnotations([]);
    setKeyFrames([]);
    setAnnotationMode(false);
    setPendingAnnotation(null);
  }, []);

  // ---- Annotation controls ----
  const seekToFrame = useCallback((time: number) => {
    const video = videoElementRef.current;
    if (!video) return;
    video.currentTime = time;
  }, [videoElementRef]);

  const getAnnotationRelPos = useCallback((clientX: number, clientY: number) => {
    const el = annotationOverlayRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100)),
    };
  }, []);

  const handleAnnotationMouseDown = useCallback((e: React.MouseEvent) => {
    if (!annotationMode) return;
    const pos = getAnnotationRelPos(e.clientX, e.clientY);
    if (!pos) return;
    setDrawingBox({ startX: pos.x, startY: pos.y, endX: pos.x, endY: pos.y });
  }, [annotationMode, getAnnotationRelPos]);

  const handleAnnotationMouseMove = useCallback((e: React.MouseEvent) => {
    if (!drawingBox) return;
    const pos = getAnnotationRelPos(e.clientX, e.clientY);
    if (!pos) return;
    setDrawingBox(prev => prev ? { ...prev, endX: pos.x, endY: pos.y } : null);
  }, [drawingBox, getAnnotationRelPos]);

  const handleAnnotationMouseUp = useCallback(() => {
    if (!drawingBox) return;
    const x = Math.min(drawingBox.startX, drawingBox.endX);
    const y = Math.min(drawingBox.startY, drawingBox.endY);
    const w = Math.abs(drawingBox.endX - drawingBox.startX);
    const h = Math.abs(drawingBox.endY - drawingBox.startY);

    if (w < 2 || h < 2) {
      setDrawingBox(null);
      return;
    }

    // Capture frame thumbnail for this annotation
    const video = videoElementRef.current;
    let frameBase64: string | undefined;
    const tc = thumbCanvasRef.current;
    if (tc && video) {
      tc.width = 160;
      tc.height = 90;
      const tctx = tc.getContext('2d');
      if (tctx) {
        tctx.drawImage(video, 0, 0, tc.width, tc.height);
        frameBase64 = tc.toDataURL('image/jpeg', 0.6);
      }
    }

    setPendingAnnotation({
      bbox: [x, y, w, h],
      time: video?.currentTime || 0,
      frameBase64,
    });
    setDrawingBox(null);
    setAnnotationLabel('');
    setAnnotationKeyMoment(true);
  }, [drawingBox, videoElementRef]);

  const confirmAnnotation = useCallback(() => {
    if (!pendingAnnotation || !annotationLabel.trim()) return;
    const newAnnotation: StoryAnnotation = {
      id: `ann_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      time: pendingAnnotation.time,
      bbox: pendingAnnotation.bbox,
      label: annotationLabel.trim(),
      isKeyMoment: annotationKeyMoment,
      frameImageBase64: pendingAnnotation.frameBase64,
    };
    setAnnotations(prev => [...prev, newAnnotation]);
    setPendingAnnotation(null);
    setAnnotationLabel('');
    setAnnotationMode(false);
  }, [pendingAnnotation, annotationLabel, annotationKeyMoment]);

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id));
  }, []);

  // ---- Subject editing controls ----
  const [editingSubjectId, setEditingSubjectId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [draggingSubject, setDraggingSubject] = useState<{
    subjectId: string;
    mode: 'move' | 'resize';
    startMouseX: number;
    startMouseY: number;
    startBboxX: number;
    startBboxY: number;
    startBboxW: number;
    startBboxH: number;
    containerWidth: number;
    containerHeight: number;
  } | null>(null);

  const renameSubject = useCallback((id: string, newName: string) => {
    if (!newName.trim()) return;
    setDetectedSubjects(prev => prev.map(s =>
      s.id === id ? { ...s, class: newName.trim().toLowerCase().replace(/\s+/g, '_') } : s
    ));
    setEditingSubjectId(null);
  }, []);

  const updateSubjectBbox = useCallback((id: string, bboxUpdate: Partial<{ x: number; y: number; w: number; h: number }>) => {
    setDetectedSubjects(prev => prev.map(s => {
      if (s.id !== id || s.positions.length === 0) return s;
      const refPos = s.positions[0];
      const [ox, oy, ow, oh] = refPos.bbox;
      const dx = (bboxUpdate.x ?? ox) - ox;
      const dy = (bboxUpdate.y ?? oy) - oy;
      const sw = bboxUpdate.w !== undefined ? bboxUpdate.w / ow : 1;
      const sh = bboxUpdate.h !== undefined ? bboxUpdate.h / oh : 1;

      return {
        ...s,
        positions: s.positions.map(p => ({
          ...p,
          bbox: [
            Math.max(0, Math.min(100, p.bbox[0] + dx)),
            Math.max(0, Math.min(100, p.bbox[1] + dy)),
            Math.max(2, Math.min(100, p.bbox[2] * sw)),
            Math.max(2, Math.min(100, p.bbox[3] * sh)),
          ] as [number, number, number, number],
        })),
      };
    }));
  }, []);

  const handleSubjectDragStart = useCallback((
    e: React.MouseEvent,
    subjectId: string,
    mode: 'move' | 'resize',
    containerEl: HTMLDivElement,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const subject = detectedSubjects.find(s => s.id === subjectId);
    if (!subject || subject.positions.length === 0) return;
    const rect = containerEl.getBoundingClientRect();
    const pos = subject.positions[0];
    setDraggingSubject({
      subjectId,
      mode,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startBboxX: pos.bbox[0],
      startBboxY: pos.bbox[1],
      startBboxW: pos.bbox[2],
      startBboxH: pos.bbox[3],
      containerWidth: rect.width,
      containerHeight: rect.height,
    });
  }, [detectedSubjects]);

  useEffect(() => {
    if (!draggingSubject) return;

    const handleMouseMove = (e: MouseEvent) => {
      const d = draggingSubject;
      const dxPx = e.clientX - d.startMouseX;
      const dyPx = e.clientY - d.startMouseY;
      const dxPct = (dxPx / d.containerWidth) * 100;
      const dyPct = (dyPx / d.containerHeight) * 100;

      if (d.mode === 'move') {
        updateSubjectBbox(d.subjectId, {
          x: Math.max(0, Math.min(100 - d.startBboxW, d.startBboxX + dxPct)),
          y: Math.max(0, Math.min(100 - d.startBboxH, d.startBboxY + dyPct)),
        });
      } else {
        updateSubjectBbox(d.subjectId, {
          w: Math.max(5, d.startBboxW + dxPct),
          h: Math.max(5, d.startBboxH + dyPct),
        });
      }
    };

    const handleMouseUp = () => setDraggingSubject(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingSubject, updateSubjectBbox]);

  const requestAISuggestion = useCallback(async () => {
    if (!api || !videoId || detectedSubjects.length === 0) return;

    setAiLoading(true);
    setError(null);

    try {
      const subjectInputs = detectedSubjects.map(s => {
        const avgCoverage = s.positions.reduce((sum, p) => {
          return sum + (p.bbox[2] * p.bbox[3]) / 100;
        }, 0) / (s.positions.length || 1);
        const avgConfidence = s.positions.reduce((sum, p) => sum + p.score, 0) / (s.positions.length || 1);

        return {
          id: s.id,
          class: s.class,
          first_seen: s.first_seen,
          last_seen: s.last_seen,
          position_count: s.positions.length,
          avg_screen_coverage: avgCoverage,
          avg_confidence: avgConfidence,
        };
      });

      // Select ~6 evenly-spaced key frames for vision analysis
      const visionFrames = keyFrames.length <= 6
        ? keyFrames
        : Array.from({ length: 6 }, (_, i) =>
            keyFrames[Math.round(i * (keyFrames.length - 1) / 5)]
          );

      const strategy = await api.getAIFocusStrategy(
        videoId,
        subjectInputs,
        duration,
        targetPlatform,
        storyBrief || undefined,
        annotations.length > 0 ? annotations : undefined,
        visionFrames.length > 0 ? visionFrames : undefined,
      );
      setAiStrategy(strategy);
    } catch (err) {
      setError('AI suggestion failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAiLoading(false);
    }
  }, [api, videoId, detectedSubjects, duration, targetPlatform, storyBrief, annotations, keyFrames]);

  const runCropReview = useCallback(async () => {
    if (!api || !videoId || !aiStrategy || aiStrategy.segments.length === 0) return;

    const video = videoElementRef.current;
    if (!video) return;

    setReviewLoading(true);
    setCropReviews(null);
    setError(null);

    try {
      const [ratioW, ratioH] = PLATFORM_ASPECT_RATIOS[targetPlatform] || [9, 16];

      const cropCanvas = document.createElement('canvas');
      const cropWidth = 480;
      const cropHeight = Math.round(cropWidth / (ratioW / ratioH));
      cropCanvas.width = cropWidth;
      cropCanvas.height = cropHeight;
      const cropCtx = cropCanvas.getContext('2d');
      if (!cropCtx) throw new Error('Could not create canvas');

      const wasPlaying = !video.paused;
      if (wasPlaying) video.pause();

      const cropsToSend: Array<{
        time: number;
        imageBase64: string;
        description: string;
        ratio: string;
      }> = [];

      // Capture the cropped frame for each segment at its midpoint
      for (const seg of aiStrategy.segments) {
        const midTime = (seg.time_start + seg.time_end) / 2;

        video.currentTime = midTime;
        await new Promise<void>(resolve => {
          const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
          video.addEventListener('seeked', onSeeked);
          setTimeout(() => { video.removeEventListener('seeked', onSeeked); resolve(); }, 1500);
        });

        // Compute crop region from focus position
        const subject = detectedSubjects.find(s => s.class === seg.follow_subject);
        let focusX = 50 + (seg.offset_x || 0);
        let focusY = 50 + (seg.offset_y || 0);

        if (subject) {
          const positions = subject.positions.filter(
            p => p.time >= seg.time_start && p.time <= seg.time_end
          );
          const pool = positions.length > 0 ? positions : subject.positions;
          if (pool.length > 0) {
            focusX = pool.reduce((s, p) => s + p.bbox[0] + p.bbox[2] / 2, 0) / pool.length + (seg.offset_x || 0);
            focusY = pool.reduce((s, p) => s + p.bbox[1] + p.bbox[3] / 2, 0) / pool.length + (seg.offset_y || 0);
            const avgH = pool.reduce((s, p) => s + p.bbox[3], 0) / pool.length;
            if (subject.class === 'person') focusY -= avgH * 0.2;
          }
        }

        focusX = Math.max(0, Math.min(100, focusX));
        focusY = Math.max(0, Math.min(100, focusY));

        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const targetAspect = ratioW / ratioH;
        const videoAspect = vw / vh;

        let srcW: number, srcH: number;
        if (targetAspect < videoAspect) {
          srcH = vh;
          srcW = vh * targetAspect;
        } else {
          srcW = vw;
          srcH = vw / targetAspect;
        }

        const centerX = (focusX / 100) * vw;
        const centerY = (focusY / 100) * vh;
        let srcX = Math.max(0, Math.min(vw - srcW, centerX - srcW / 2));
        let srcY = Math.max(0, Math.min(vh - srcH, centerY - srcH / 2));

        cropCtx.clearRect(0, 0, cropWidth, cropHeight);
        cropCtx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, cropWidth, cropHeight);

        cropsToSend.push({
          time: midTime,
          imageBase64: cropCanvas.toDataURL('image/jpeg', 0.85),
          description: `${seg.follow_subject} — ${seg.composition}`,
          ratio: `${ratioW}:${ratioH}`,
        });
      }

      if (wasPlaying) video.play();

      const result = await api.reviewCrops(videoId, cropsToSend, targetPlatform);
      setCropReviews(result.reviews.map((r, i) => ({
        ...r,
        cropImage: cropsToSend[i]?.imageBase64,
      })));
    } catch (err) {
      setError('Crop review failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setReviewLoading(false);
    }
  }, [api, videoId, aiStrategy, videoElementRef, targetPlatform, detectedSubjects]);

  // Track which segment is expanded for manual offset editing
  const [expandedSegIdx, setExpandedSegIdx] = useState<number | null>(null);

  const liveCropCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Scrub & Fix timeline state
  const [scrubTime, setScrubTime] = useState(0);
  const scrubCropCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Local overrides for scrub-edit sliders (instant response, debounced save)
  const [scrubEditLocal, setScrubEditLocal] = useState<{ id: string; x: number; y: number; width: number; height: number } | null>(null);
  const [scrubSaveStatus, setScrubSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const scrubEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear local slider overrides when scrubbing to a different point
  useEffect(() => {
    if (scrubEditLocal) {
      const activeFp = focusPoints.find(fp => scrubTime >= fp.time_start && scrubTime < fp.time_end);
      if (!activeFp || activeFp.id !== scrubEditLocal.id) {
        setScrubEditLocal(null);
      }
    }
  }, [scrubTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateSegmentOffset = useCallback((idx: number, axis: 'offset_x' | 'offset_y', value: number) => {
    setAiStrategy(prev => {
      if (!prev) return prev;
      const updated = { ...prev, segments: [...prev.segments] };
      updated.segments[idx] = { ...updated.segments[idx], [axis]: value };
      return updated;
    });
    // Mark adjusted review as stale but keep the image
    setCropReviews(prev => {
      if (!prev || !prev[idx]) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quality: 'needs_adjustment', issues: ['Adjusted — re-run QA to verify'], suggestion: '' };
      return updated;
    });
  }, []);

  // Re-render live crop whenever strategy changes or segment is expanded
  useEffect(() => {
    if (expandedSegIdx !== null && aiStrategy) {
      requestAnimationFrame(() => renderLiveCrop(expandedSegIdx));
    }
  }, [expandedSegIdx, aiStrategy, targetPlatform]);

  const renderLiveCrop = useCallback((idx: number) => {
    const video = videoElementRef.current;
    const canvas = liveCropCanvasRef.current;
    if (!video || !canvas || !aiStrategy) return;

    const seg = aiStrategy.segments[idx];
    if (!seg) return;

    const [ratioW, ratioH] = PLATFORM_ASPECT_RATIOS[targetPlatform] || [9, 16];
    const cropWidth = 240;
    const cropHeight = Math.round(cropWidth / (ratioW / ratioH));
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const subject = detectedSubjects.find(s => s.class === seg.follow_subject);
    let focusX = 50 + (seg.offset_x || 0);
    let focusY = 50 + (seg.offset_y || 0);

    if (subject) {
      const positions = subject.positions.filter(p => p.time >= seg.time_start && p.time <= seg.time_end);
      const pool = positions.length > 0 ? positions : subject.positions;
      if (pool.length > 0) {
        focusX = pool.reduce((s, p) => s + p.bbox[0] + p.bbox[2] / 2, 0) / pool.length + (seg.offset_x || 0);
        focusY = pool.reduce((s, p) => s + p.bbox[1] + p.bbox[3] / 2, 0) / pool.length + (seg.offset_y || 0);
        const avgH = pool.reduce((s, p) => s + p.bbox[3], 0) / pool.length;
        if (subject.class === 'person') focusY -= avgH * 0.2;
      }
    }

    focusX = Math.max(0, Math.min(100, focusX));
    focusY = Math.max(0, Math.min(100, focusY));

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const targetAspect = ratioW / ratioH;

    let srcW: number, srcH: number;
    if (targetAspect < vw / vh) {
      srcH = vh;
      srcW = vh * targetAspect;
    } else {
      srcW = vw;
      srcH = vw / targetAspect;
    }

    const centerX = (focusX / 100) * vw;
    const centerY = (focusY / 100) * vh;
    const srcX = Math.max(0, Math.min(vw - srcW, centerX - srcW / 2));
    const srcY = Math.max(0, Math.min(vh - srcH, centerY - srcH / 2));

    ctx.clearRect(0, 0, cropWidth, cropHeight);
    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, cropWidth, cropHeight);
  }, [videoElementRef, aiStrategy, targetPlatform, detectedSubjects]);

  // Scrub timeline: sync scrubTime with video timeupdate + seeked
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;
    const onTimeUpdate = () => setScrubTime(video.currentTime);
    const onSeeked = () => setScrubTime(video.currentTime);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onSeeked);
    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [videoElementRef]);

  // Scrub timeline: render crop preview at scrubTime
  const renderScrubCrop = useCallback(() => {
    const video = videoElementRef.current;
    const canvas = scrubCropCanvasRef.current;
    if (!video || !canvas) return;
    if (video.readyState < 2) return;

    const [rW, rH] = PLATFORM_ASPECT_RATIOS[targetPlatform] || [9, 16];
    const cW = 240;
    const cH = Math.round(cW / (rW / rH));
    canvas.width = cW;
    canvas.height = cH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const t = video.currentTime;
    const activeFp = focusPoints.find(fp => t >= fp.time_start && t < fp.time_end);

    // Use local slider overrides if they match the active focus point
    const useLocal = scrubEditLocal && activeFp && scrubEditLocal.id === activeFp.id;
    const fpX = useLocal ? scrubEditLocal.x : activeFp?.x;
    const fpY = useLocal ? scrubEditLocal.y : activeFp?.y;
    const fpW = useLocal ? scrubEditLocal.width : activeFp?.width;
    const fpH = useLocal ? scrubEditLocal.height : activeFp?.height;

    const focusX = activeFp ? (fpX! + fpW! / 2) : 50;
    const focusY = activeFp ? (fpY! + fpH! / 2) : 50;

    const vw = video.videoWidth || 1920;
    const vh = video.videoHeight || 1080;
    const targetAspect = rW / rH;
    let srcW: number, srcH: number;
    if (targetAspect < vw / vh) { srcH = vh; srcW = vh * targetAspect; }
    else { srcW = vw; srcH = vw / targetAspect; }

    const cx = (focusX / 100) * vw;
    const cy = (focusY / 100) * vh;
    const srcX = Math.max(0, Math.min(vw - srcW, cx - srcW / 2));
    const srcY = Math.max(0, Math.min(vh - srcH, cy - srcH / 2));
    ctx.clearRect(0, 0, cW, cH);
    ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, cW, cH);
  }, [videoElementRef, focusPoints, targetPlatform, scrubEditLocal]);

  // Re-render crop preview when scrubTime or slider edits change
  useEffect(() => {
    if (focusPoints.length === 0) return;
    requestAnimationFrame(renderScrubCrop);
  }, [scrubTime, focusPoints, renderScrubCrop, scrubEditLocal]);

  // On initial load, force a micro-seek so the video decodes its first frame
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video || focusPoints.length === 0) return;
    const kickstart = () => {
      if (video.currentTime === 0) video.currentTime = 0.01;
      requestAnimationFrame(renderScrubCrop);
    };
    if (video.readyState >= 2) {
      kickstart();
    } else {
      video.addEventListener('loadeddata', kickstart, { once: true });
      return () => video.removeEventListener('loadeddata', kickstart);
    }
  }, [focusPoints.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render after any seek completes (frame decoded)
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;
    const onSeeked = () => requestAnimationFrame(renderScrubCrop);
    video.addEventListener('seeked', onSeeked);
    return () => video.removeEventListener('seeked', onSeeked);
  }, [videoElementRef, renderScrubCrop]);

  const autoFixSegment = useCallback((idx: number) => {
    if (!cropReviews || !cropReviews[idx] || !aiStrategy) return;
    const review = cropReviews[idx];
    const suggestion = review.suggestion.toLowerCase();
    const seg = aiStrategy.segments[idx];

    let dx = 0, dy = 0;
    const nudge = 8;

    if (suggestion.includes('right') || suggestion.includes('left edge')) dx = nudge;
    else if (suggestion.includes('left') || suggestion.includes('right edge')) dx = -nudge;

    if (suggestion.includes('down') || suggestion.includes('headroom') || suggestion.includes('top')) dy = nudge;
    else if (suggestion.includes('up') || suggestion.includes('bottom')) dy = -nudge;

    if (dx === 0 && dy === 0) {
      if (review.issues.some(i => i.toLowerCase().includes('face') && i.toLowerCase().includes('cut'))) dy = -nudge;
      else if (review.issues.some(i => i.toLowerCase().includes('tight') || i.toLowerCase().includes('headroom'))) dy = nudge;
      else dx = nudge;
    }

    setAiStrategy(prev => {
      if (!prev) return prev;
      const updated = { ...prev, segments: [...prev.segments] };
      updated.segments[idx] = {
        ...updated.segments[idx],
        offset_x: Math.max(-50, Math.min(50, seg.offset_x + dx)),
        offset_y: Math.max(-50, Math.min(50, seg.offset_y + dy)),
      };
      return updated;
    });

    setCropReviews(prev => {
      if (!prev) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], quality: 'good', issues: ['Auto-fixed'], suggestion: '' };
      return updated;
    });
  }, [cropReviews, aiStrategy]);

  const regenFlaggedSegments = useCallback(async () => {
    if (!api || !videoId || !aiStrategy || !cropReviews) return;

    const flaggedIndices = cropReviews
      .map((r, i) => r.quality !== 'good' ? i : -1)
      .filter(i => i >= 0);

    if (flaggedIndices.length === 0) return;

    setAiLoading(true);
    setError(null);

    try {
      const subjectInputs = detectedSubjects.map(s => {
        const avgCoverage = s.positions.reduce((sum, p) => sum + (p.bbox[2] * p.bbox[3]) / 100, 0) / (s.positions.length || 1);
        const avgConfidence = s.positions.reduce((sum, p) => sum + p.score, 0) / (s.positions.length || 1);
        return {
          id: s.id,
          class: s.class,
          first_seen: s.first_seen,
          last_seen: s.last_seen,
          position_count: s.positions.length,
          avg_screen_coverage: avgCoverage,
          avg_confidence: avgConfidence,
        };
      });

      const qaFeedback = flaggedIndices.map(i => {
        const seg = aiStrategy.segments[i];
        const review = cropReviews[i];
        return `Segment ${seg.time_start.toFixed(1)}s-${seg.time_end.toFixed(1)}s (${seg.follow_subject}): ${review.issues.join('; ')}. Suggestion: ${review.suggestion}`;
      }).join('\n');

      const augmentedBrief = [
        storyBrief,
        '\n\nCRITICAL QA FEEDBACK — these segments had composition issues and need different offsets:',
        qaFeedback,
        '\nPlease significantly adjust offset_x and offset_y for these segments to fix the problems.',
      ].filter(Boolean).join('\n');

      const visionFrames = keyFrames.length <= 6
        ? keyFrames
        : Array.from({ length: 6 }, (_, i) => keyFrames[Math.round(i * (keyFrames.length - 1) / 5)]);

      const newStrategy = await api.getAIFocusStrategy(
        videoId,
        subjectInputs,
        duration,
        targetPlatform,
        augmentedBrief,
        annotations.length > 0 ? annotations : undefined,
        visionFrames.length > 0 ? visionFrames : undefined,
      );

      // Merge: keep good segments, replace flagged ones
      setAiStrategy(prev => {
        if (!prev) return newStrategy;
        const merged = { ...prev, segments: [...prev.segments] };
        for (const flagIdx of flaggedIndices) {
          const oldSeg = prev.segments[flagIdx];
          const replacement = newStrategy.segments.find(
            ns => Math.abs(ns.time_start - oldSeg.time_start) < 0.5
          );
          if (replacement) {
            merged.segments[flagIdx] = replacement;
          }
        }
        merged.reasoning = `${prev.reasoning} [Re-generated ${flaggedIndices.length} flagged segments]`;
        return merged;
      });
      setCropReviews(null);
    } catch (err) {
      setError('Re-generation failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAiLoading(false);
    }
  }, [api, videoId, aiStrategy, cropReviews, detectedSubjects, duration, targetPlatform, storyBrief, annotations, keyFrames]);

  const fillGaps = useCallback(() => {
    if (!aiStrategy || duration <= 0) return;

    const sorted = [...aiStrategy.segments].sort((a, b) => a.time_start - b.time_start);
    const gaps: Array<{ time_start: number; time_end: number }> = [];

    // Gap before first segment
    if (sorted.length === 0 || sorted[0].time_start > 0.5) {
      gaps.push({ time_start: 0, time_end: sorted.length > 0 ? sorted[0].time_start : duration });
    }

    // Gaps between segments
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapStart = sorted[i].time_end;
      const gapEnd = sorted[i + 1].time_start;
      if (gapEnd - gapStart > 0.5) {
        gaps.push({ time_start: gapStart, time_end: gapEnd });
      }
    }

    // Gap after last segment
    if (sorted.length > 0) {
      const lastEnd = sorted[sorted.length - 1].time_end;
      if (duration - lastEnd > 0.5) {
        gaps.push({ time_start: lastEnd, time_end: duration });
      }
    }

    if (gaps.length === 0) return;

    const gapSegments = gaps.map(g => ({
      time_start: g.time_start,
      time_end: g.time_end,
      follow_subject: 'scene',
      composition: 'center' as const,
      offset_x: 0,
      offset_y: 0,
      transition: 'hard_cut' as const,
      reason: 'Gap fill — center crop (adjust as needed)',
    }));

    setAiStrategy(prev => {
      if (!prev) return prev;
      const allSegments = [...prev.segments, ...gapSegments].sort((a, b) => a.time_start - b.time_start);
      return { ...prev, segments: allSegments, reasoning: `${prev.reasoning} [Filled ${gaps.length} gap${gaps.length > 1 ? 's' : ''}]` };
    });
    setCropReviews(null);
  }, [aiStrategy, duration]);

  // Compute gap info for display
  const gapInfo = useMemo(() => {
    if (!aiStrategy || duration <= 0) return { count: 0, totalSeconds: 0 };
    const sorted = [...aiStrategy.segments].sort((a, b) => a.time_start - b.time_start);
    let gapSeconds = 0;
    let count = 0;

    if (sorted.length === 0) return { count: 1, totalSeconds: duration };

    if (sorted[0].time_start > 0.5) { gapSeconds += sorted[0].time_start; count++; }
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].time_start - sorted[i].time_end;
      if (gap > 0.5) { gapSeconds += gap; count++; }
    }
    const tailGap = duration - sorted[sorted.length - 1].time_end;
    if (tailGap > 0.5) { gapSeconds += tailGap; count++; }

    return { count, totalSeconds: gapSeconds };
  }, [aiStrategy, duration]);

  const applyAIStrategy = useCallback(async () => {
    if (!aiStrategy) return;

    setScanStatus('finalizing');

    const focusPointCreates: FocusPointCreate[] = aiStrategy.segments.map(seg => {
      const subject = detectedSubjects.find(s => s.class === seg.follow_subject);
      const positions = subject?.positions.filter(
        p => p.time >= seg.time_start && p.time <= seg.time_end
      ) || [];

      let baseX = 50, baseY = 50, width = 30, height = 30;
      let isPerson = false;

      if (positions.length > 0) {
        const avgBbox = positions.reduce(
          (acc, p) => ({
            x: acc.x + p.bbox[0] + p.bbox[2] / 2,
            y: acc.y + p.bbox[1] + p.bbox[3] / 2,
            w: acc.w + p.bbox[2],
            h: acc.h + p.bbox[3],
          }),
          { x: 0, y: 0, w: 0, h: 0 }
        );
        baseX = avgBbox.x / positions.length;
        baseY = avgBbox.y / positions.length;
        width = avgBbox.w / positions.length;
        height = avgBbox.h / positions.length;
        isPerson = subject?.class === 'person';
      } else {
        const matchingAnnotation = annotations.find(
          a => a.label.toLowerCase().replace(/\s+/g, '_') === seg.follow_subject.toLowerCase().replace(/\s+/g, '_')
            || a.label.toLowerCase() === seg.follow_subject.toLowerCase()
        );
        if (matchingAnnotation) {
          baseX = matchingAnnotation.bbox[0] + matchingAnnotation.bbox[2] / 2;
          baseY = matchingAnnotation.bbox[1] + matchingAnnotation.bbox[3] / 2;
          width = matchingAnnotation.bbox[2];
          height = matchingAnnotation.bbox[3];
        }
      }

      // Face-weighted centering: shift person focus toward upper portion (face area)
      const faceOffset = isPerson ? -(height * 0.2) : 0;

      const adjustedX = Math.max(0, Math.min(100 - width, baseX - width / 2 + seg.offset_x));
      const adjustedY = Math.max(0, Math.min(100 - height, baseY - height / 2 + seg.offset_y + faceOffset));

      return {
        time_start: seg.time_start,
        time_end: seg.time_end,
        x: adjustedX,
        y: Math.max(0, adjustedY),
        width: Math.min(width, 100),
        height: Math.min(height, 100),
        description: `${seg.follow_subject} (${seg.composition})`,
        source: 'ai_detection' as const,
      };
    });

    if (focusPointCreates.length > 0) {
      await addFocusPointsBatch(focusPointCreates);
    }

    setScanStatus('idle');
    setDetectedSubjects([]);
    setAcceptedIds(new Set());
    setRejectedIds(new Set());
    setAiStrategy(null);
    setAnnotations([]);
    setKeyFrames([]);
  }, [aiStrategy, detectedSubjects, annotations, addFocusPointsBatch]);

  if (!videoId) return null;

  const overallStep = scanStatus === 'idle' && focusPoints.length === 0
    ? 'start'
    : scanStatus === 'scanning'
    ? 'scanning'
    : (scanStatus === 'review' || scanStatus === 'finalizing')
    ? 'review'
    : 'done';

  const STEPS = [
    { key: 'start', label: '1. Scan', description: 'Find subjects' },
    { key: 'scanning', label: '...', description: 'Scanning' },
    { key: 'review', label: '2. Review', description: 'Subjects & AI' },
    { key: 'done', label: '3. Refine', description: 'Scrub & fix' },
  ];

  return (
    <div className="bg-black-card border-2 border-border-subtle p-4">
      <h3 className="text-lg font-bold text-red-hot uppercase mb-1">Focus Points</h3>

      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-4">
        {STEPS.filter(s => s.key !== 'scanning').map((step, i) => {
          const stepKeys = ['start', 'review', 'done'];
          const currentIdx = stepKeys.indexOf(overallStep === 'scanning' ? 'start' : overallStep);
          const thisIdx = i;
          const isActive = thisIdx === currentIdx;
          const isComplete = thisIdx < currentIdx;
          return (
            <React.Fragment key={step.key}>
              {i > 0 && (
                <div className={`flex-1 h-0.5 ${isComplete ? 'bg-orange-accent' : 'bg-border-subtle'}`} />
              )}
              <div className="flex items-center gap-1.5">
                <div className={`w-6 h-6 flex items-center justify-center text-[10px] font-bold ${
                  isActive ? 'bg-orange-accent text-white' : isComplete ? 'bg-orange-accent/30 text-orange-accent' : 'bg-black-deep text-white-dim border border-border-subtle'
                }`}>
                  {isComplete ? '✓' : i + 1}
                </div>
                <span className={`text-[10px] uppercase tracking-wide ${isActive ? 'text-orange-accent font-bold' : 'text-white-dim'}`}>
                  {step.description}
                </span>
              </div>
            </React.Fragment>
          );
        })}
      </div>

      {/* Live scan canvas overlay */}
      <canvas
        ref={canvasRef}
        className={scanStatus === 'scanning' ? 'w-full border-2 border-yellow-electric mb-4' : 'hidden'}
        style={{ maxHeight: scanStatus === 'scanning' ? '300px' : '0', objectFit: 'contain' }}
      />

      {/* Idle state: scan controls */}
      {scanStatus === 'idle' && (
        <div>
          <p className="text-xs text-white-dim mb-3">
            Scans your video to find subjects and track them across frames
          </p>
          <div className="flex gap-2 mb-3">
            <button
              onClick={startScan}
              className="px-4 py-2 bg-red-hot text-white text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all"
            >
              Scan Video
            </button>
            {focusPoints.length > 0 && (
              <button
                onClick={removeAllFocusPoints}
                className="px-4 py-2 bg-black-card text-red-hot text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-hot hover:text-white transition-all"
              >
                Clear All
              </button>
            )}
          </div>

          {/* Advanced Settings */}
          <details className="mb-3">
            <summary className="text-xs font-bold text-white-muted uppercase tracking-wide cursor-pointer hover:text-orange-accent transition-colors">
              Advanced Settings
            </summary>
            <div className="mt-2 p-3 bg-black-deep border border-border-subtle">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white-dim uppercase tracking-wide mb-1">
                    Interval (seconds)
                  </label>
                  <input
                    type="number"
                    min={0.5}
                    max={5}
                    step={0.5}
                    value={scanOptions.interval || 1}
                    onChange={e => setScanOptions(prev => ({ ...prev, interval: parseFloat(e.target.value) }))}
                    className="w-full bg-black-card border border-border-subtle text-white-full px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white-dim uppercase tracking-wide mb-1">
                    Min Confidence
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={scanOptions.min_score || 0.5}
                    onChange={e => setScanOptions(prev => ({ ...prev, min_score: parseFloat(e.target.value) }))}
                    className="w-full accent-red-hot"
                  />
                  <span className="text-xs text-white-dim">{((scanOptions.min_score || 0.5) * 100).toFixed(0)}%</span>
                </div>
                <div>
                  <label className="block text-xs text-white-dim uppercase tracking-wide mb-1">
                    Similarity Threshold
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={scanOptions.similarity_threshold || 0.3}
                    onChange={e => setScanOptions(prev => ({ ...prev, similarity_threshold: parseFloat(e.target.value) }))}
                    className="w-full accent-red-hot"
                  />
                  <span className="text-xs text-white-dim">{((scanOptions.similarity_threshold || 0.3) * 100).toFixed(0)}%</span>
                </div>
                <div>
                  <label className="block text-xs text-white-dim uppercase tracking-wide mb-1">
                    Min Detections
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={scanOptions.min_detections || 3}
                    onChange={e => setScanOptions(prev => ({ ...prev, min_detections: parseInt(e.target.value) }))}
                    className="w-full bg-black-card border border-border-subtle text-white-full px-2 py-1 text-sm"
                  />
                </div>
              </div>
            </div>
          </details>

          {/* Scrub & Fix timeline editor */}
          {focusPoints.length > 0 && (
            <div className="mt-3 border-t border-border-subtle pt-3">
              <div className="flex items-center gap-2 mb-2">
                <Move className="w-4 h-4 text-orange-accent" />
                <h4 className="text-xs font-bold text-orange-accent uppercase tracking-wide">Scrub & Fix</h4>
                <span className="text-[10px] text-white-dim">{focusPoints.length} keyframes</span>
              </div>

              {/* Coverage timeline bar */}
              {duration > 0 && (
                <div className="mb-2">
                  <div className="relative w-full h-3 bg-black-deep border border-border-subtle">
                    {focusPoints.map((fp, i) => {
                      const left = (fp.time_start / duration) * 100;
                      const width = Math.max(0.5, ((fp.time_end - fp.time_start) / duration) * 100);
                      return (
                        <div
                          key={fp.id}
                          className="absolute top-0 h-full bg-orange-accent/60 hover:bg-orange-accent transition-colors cursor-pointer"
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${fp.description} (${formatTime(fp.time_start)}-${formatTime(fp.time_end)})`}
                          onClick={() => seekToFrame(fp.time_start)}
                        />
                      );
                    })}
                    {/* Playhead */}
                    <div
                      className="absolute top-0 w-0.5 h-full bg-white z-10"
                      style={{ left: `${((videoElementRef.current?.currentTime || 0) / duration) * 100}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[8px] text-white-dim/50 mt-0.5">
                    <span>0:00</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>
              )}

              {/* Live crop preview — full width */}
              <div className="mb-2">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-white-dim uppercase">
                    Crop preview at {formatTime(scrubTime)}
                  </span>
                  {(() => {
                    const activeFp = focusPoints.find(fp => scrubTime >= fp.time_start && scrubTime < fp.time_end);
                    return activeFp ? (
                      <span className="text-[10px] text-orange-accent font-bold uppercase truncate">
                        {activeFp.description}
                      </span>
                    ) : (
                      <span className="text-[10px] text-red-hot uppercase">
                        Gap — no keyframe
                      </span>
                    );
                  })()}
                </div>
                <div className={`border-2 mx-auto ${
                  focusPoints.find(fp => scrubTime >= fp.time_start && scrubTime < fp.time_end)
                    ? 'border-orange-accent' : 'border-red-hot'
                }`} style={{ maxWidth: '280px' }}>
                  <canvas
                    ref={scrubCropCanvasRef}
                    className="block w-full"
                  />
                </div>
              </div>

              {/* Controls */}
              <div className="space-y-2">
                  {/* Time scrubber */}
                  <div>
                    <label className="text-[10px] text-white-dim uppercase tracking-wide">Scrub through video</label>
                    <input
                      type="range"
                      min={0}
                      max={duration}
                      step={0.1}
                      value={scrubTime}
                      onChange={e => {
                        const t = parseFloat(e.target.value);
                        setScrubTime(t);
                        seekToFrame(t);
                      }}
                      className="w-full h-2 accent-orange-accent cursor-pointer"
                    />
                  </div>

                  {/* Reposition existing keyframe OR add new one */}
                  {(() => {
                    const activeFpForEdit = focusPoints.find(fp => scrubTime >= fp.time_start && scrubTime < fp.time_end);
                    if (activeFpForEdit) {
                      const isLocalMatch = scrubEditLocal && scrubEditLocal.id === activeFpForEdit.id;
                      const editX = isLocalMatch ? scrubEditLocal.x : activeFpForEdit.x;
                      const editY = isLocalMatch ? scrubEditLocal.y : activeFpForEdit.y;
                      const editW = isLocalMatch ? scrubEditLocal.width : activeFpForEdit.width;
                      const hasUnsavedChanges = isLocalMatch && (
                        scrubEditLocal.x !== activeFpForEdit.x ||
                        scrubEditLocal.y !== activeFpForEdit.y ||
                        scrubEditLocal.width !== activeFpForEdit.width
                      );

                      const handleScrubSlider = (field: 'x' | 'y' | 'width', val: number) => {
                        const prev = scrubEditLocal && scrubEditLocal.id === activeFpForEdit.id
                          ? scrubEditLocal
                          : { id: activeFpForEdit.id, x: activeFpForEdit.x, y: activeFpForEdit.y, width: activeFpForEdit.width, height: activeFpForEdit.height };
                        const next = { ...prev, [field]: val };
                        if (field === 'width') next.height = val;
                        setScrubEditLocal(next);
                        setScrubSaveStatus('idle');
                      };

                      const handleSave = async () => {
                        if (!scrubEditLocal || scrubEditLocal.id !== activeFpForEdit.id) return;
                        setScrubSaveStatus('saving');
                        await updateFocusPoint(activeFpForEdit.id, {
                          x: scrubEditLocal.x,
                          y: scrubEditLocal.y,
                          width: scrubEditLocal.width,
                          height: scrubEditLocal.height,
                        });
                        setScrubSaveStatus('saved');
                        setScrubEditLocal(null);
                        if (scrubEditTimerRef.current) clearTimeout(scrubEditTimerRef.current);
                        scrubEditTimerRef.current = setTimeout(() => setScrubSaveStatus('idle'), 2000);
                      };

                      const handleSaveAndNext = async (nextFpToGo: typeof activeFpForEdit) => {
                        if (hasUnsavedChanges && scrubEditLocal) {
                          setScrubSaveStatus('saving');
                          await updateFocusPoint(activeFpForEdit.id, {
                            x: scrubEditLocal.x,
                            y: scrubEditLocal.y,
                            width: scrubEditLocal.width,
                            height: scrubEditLocal.height,
                          });
                          setScrubEditLocal(null);
                        }
                        setScrubSaveStatus('idle');
                        seekToFrame(nextFpToGo.time_start);
                        setScrubTime(nextFpToGo.time_start);
                      };

                      const sortedFps = [...focusPoints].sort((a, b) => a.time_start - b.time_start);
                      const currentIdx = sortedFps.findIndex(fp => fp.id === activeFpForEdit.id);
                      const prevFp = currentIdx > 0 ? sortedFps[currentIdx - 1] : null;
                      const nextFp = currentIdx < sortedFps.length - 1 ? sortedFps[currentIdx + 1] : null;

                      return (
                        <div className="space-y-1.5 p-2 bg-black-deep border border-orange-accent">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Move className="w-3 h-3 text-orange-accent" />
                              <span className="text-[10px] font-bold uppercase text-orange-accent">
                                Reposition frame {currentIdx + 1}/{sortedFps.length}
                              </span>
                            </div>
                            {scrubSaveStatus === 'saved' && (
                              <span className="text-[10px] text-green-500 font-bold uppercase">✓ Saved</span>
                            )}
                            {scrubSaveStatus === 'saving' && (
                              <span className="text-[10px] text-yellow-500 font-bold uppercase">Saving...</span>
                            )}
                            {scrubSaveStatus === 'idle' && hasUnsavedChanges && (
                              <span className="text-[10px] text-red-hot font-bold uppercase">Unsaved</span>
                            )}
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] text-white-dim uppercase">Horizontal pan</label>
                              <span className="text-[10px] text-white-dim font-mono">{editX.toFixed(0)}%</span>
                            </div>
                            <input
                              type="range" min={0} max={100} step={1}
                              value={editX}
                              onChange={e => handleScrubSlider('x', parseFloat(e.target.value))}
                              className="w-full h-2 accent-orange-accent cursor-pointer"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] text-white-dim uppercase">Vertical pan</label>
                              <span className="text-[10px] text-white-dim font-mono">{editY.toFixed(0)}%</span>
                            </div>
                            <input
                              type="range" min={0} max={100} step={1}
                              value={editY}
                              onChange={e => handleScrubSlider('y', parseFloat(e.target.value))}
                              className="w-full h-2 accent-orange-accent cursor-pointer"
                            />
                          </div>
                          <div>
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] text-white-dim uppercase">Zoom</label>
                              <span className="text-[10px] text-white-dim font-mono">{editW.toFixed(0)}%</span>
                            </div>
                            <input
                              type="range" min={10} max={100} step={1}
                              value={editW}
                              onChange={e => handleScrubSlider('width', parseFloat(e.target.value))}
                              className="w-full h-2 accent-orange-accent cursor-pointer"
                            />
                          </div>
                          {/* Save + Navigate */}
                          <div className="flex gap-2 pt-1">
                            <button
                              disabled={!prevFp}
                              onClick={() => { if (prevFp) handleSaveAndNext(prevFp); }}
                              className="px-2 py-1.5 text-[10px] font-bold uppercase border border-border-subtle text-white-dim hover:border-orange-accent hover:text-orange-accent transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                            >
                              ← Prev
                            </button>
                            <button
                              onClick={handleSave}
                              disabled={!hasUnsavedChanges || scrubSaveStatus === 'saving'}
                              className="flex-1 px-3 py-1.5 text-[10px] font-bold uppercase bg-orange-accent text-white hover:bg-red-hot transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              {scrubSaveStatus === 'saving' ? 'Saving...' : scrubSaveStatus === 'saved' ? '✓ Saved' : 'Save'}
                            </button>
                            <button
                              disabled={!nextFp}
                              onClick={() => { if (nextFp) handleSaveAndNext(nextFp); }}
                              className="px-2 py-1.5 text-[10px] font-bold uppercase border border-border-subtle text-white-dim hover:border-orange-accent hover:text-orange-accent transition-all disabled:opacity-20 disabled:cursor-not-allowed"
                            >
                              Next →
                            </button>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <button
                        onClick={async () => {
                          const video = videoElementRef.current;
                          if (!video || !videoId) return;
                          const t = video.currentTime;

                          const before = focusPoints.filter(fp => fp.time_end <= t).sort((a, b) => b.time_end - a.time_end)[0];
                          const after = focusPoints.filter(fp => fp.time_start > t).sort((a, b) => a.time_start - b.time_start)[0];
                          const gapStart = before ? before.time_end : 0;
                          const gapEnd = after ? after.time_start : duration;

                          const newPoint: FocusPointCreate = {
                            time_start: gapStart,
                            time_end: gapEnd,
                            x: 25,
                            y: 25,
                            width: 50,
                            height: 50,
                            description: `manual_${formatTime(t)}`,
                            source: 'manual',
                          };
                          await addFocusPointsBatch([newPoint]);
                        }}
                        className="w-full px-3 py-2 text-[10px] font-bold uppercase text-white bg-orange-accent border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all flex items-center justify-center gap-1"
                      >
                        <PenTool className="w-3 h-3" />
                        Add Keyframe for this gap
                      </button>
                    );
                  })()}

                  {/* Fill all gaps shortcut */}
                  {(() => {
                    const gaps: Array<{ start: number; end: number }> = [];
                    const sorted = [...focusPoints].sort((a, b) => a.time_start - b.time_start);
                    if (sorted.length === 0) return null;
                    if (sorted[0].time_start > 0.5) gaps.push({ start: 0, end: sorted[0].time_start });
                    for (let i = 0; i < sorted.length - 1; i++) {
                      const g = sorted[i + 1].time_start - sorted[i].time_end;
                      if (g > 0.5) gaps.push({ start: sorted[i].time_end, end: sorted[i + 1].time_start });
                    }
                    const tail = duration - sorted[sorted.length - 1].time_end;
                    if (tail > 0.5) gaps.push({ start: sorted[sorted.length - 1].time_end, end: duration });
                    if (gaps.length === 0) return null;
                    return (
                      <button
                        onClick={async () => {
                          const newPoints: FocusPointCreate[] = gaps.map(g => ({
                            time_start: g.start,
                            time_end: g.end,
                            x: 25, y: 25, width: 50, height: 50,
                            description: `fill_${formatTime(g.start)}`,
                            source: 'manual' as const,
                          }));
                          await addFocusPointsBatch(newPoints);
                        }}
                        className="w-full px-3 py-1.5 text-[10px] font-bold uppercase text-yellow-500 bg-yellow-500/10 border border-yellow-500/30 hover:bg-yellow-500/20 transition-all flex items-center justify-center gap-1"
                      >
                        <AlertTriangle className="w-3 h-3" />
                        Auto-fill {gaps.length} gap{gaps.length > 1 ? 's' : ''} with center crop
                      </button>
                    );
                  })()}

                  {/* Focus point list — compact */}
                  <div className="max-h-32 overflow-y-auto space-y-0.5">
                    {[...focusPoints].sort((a, b) => a.time_start - b.time_start).map(fp => {
                      const isActive = scrubTime >= fp.time_start && scrubTime < fp.time_end;
                      return (
                        <div
                          key={fp.id}
                          className={`flex items-center gap-2 text-[10px] p-1.5 cursor-pointer transition-all ${
                            isActive ? 'bg-orange-accent/20 border border-orange-accent' : 'bg-black-deep border border-border-subtle hover:border-orange-accent/50'
                          }`}
                          onClick={() => { seekToFrame(fp.time_start); setScrubTime(fp.time_start); }}
                        >
                          <span className="text-white-dim font-mono shrink-0">{formatTime(fp.time_start)}</span>
                          <span className={`font-bold uppercase truncate ${fp.source === 'manual' ? 'text-yellow-500' : 'text-orange-accent'}`}>
                            {fp.description}
                          </span>
                          <span className="text-white-dim/50 ml-auto shrink-0">{((fp.time_end - fp.time_start)).toFixed(1)}s</span>
                        </div>
                      );
                    })}
                  </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scanning state: progress + live detection */}
      {scanStatus === 'scanning' && (
        <div>
          {/* Live detection stats */}
          <div className="mb-3 p-3 bg-black-deep border border-border-subtle">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 animate-pulse" />
                <span className="font-bold text-orange-accent uppercase text-xs">Live Detection</span>
              </div>
              {liveDetection && (
                <span className="text-xs text-white-dim">
                  Frame at {liveDetection.frameTime.toFixed(1)}s
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-black-card p-3 border border-border-subtle">
                <div className="text-2xl font-bold text-orange-accent">
                  {liveDetection?.objects.length || 0}
                </div>
                <div className="text-xs text-white-dim">Objects in frame</div>
              </div>
              <div className="bg-black-card p-3 border border-border-subtle">
                <div className="text-2xl font-bold text-red-hot">
                  {subjectsTrackedCount}
                </div>
                <div className="text-xs text-white-dim">Unique subjects tracked</div>
              </div>
            </div>

            {liveDetection && liveDetection.objects.length > 0 && (
              <div className="mb-3">
                <div className="text-xs font-medium text-white-dim mb-1">Detected in this frame:</div>
                <div className="flex flex-wrap gap-1">
                  {liveDetection.objects.map((obj, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-2 py-1 text-xs font-bold bg-black-card text-orange-accent border border-orange-accent"
                    >
                      {obj.class} ({Math.round(obj.score * 100)}%)
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-white-muted mb-1">
              <span className="uppercase tracking-wide">Scanning video...</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="w-full h-3 bg-black-deep">
              <div
                className="h-full bg-red-hot transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <button
            onClick={stopScan}
            className="px-4 py-2 bg-black-card text-red-hot text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-hot hover:text-white transition-all"
          >
            Stop Scan
          </button>
        </div>
      )}

      {/* Review state: guided step-by-step flow */}
      {(scanStatus === 'review' || scanStatus === 'finalizing') && (
        <div className="mt-1">
          {/* Review sub-step tabs */}
          <div className="flex mb-4 border-b border-border-subtle">
            {[
              { key: 'subjects' as const, label: 'Subjects', count: acceptedIds.size },
              { key: 'story' as const, label: 'Story', count: (storyBrief ? 1 : 0) + annotations.length },
              { key: 'ai' as const, label: 'AI Reframe', count: aiStrategy ? aiStrategy.segments.length : 0 },
              { key: 'adjust' as const, label: 'QA & Fix', count: cropReviews ? cropReviews.filter(r => r.quality !== 'good').length : 0 },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setReviewStep(tab.key)}
                className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wide text-center transition-all relative ${
                  reviewStep === tab.key
                    ? 'text-orange-accent'
                    : 'text-white-dim hover:text-white-muted'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`ml-1 px-1.5 py-0.5 text-[9px] rounded-sm ${
                    reviewStep === tab.key ? 'bg-orange-accent text-white' : 'bg-border-subtle text-white-dim'
                  }`}>
                    {tab.count}
                  </span>
                )}
                {reviewStep === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-accent" />
                )}
              </button>
            ))}
          </div>

          {/* ---- STEP: SUBJECTS ---- */}
          {/* ---- STEP: SUBJECTS ---- */}
          {reviewStep === 'subjects' && (
            <>
              <div className="p-3 bg-black-deep border border-border-subtle mb-4">
                <p className="text-sm text-white-muted mb-1">
                  <span className="text-orange-accent font-bold">{detectedSubjects.length}</span> subjects found.
                  Remove any the AI should ignore.
                </p>
                <p className="text-[10px] text-white-dim">
                  Click name to rename. Drag box to reposition. Drag corner to resize.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {detectedSubjects.map(subject => {
                  const isRejected = rejectedIds.has(subject.id);
                  const isEditing = editingSubjectId === subject.id;
                  const refPos = subject.positions[0];

                  return (
                    <div
                      key={subject.id}
                      className={`overflow-hidden p-3 transition-all ${
                        isRejected
                          ? 'border-2 border-red-hot/30 bg-black-card opacity-40'
                          : 'border-2 border-orange-accent bg-black-deep'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editingName}
                            onChange={e => setEditingName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') renameSubject(subject.id, editingName); if (e.key === 'Escape') setEditingSubjectId(null); }}
                            onBlur={() => renameSubject(subject.id, editingName)}
                            className="flex-1 bg-black-card border border-orange-accent text-white-full text-sm px-2 py-0.5 font-bold"
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => { setEditingSubjectId(subject.id); setEditingName(subject.class); }}
                            className="flex items-center gap-1.5 text-left group"
                            title="Click to rename"
                          >
                            <h4 className="font-bold text-white-muted capitalize text-sm group-hover:text-orange-accent transition-colors">{subject.class}</h4>
                            <Type className="w-3 h-3 text-white-dim/30 group-hover:text-orange-accent transition-colors" />
                          </button>
                        )}
                        <span className="ml-auto text-[10px] bg-black-deep text-orange-accent border border-orange-accent px-1.5 py-0.5 shrink-0">
                          {subject.positions.length}f
                        </span>
                      </div>

                      <div className="text-[10px] text-white-dim mb-2">
                        {formatTime(subject.first_seen)} — {formatTime(subject.last_seen)} ({formatTime(subject.last_seen - subject.first_seen)})
                      </div>

                      {thumbnails.has(subject.id) ? (
                        <div
                          className="mb-2 border border-border-subtle overflow-hidden relative select-none"
                          ref={el => { if (el) el.dataset.subjectId = subject.id; }}
                        >
                          <img src={thumbnails.get(subject.id)} alt={subject.class} className="w-full pointer-events-none" draggable={false} />
                          {refPos && (
                            <div
                              className="absolute border-2 border-orange-accent bg-orange-accent/10 cursor-move group"
                              style={{ left: `${refPos.bbox[0]}%`, top: `${refPos.bbox[1]}%`, width: `${refPos.bbox[2]}%`, height: `${refPos.bbox[3]}%` }}
                              onMouseDown={e => { handleSubjectDragStart(e, subject.id, 'move', e.currentTarget.parentElement as HTMLDivElement); }}
                            >
                              <Move className="absolute top-0.5 left-0.5 w-3 h-3 text-orange-accent opacity-60 group-hover:opacity-100" />
                              <div
                                className="absolute -bottom-1 -right-1 w-3 h-3 bg-orange-accent cursor-se-resize"
                                onMouseDown={e => { e.stopPropagation(); handleSubjectDragStart(e, subject.id, 'resize', e.currentTarget.parentElement!.parentElement as HTMLDivElement); }}
                              >
                                <Maximize2 className="w-2.5 h-2.5 text-black m-px" />
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="mb-2 h-16 bg-black-deep border border-border-subtle flex items-center justify-center">
                          <span className="text-xs text-white-dim">No preview</span>
                        </div>
                      )}

                      <button
                        onClick={() => isRejected ? acceptSubject(subject.id) : rejectSubject(subject.id)}
                        className={`w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide transition-all ${
                          isRejected
                            ? 'border border-border-subtle text-white-dim hover:border-orange-accent hover:text-orange-accent'
                            : 'border border-red-hot/30 text-red-hot/60 hover:bg-red-hot hover:text-white hover:border-red-hot'
                        }`}
                      >
                        {isRejected ? 'Restore' : 'Remove'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Next step button */}
              <div className="flex gap-2">
                <button
                  onClick={cancelReview}
                  className="px-4 py-2.5 bg-black-card text-white-dim text-xs font-bold uppercase tracking-wide border border-border-subtle hover:border-red-hot transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setReviewStep('story')}
                  className="flex-1 px-4 py-2.5 bg-orange-accent text-white text-sm font-bold uppercase tracking-wide border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all"
                >
                  Next: Add Story Context →
                </button>
              </div>
            </>
          )}

          {/* ---- STEP: STORY ---- */}
          {reviewStep === 'story' && (
            <div>
              <div className="p-3 bg-black-deep border border-border-subtle mb-4">
                <p className="text-sm text-white-muted mb-1">
                  <span className="text-orange-accent font-bold">Optional:</span> Help the AI understand your video's story.
                </p>
                <p className="text-[10px] text-white-dim">
                  Add a brief description and annotate key moments the scanner missed. Skip this if the subjects are enough.
                </p>
              </div>

              {/* Story Brief — always visible in story step */}
              <div className="mb-4 p-3 bg-black-deep border border-border-subtle">
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="w-4 h-4 text-orange-accent" />
                  <span className="text-xs font-bold text-orange-accent uppercase tracking-wide">Story Brief</span>
                </div>
                <p className="text-[10px] text-white-dim mb-2">
                  Describe the video's story, what matters editorially, and what the AI should prioritize.
                </p>
                <textarea
                  value={storyBrief}
                  onChange={e => setStoryBrief(e.target.value)}
                  placeholder="e.g. Twinings tea ad. Woman is cosy indoors on a rainy day. She doesn't want to take the dog out. The rain on the window is the central visual motif."
                  className="w-full bg-black-card border border-border-subtle text-white-full text-xs p-2 resize-y min-h-[60px] max-h-[120px] placeholder:text-white-dim/40"
                  rows={3}
                />
              </div>

              {/* Key Frame Strip + Annotation */}
              {keyFrames.length > 0 && (
            <div className="mb-4 p-3 bg-black-deep border border-border-subtle">
              <div className="flex items-center gap-2 mb-2">
                <PenTool className="w-4 h-4 text-orange-accent" />
                <h5 className="text-xs font-bold text-orange-accent uppercase tracking-wide">
                  Key Frames &amp; Annotations
                </h5>
                <button
                  onClick={() => { setAnnotationMode(!annotationMode); setPendingAnnotation(null); setDrawingBox(null); }}
                  className={`ml-auto px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-all flex items-center gap-1 ${
                    annotationMode
                      ? 'bg-orange-accent text-white border border-orange-accent'
                      : 'bg-black-card text-white-muted border border-border-subtle hover:border-orange-accent'
                  }`}
                >
                  <PenTool className="w-3 h-3" />
                  {annotationMode ? 'Drawing...' : 'Annotate'}
                </button>
              </div>

              {annotationMode && (
                <p className="text-[10px] text-orange-accent mb-2">
                  Click a frame below to seek, then draw a box on the video above to mark what COCO-SSD missed.
                </p>
              )}

              {/* Scrollable filmstrip */}
              <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-thin">
                {keyFrames.map((kf, idx) => (
                  <button
                    key={idx}
                    onClick={() => seekToFrame(kf.time)}
                    className="shrink-0 border border-border-subtle hover:border-orange-accent transition-colors relative group"
                    title={`${kf.time.toFixed(1)}s`}
                  >
                    <img src={kf.imageBase64} alt={`Frame ${kf.time.toFixed(1)}s`} className="w-20 h-[45px] object-cover" />
                    <span className="absolute bottom-0 left-0 bg-black/70 text-[8px] text-white px-1">
                      {kf.time.toFixed(1)}s
                    </span>
                    {annotations.some(a => Math.abs(a.time - kf.time) < 0.5) && (
                      <div className="absolute top-0 right-0 w-2 h-2 bg-orange-accent" />
                    )}
                  </button>
                ))}
              </div>

              {/* Annotation drawing overlay - shown on the video canvas area */}
              {annotationMode && (
                <div
                  ref={annotationOverlayRef}
                  className="relative mt-2 border-2 border-dashed border-orange-accent cursor-crosshair"
                  style={{ aspectRatio: '16/9' }}
                  onMouseDown={handleAnnotationMouseDown}
                  onMouseMove={handleAnnotationMouseMove}
                  onMouseUp={handleAnnotationMouseUp}
                  onMouseLeave={() => setDrawingBox(null)}
                >
                  {/* Video frame background */}
                  <video
                    src={videoElementRef.current?.src || ''}
                    crossOrigin="anonymous"
                    className="w-full h-full object-contain pointer-events-none"
                    ref={el => {
                      if (el && videoElementRef.current) {
                        el.currentTime = videoElementRef.current.currentTime;
                      }
                    }}
                    muted
                    playsInline
                  />

                  {/* Drawing rectangle */}
                  {drawingBox && (
                    <div
                      className="absolute border-2 border-orange-accent bg-orange-accent/20 pointer-events-none"
                      style={{
                        left: `${Math.min(drawingBox.startX, drawingBox.endX)}%`,
                        top: `${Math.min(drawingBox.startY, drawingBox.endY)}%`,
                        width: `${Math.abs(drawingBox.endX - drawingBox.startX)}%`,
                        height: `${Math.abs(drawingBox.endY - drawingBox.startY)}%`,
                      }}
                    />
                  )}

                  {/* Existing annotations on this frame */}
                  {annotations
                    .filter(a => Math.abs(a.time - (videoElementRef.current?.currentTime || 0)) < 1)
                    .map(a => (
                      <div
                        key={a.id}
                        className="absolute border-2 border-green-500 bg-green-500/10 pointer-events-none"
                        style={{ left: `${a.bbox[0]}%`, top: `${a.bbox[1]}%`, width: `${a.bbox[2]}%`, height: `${a.bbox[3]}%` }}
                      >
                        <span className="absolute -top-4 left-0 bg-green-500 text-black text-[8px] px-1 font-bold">
                          {a.label}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              {/* Pending annotation form */}
              {pendingAnnotation && (
                <div className="mt-2 p-2 bg-black-card border border-orange-accent space-y-2">
                  <p className="text-[10px] text-orange-accent font-bold uppercase">Name this element</p>
                  <input
                    type="text"
                    value={annotationLabel}
                    onChange={e => setAnnotationLabel(e.target.value)}
                    placeholder="e.g. rain on window, product shot, reluctant expression"
                    className="w-full bg-black-deep border border-border-subtle text-white-full text-xs p-2 placeholder:text-white-dim/40"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') confirmAnnotation(); }}
                  />
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-1 text-[10px] text-white-dim cursor-pointer">
                      <input
                        type="checkbox"
                        checked={annotationKeyMoment}
                        onChange={e => setAnnotationKeyMoment(e.target.checked)}
                        className="accent-orange-accent"
                      />
                      <Star className="w-3 h-3 text-orange-accent" />
                      Key story moment
                    </label>
                    <span className="text-[10px] text-white-dim">at {pendingAnnotation.time.toFixed(1)}s</span>
                    <div className="ml-auto flex gap-1">
                      <button
                        onClick={() => setPendingAnnotation(null)}
                        className="px-2 py-1 text-[10px] text-white-dim border border-border-subtle hover:border-red-hot"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={confirmAnnotation}
                        disabled={!annotationLabel.trim()}
                        className="px-2 py-1 text-[10px] font-bold text-white bg-orange-accent border border-orange-accent disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Annotations list */}
              {annotations.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="text-[10px] text-white-dim uppercase tracking-wide">
                    {annotations.length} annotation{annotations.length !== 1 ? 's' : ''}
                  </div>
                  {annotations.map(a => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 text-[10px] bg-black-card p-2 border border-border-subtle cursor-pointer hover:border-orange-accent"
                      onClick={() => seekToFrame(a.time)}
                    >
                      {a.frameImageBase64 && (
                        <img src={a.frameImageBase64} alt="" className="w-10 h-[22px] object-cover shrink-0 border border-border-subtle" />
                      )}
                      <span className="text-white-dim font-mono shrink-0">{a.time.toFixed(1)}s</span>
                      <span className="text-orange-accent font-bold uppercase truncate">{a.label}</span>
                      {a.isKeyMoment && <Star className="w-3 h-3 text-orange-accent shrink-0" fill="currentColor" />}
                      <button
                        onClick={e => { e.stopPropagation(); removeAnnotation(a.id); }}
                        className="ml-auto text-white-dim hover:text-red-hot shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

              {/* Story step: Next button */}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setReviewStep('subjects')}
                  className="px-4 py-2.5 bg-black-card text-white-dim text-xs font-bold uppercase tracking-wide border border-border-subtle hover:border-orange-accent transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setReviewStep('ai')}
                  className="flex-1 px-4 py-2.5 bg-orange-accent text-white text-sm font-bold uppercase tracking-wide border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all"
                >
                  Next: Generate AI Reframe →
                </button>
              </div>
            </div>
          )}
          {/* end story step */}

          {/* ---- STEP: AI REFRAME ---- */}
          {reviewStep === 'ai' && (
            <div>
              <div className="mb-4 p-3 bg-black-deep border border-border-subtle">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-orange-accent" />
                  <h5 className="text-sm font-bold text-orange-accent uppercase tracking-wide">AI Reframe</h5>
                  {(storyBrief || annotations.length > 0) && (
                    <span className="text-[10px] text-green-500 ml-auto">
                      Story-aware {storyBrief ? '+ brief' : ''}{annotations.length > 0 ? ` + ${annotations.length} annotations` : ''}
                    </span>
                  )}
                </div>
                <p className="text-xs text-white-dim mb-3">
                  Choose a platform and let the AI generate a framing strategy for your {acceptedIds.size} subjects.
                </p>

                <div className="flex items-center gap-2 mb-3">
                  <label className="text-[10px] text-white-dim uppercase tracking-wide shrink-0">Platform:</label>
                  <select
                    value={targetPlatform}
                    onChange={(e) => { setTargetPlatform(e.target.value); setAiStrategy(null); }}
                    className="flex-1 bg-black-card border border-border-subtle text-white-full px-2 py-1 text-xs"
                  >
                    <option value="tiktok">TikTok (9:16)</option>
                    <option value="instagram-story">Instagram Story (9:16)</option>
                    <option value="instagram-feed-square">Instagram Feed Square (1:1)</option>
                    <option value="instagram-feed-portrait">Instagram Feed Portrait (4:5)</option>
                    <option value="youtube-shorts">YouTube Shorts (9:16)</option>
                    <option value="youtube-main">YouTube Main (16:9)</option>
                    <option value="facebook-story">Facebook Story (9:16)</option>
                    <option value="facebook-feed">Facebook Feed (1:1)</option>
                  </select>
                </div>

                {!aiStrategy && (
                  <button
                    onClick={requestAISuggestion}
                    disabled={aiLoading}
                    className="w-full px-4 py-3 bg-orange-accent text-white text-sm font-bold uppercase tracking-wide border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-4 h-4" />
                    {aiLoading ? 'AI is analyzing your video...' : 'Generate AI Reframe Strategy'}
                  </button>
                )}
              </div>

              {/* AI Strategy Results */}
              {aiStrategy && (
                <div className="space-y-2">
                  <AIReframePreview
                    strategy={aiStrategy}
                    platform={targetPlatform}
                    detectedSubjects={detectedSubjects}
                  />

                  <p className="text-xs text-white-muted">{aiStrategy.reasoning}</p>

                  {/* Coverage timeline */}
                  {duration > 0 && (
                    <div className="mb-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] text-white-dim uppercase">Timeline coverage</span>
                        {gapInfo.count > 0 && (
                          <span className="text-[10px] text-red-hot">{gapInfo.count} gap{gapInfo.count > 1 ? 's' : ''}</span>
                        )}
                        {gapInfo.count === 0 && (
                          <span className="text-[10px] text-green-500">100% covered</span>
                        )}
                      </div>
                      <div className="relative w-full h-2 bg-red-hot/30 border border-border-subtle">
                        {aiStrategy.segments.map((seg, i) => {
                          const left = (seg.time_start / duration) * 100;
                          const width = Math.max(0.3, ((seg.time_end - seg.time_start) / duration) * 100);
                          const review = cropReviews?.[i];
                          const color = review
                            ? review.quality === 'good' ? 'bg-green-500' : review.quality === 'bad' ? 'bg-red-hot' : 'bg-yellow-500'
                            : 'bg-orange-accent';
                          return (
                            <div
                              key={i}
                              className={`absolute top-0 h-full ${color} cursor-pointer hover:opacity-80 transition-opacity`}
                              style={{ left: `${left}%`, width: `${width}%` }}
                              onClick={() => { setExpandedSegIdx(i); seekToFrame((seg.time_start + seg.time_end) / 2); }}
                              title={`${seg.follow_subject} (${formatTime(seg.time_start)}-${formatTime(seg.time_end)})`}
                            />
                          );
                        })}
                      </div>
                      <div className="flex gap-3 mt-0.5">
                        <span className="text-[8px] text-white-dim/50 flex items-center gap-1"><span className="w-2 h-2 bg-orange-accent inline-block" /> covered</span>
                        <span className="text-[8px] text-white-dim/50 flex items-center gap-1"><span className="w-2 h-2 bg-red-hot/30 inline-block" /> gap</span>
                        {cropReviews && (
                          <>
                            <span className="text-[8px] text-white-dim/50 flex items-center gap-1"><span className="w-2 h-2 bg-green-500 inline-block" /> QA ok</span>
                            <span className="text-[8px] text-white-dim/50 flex items-center gap-1"><span className="w-2 h-2 bg-yellow-500 inline-block" /> adjust</span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Segment count summary */}
                  <div className="flex items-center gap-3 p-2 bg-black-card border border-border-subtle">
                    <span className="text-sm text-orange-accent font-bold">{aiStrategy.segments.length} segments</span>
                    {gapInfo.count > 0 && (
                      <span className="text-xs text-yellow-500">{gapInfo.count} gap{gapInfo.count > 1 ? 's' : ''}</span>
                    )}
                    {gapInfo.count === 0 && (
                      <span className="text-xs text-green-500">100% covered</span>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setReviewStep('story')}
                      className="px-4 py-2.5 bg-black-card text-white-dim text-xs font-bold uppercase tracking-wide border border-border-subtle hover:border-orange-accent transition-all"
                    >
                      ← Back
                    </button>
                    <button
                      onClick={() => { runCropReview(); setReviewStep('adjust'); }}
                      disabled={reviewLoading}
                      className="flex-1 px-4 py-2.5 bg-orange-accent text-white text-sm font-bold uppercase tracking-wide border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <ShieldCheck className="w-4 h-4" />
                      Next: Check Quality →
                    </button>
                  </div>
                  <button
                    onClick={applyAIStrategy}
                    className="w-full px-3 py-2 text-xs text-white-dim font-bold uppercase tracking-wide border border-border-subtle hover:border-orange-accent hover:text-orange-accent transition-all text-center"
                  >
                    Skip QA — Apply directly
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ---- STEP: ADJUST (QA & Fix) ---- */}
          {reviewStep === 'adjust' && aiStrategy && (
            <div>
              <div className="p-3 bg-black-deep border border-border-subtle mb-4">
                <p className="text-sm text-white-muted mb-1">
                  <span className="text-orange-accent font-bold">Review & adjust</span> the AI's framing decisions.
                </p>
                <p className="text-[10px] text-white-dim">
                  The AI checked each crop for composition issues. Fix flagged segments, then apply.
                </p>
              </div>

              {/* Loading state */}
              {reviewLoading && (
                <div className="p-4 bg-black-card border border-border-subtle mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-white-muted">AI is reviewing each cropped frame for composition issues...</span>
                  </div>
                </div>
              )}

              {/* QA summary */}
              {cropReviews && !reviewLoading && (
                <div className="flex items-center gap-3 p-3 bg-black-card border border-border-subtle mb-4">
                  <ShieldCheck className="w-5 h-5 text-green-500 shrink-0" />
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-green-500 font-bold">{cropReviews.filter(r => r.quality === 'good').length} good</span>
                    {cropReviews.some(r => r.quality === 'needs_adjustment') && (
                      <span className="text-yellow-500 font-bold">{cropReviews.filter(r => r.quality === 'needs_adjustment').length} need adjustment</span>
                    )}
                    {cropReviews.some(r => r.quality === 'bad') && (
                      <span className="text-red-hot font-bold">{cropReviews.filter(r => r.quality === 'bad').length} problems</span>
                    )}
                  </div>
                </div>
              )}

              {/* Coverage timeline */}
              {duration > 0 && (
                <div className="mb-3">
                  <div className="relative w-full h-3 bg-red-hot/30 border border-border-subtle">
                    {aiStrategy.segments.map((seg, i) => {
                      const left = (seg.time_start / duration) * 100;
                      const width = Math.max(0.3, ((seg.time_end - seg.time_start) / duration) * 100);
                      const review = cropReviews?.[i];
                      const color = review
                        ? review.quality === 'good' ? 'bg-green-500' : review.quality === 'bad' ? 'bg-red-hot' : 'bg-yellow-500'
                        : 'bg-orange-accent';
                      return (
                        <div
                          key={i}
                          className={`absolute top-0 h-full ${color} cursor-pointer hover:opacity-80 transition-opacity`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          onClick={() => { setExpandedSegIdx(i); seekToFrame((seg.time_start + seg.time_end) / 2); }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Gap fill */}
              {gapInfo.count > 0 && (
                <div className="flex items-center gap-2 p-2 bg-yellow-500/10 border border-yellow-500/30 mb-3">
                  <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
                  <span className="text-xs text-yellow-500">
                    {gapInfo.count} gap{gapInfo.count > 1 ? 's' : ''} ({Math.round(gapInfo.totalSeconds)}s uncovered)
                  </span>
                  <button
                    onClick={fillGaps}
                    className="ml-auto px-3 py-1 text-xs font-bold uppercase text-black bg-yellow-500 hover:bg-yellow-400 transition-colors shrink-0"
                  >
                    Fill Gaps
                  </button>
                </div>
              )}

              {/* Segment list — click to expand & adjust */}
              <div className="max-h-[500px] overflow-y-auto space-y-1 mb-4">
                {aiStrategy.segments.map((seg, idx) => {
                  const review = cropReviews?.[idx];
                  const isExpanded = expandedSegIdx === idx;
                  const hasProblem = review && review.quality !== 'good';
                  const qualityBorder = review
                    ? review.quality === 'good' ? 'border-green-500/30' : review.quality === 'bad' ? 'border-red-hot/40' : 'border-yellow-500/40'
                    : 'border-border-subtle';

                  return (
                    <div key={idx} className={`bg-black-card border ${qualityBorder} transition-all`}>
                      <div
                        className="flex items-center gap-2 text-xs p-2.5 cursor-pointer hover:bg-black-deep/50"
                        onClick={() => { setExpandedSegIdx(isExpanded ? null : idx); seekToFrame((seg.time_start + seg.time_end) / 2); }}
                      >
                        {review ? (
                          <div className={`w-3 h-3 rounded-full shrink-0 ${
                            review.quality === 'good' ? 'bg-green-500' : review.quality === 'bad' ? 'bg-red-hot' : 'bg-yellow-500'
                          }`} />
                        ) : (
                          <div className="w-3 h-3 rounded-full shrink-0 bg-border-subtle" />
                        )}
                        <span className="text-white-dim font-mono shrink-0">
                          {formatTime(seg.time_start)}
                        </span>
                        <span className="text-orange-accent font-bold uppercase truncate">{seg.follow_subject}</span>
                        <div className="ml-auto flex items-center gap-1.5 shrink-0">
                          {hasProblem && (
                            <button
                              onClick={(e) => { e.stopPropagation(); autoFixSegment(idx); }}
                              className="px-2 py-0.5 text-[10px] font-bold uppercase text-black bg-yellow-500 hover:bg-yellow-400 transition-colors flex items-center gap-1"
                            >
                              <Wrench className="w-2.5 h-2.5" />
                              Fix
                            </button>
                          )}
                          <SlidersHorizontal className={`w-4 h-4 ${isExpanded ? 'text-orange-accent' : 'text-white-dim/40'}`} />
                        </div>
                      </div>

                      {isExpanded && (() => {
                        const nextFlaggedIdx = cropReviews
                          ? cropReviews.findIndex((r, i) => i > idx && r.quality !== 'good')
                          : -1;
                        const prevFlaggedCount = cropReviews
                          ? cropReviews.filter(r => r.quality !== 'good').length
                          : 0;

                        return (
                          <div className="px-3 pb-3 space-y-3 border-t border-border-subtle/50">
                            <div className="mt-3">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                <span className="text-xs font-bold text-white-muted uppercase tracking-wide">Live Preview</span>
                              </div>
                              <div className="flex justify-center">
                                <div className={`border-2 ${
                                  review
                                    ? review.quality === 'good' ? 'border-green-500' : review.quality === 'bad' ? 'border-red-hot' : 'border-yellow-500'
                                    : 'border-orange-accent'
                                }`}>
                                  <canvas
                                    ref={el => {
                                      if (el) {
                                        liveCropCanvasRef.current = el;
                                        requestAnimationFrame(() => renderLiveCrop(idx));
                                      }
                                    }}
                                    className="w-[200px] h-auto"
                                    style={{ display: 'block' }}
                                  />
                                </div>
                              </div>
                            </div>

                            {review && review.quality !== 'good' && review.issues.length > 0 && (
                              <div className={`p-2 border ${review.quality === 'bad' ? 'border-red-hot/30 bg-red-hot/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
                                {review.issues.map((issue, i) => (
                                  <div key={i} className="text-xs text-white-dim flex items-start gap-1">
                                    <span className={review.quality === 'bad' ? 'text-red-hot' : 'text-yellow-500'}>•</span>
                                    <span>{issue}</span>
                                  </div>
                                ))}
                                {review.suggestion && (
                                  <div className="mt-1 text-xs text-green-500 font-medium">{review.suggestion}</div>
                                )}
                              </div>
                            )}

                            <div className="space-y-2">
                              <div>
                                <div className="flex items-center justify-between">
                                  <label className="text-xs text-white-dim">← Left / Right →</label>
                                  <span className="text-xs text-orange-accent font-mono font-bold">{seg.offset_x > 0 ? '+' : ''}{seg.offset_x}</span>
                                </div>
                                <input
                                  type="range" min={-50} max={50} step={1} value={seg.offset_x}
                                  onChange={e => updateSegmentOffset(idx, 'offset_x', parseInt(e.target.value))}
                                  className="w-full h-2 accent-orange-accent cursor-pointer"
                                />
                              </div>
                              <div>
                                <div className="flex items-center justify-between">
                                  <label className="text-xs text-white-dim">↑ Up / Down ↓</label>
                                  <span className="text-xs text-orange-accent font-mono font-bold">{seg.offset_y > 0 ? '+' : ''}{seg.offset_y}</span>
                                </div>
                                <input
                                  type="range" min={-50} max={50} step={1} value={seg.offset_y}
                                  onChange={e => updateSegmentOffset(idx, 'offset_y', parseInt(e.target.value))}
                                  className="w-full h-2 accent-orange-accent cursor-pointer"
                                />
                              </div>
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                              <button
                                onClick={() => { updateSegmentOffset(idx, 'offset_x', 0); updateSegmentOffset(idx, 'offset_y', 0); }}
                                className="px-2 py-1 text-xs text-white-dim border border-border-subtle hover:border-orange-accent transition-colors"
                              >
                                Reset
                              </button>
                              {hasProblem && (
                                <button
                                  onClick={() => autoFixSegment(idx)}
                                  className="px-2 py-1 text-xs font-bold text-black bg-yellow-500 hover:bg-yellow-400 transition-colors flex items-center gap-1"
                                >
                                  <Wrench className="w-3 h-3" />
                                  Auto-fix
                                </button>
                              )}
                              <div className="flex-1" />
                              {nextFlaggedIdx >= 0 ? (
                                <button
                                  onClick={() => { setExpandedSegIdx(nextFlaggedIdx); seekToFrame((aiStrategy.segments[nextFlaggedIdx].time_start + aiStrategy.segments[nextFlaggedIdx].time_end) / 2); }}
                                  className="px-3 py-1.5 text-xs font-bold uppercase text-white bg-orange-accent hover:bg-red-hot transition-colors"
                                >
                                  Next Issue →
                                </button>
                              ) : prevFlaggedCount > 0 ? (
                                <button
                                  onClick={() => setExpandedSegIdx(null)}
                                  className="px-3 py-1.5 text-xs font-bold uppercase text-white bg-green-600 hover:bg-green-500 transition-colors flex items-center gap-1"
                                >
                                  <ShieldCheck className="w-3 h-3" />
                                  All Fixed
                                </button>
                              ) : (
                                <button
                                  onClick={() => setExpandedSegIdx(null)}
                                  className="px-3 py-1.5 text-xs font-bold uppercase text-white-dim border border-border-subtle hover:border-orange-accent transition-colors"
                                >
                                  Done
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>

              {/* Re-generate flagged */}
              {cropReviews && !reviewLoading && cropReviews.some(r => r.quality !== 'good') && (
                <button
                  onClick={regenFlaggedSegments}
                  disabled={aiLoading}
                  className="w-full px-3 py-2 mb-3 bg-black-card text-white text-xs font-bold uppercase tracking-wide border-2 border-yellow-500 hover:bg-yellow-500/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw className={`w-3 h-3 text-yellow-500 ${aiLoading ? 'animate-spin' : ''}`} />
                  {aiLoading ? 'Re-generating...' : `Re-generate ${cropReviews.filter(r => r.quality !== 'good').length} flagged with AI`}
                </button>
              )}

              {/* Re-check + Apply buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => setReviewStep('ai')}
                  className="px-4 py-2.5 bg-black-card text-white-dim text-xs font-bold uppercase tracking-wide border border-border-subtle hover:border-orange-accent transition-all"
                >
                  ← Back
                </button>
                <button
                  onClick={runCropReview}
                  disabled={reviewLoading}
                  className="px-4 py-2.5 bg-black-card text-green-500 text-xs font-bold uppercase tracking-wide border-2 border-green-500 hover:bg-green-500/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {cropReviews ? 'Re-check' : 'Run QA'}
                </button>
                <button
                  onClick={applyAIStrategy}
                  className="flex-1 px-4 py-2.5 bg-orange-accent text-white text-sm font-bold uppercase tracking-wide border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-4 h-4" />
                  Apply & Finish
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mt-3 p-3 bg-black-card border-2 border-red-hot">
          <p className="text-red-hot text-xs font-bold uppercase">Error</p>
          <p className="text-white-muted text-xs mt-1">{error}</p>
        </div>
      )}
    </div>
  );
}

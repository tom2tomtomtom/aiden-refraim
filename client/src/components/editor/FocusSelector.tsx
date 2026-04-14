import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useVideo } from '../../contexts/VideoContext';
import { useFocusPoints } from '../../contexts/FocusPointsContext';
import { useApi } from '../../contexts/ApiContext';
import VideoScannerService from '../../services/VideoScannerService';
import type { Subject as ScannerSubject } from '../../services/VideoScannerService';
import type { Subject, ScanOptions, ScanStatus } from '../../types/scan';
import type { FocusPointCreate } from '../../types/focusPoint';
import { segmentPositionsToFocusPoints } from '../../services/FocusInterpolationService';
import { Sparkles, Play, Pause } from 'lucide-react';

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

  // Compute focus position from AI strategy at current time
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

    return {
      x: Math.max(0, Math.min(100, avgX + (activeSeg.offset_x || 0))),
      y: Math.max(0, Math.min(100, avgY + (activeSeg.offset_y || 0))),
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
  const { focusPoints, addFocusPointsBatch, removeAllFocusPoints } = useFocusPoints();
  const { api } = useApi();

  // Local scan state
  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveDetection, setLiveDetection] = useState<LiveDetection | null>(null);
  const [subjectsTrackedCount, setSubjectsTrackedCount] = useState(0);

  // Review state
  const [detectedSubjects, setDetectedSubjects] = useState<Subject[]>([]);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());

  // AI editor state
  const [targetPlatform, setTargetPlatform] = useState('tiktok');
  const [aiStrategy, setAiStrategy] = useState<AIStrategy | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

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
      setLiveDetection(null);
      setScanStatus('review');
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
  }, []);

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

      const strategy = await api.getAIFocusStrategy(videoId, subjectInputs, duration, targetPlatform);
      setAiStrategy(strategy);
    } catch (err) {
      setError('AI suggestion failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setAiLoading(false);
    }
  }, [api, videoId, detectedSubjects, duration, targetPlatform]);

  const applyAIStrategy = useCallback(async () => {
    if (!aiStrategy) return;

    setScanStatus('finalizing');

    const focusPointCreates: FocusPointCreate[] = aiStrategy.segments.map(seg => {
      // Find the matching subject's positions
      const subject = detectedSubjects.find(s => s.class === seg.follow_subject);
      const positions = subject?.positions.filter(
        p => p.time >= seg.time_start && p.time <= seg.time_end
      ) || [];

      let baseX = 50, baseY = 50, width = 30, height = 30;

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
      }

      // Apply composition offsets
      const adjustedX = Math.max(0, Math.min(100 - width, baseX - width / 2 + seg.offset_x));
      const adjustedY = Math.max(0, Math.min(100 - height, baseY - height / 2 + seg.offset_y));

      return {
        time_start: seg.time_start,
        time_end: seg.time_end,
        x: adjustedX,
        y: adjustedY,
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
  }, [aiStrategy, detectedSubjects, addFocusPointsBatch]);

  if (!videoId) return null;

  return (
    <div className="bg-black-card border-2 border-border-subtle p-4">
      <h3 className="text-lg font-bold text-red-hot uppercase mb-3">Focus Points</h3>
      <p className="text-xs text-white-dim mb-3">
        Available Focus Points: {focusPoints.length}
      </p>

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

          {/* Existing focus points list */}
          {focusPoints.length > 0 && (
            <div className="mt-3 border-t border-border-subtle pt-3">
              <h4 className="text-xs font-bold text-white-muted uppercase tracking-wide mb-2">Active Focus Points</h4>
              <div className="space-y-1">
                {focusPoints.map(fp => (
                  <div key={fp.id} className="flex items-center justify-between text-xs text-white-muted bg-black-deep p-2 border border-border-subtle">
                    <span className="text-orange-accent font-bold uppercase">{fp.description}</span>
                    <span className="text-white-dim">
                      {formatTime(fp.time_start)} - {formatTime(fp.time_end)}
                    </span>
                  </div>
                ))}
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

      {/* Review state: show detected subjects for accept/reject */}
      {(scanStatus === 'review' || scanStatus === 'finalizing') && (
        <div className="mt-3">
          <h4 className="text-sm font-bold text-red-hot uppercase mb-2">Review Detected Subjects</h4>
          <p className="text-xs text-white-dim mb-3">
            {detectedSubjects.length > 0
              ? `${detectedSubjects.length} subject${detectedSubjects.length !== 1 ? 's' : ''} detected. Accept or reject each subject.`
              : 'No subjects detected. Try lowering the confidence threshold in Advanced Settings, or add focus points manually.'}
          </p>

          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={acceptAll}
              disabled={detectedSubjects.length === 0}
              className="px-3 py-1.5 bg-orange-accent text-white text-xs font-bold uppercase tracking-wide border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Accept All
            </button>
            <button
              onClick={rejectAll}
              disabled={detectedSubjects.length === 0}
              className="px-3 py-1.5 bg-red-hot text-white text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Reject All
            </button>
            <button
              onClick={finalize}
              disabled={scanStatus === 'finalizing' || acceptedIds.size === 0}
              className="px-3 py-1.5 bg-red-hot text-white text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scanStatus === 'finalizing' ? 'Finalizing...' : `Finalize (${acceptedIds.size})`}
            </button>
            <button
              onClick={cancelReview}
              className="px-3 py-1.5 bg-black-card text-white-muted text-xs font-bold uppercase tracking-wide border border-border-subtle hover:border-red-hot transition-all"
            >
              Cancel
            </button>
          </div>

          {/* AI Editor Section */}
          {detectedSubjects.length > 0 && (
            <div className="mb-4 p-3 bg-black-deep border border-border-subtle">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-orange-accent" />
                <h5 className="text-xs font-bold text-orange-accent uppercase tracking-wide">AI Focus Editor</h5>
              </div>

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
                <button
                  onClick={requestAISuggestion}
                  disabled={aiLoading}
                  className="px-3 py-1.5 bg-orange-accent text-white text-xs font-bold uppercase tracking-wide border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 shrink-0"
                >
                  <Sparkles className="w-3 h-3" />
                  {aiLoading ? 'Analyzing...' : 'AI Suggest'}
                </button>
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

                  <div className="max-h-64 overflow-y-auto space-y-1">
                    {aiStrategy.segments.map((seg, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-[10px] bg-black-card p-2 border border-border-subtle">
                        <span className="text-white-dim font-mono shrink-0">
                          {seg.time_start.toFixed(1)}s-{seg.time_end.toFixed(1)}s
                        </span>
                        <span className="text-orange-accent font-bold uppercase">{seg.follow_subject}</span>
                        <span className="text-white-dim">{seg.composition}</span>
                        <span className={`ml-auto px-1 ${seg.transition === 'hard_cut' ? 'text-red-hot' : 'text-green-500'}`}>
                          {seg.transition === 'hard_cut' ? 'CUT' : 'PAN'}
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={applyAIStrategy}
                    className="w-full px-3 py-2 bg-orange-accent text-white text-xs font-bold uppercase tracking-wide border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-3 h-3" />
                    Apply AI Strategy ({aiStrategy.segments.length} segments)
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {detectedSubjects.map(subject => {
              const isAccepted = acceptedIds.has(subject.id);
              const isRejected = rejectedIds.has(subject.id);
              let borderClass = 'border-2 border-border-subtle bg-black-card';
              if (isAccepted) borderClass = 'border-2 border-orange-accent bg-black-deep';
              if (isRejected) borderClass = 'border-2 border-red-hot bg-black-card';

              return (
                <div key={subject.id} className={`${borderClass} overflow-hidden p-3`}>
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-white-muted capitalize text-sm">{subject.class}</h4>
                    <span className="text-xs bg-black-deep text-orange-accent border border-orange-accent px-2 py-0.5">
                      {subject.positions.length} frames
                    </span>
                  </div>
                  <div className="text-xs text-white-dim mb-2">
                    <div>Time: {formatTime(subject.first_seen)} - {formatTime(subject.last_seen)}</div>
                    <div>Duration: {formatTime(subject.last_seen - subject.first_seen)}</div>
                  </div>
                  {/* Thumbnail */}
                  {thumbnails.has(subject.id) ? (
                    <div className="mb-2 border border-border-subtle overflow-hidden">
                      <img src={thumbnails.get(subject.id)} alt={subject.class} className="w-full" />
                    </div>
                  ) : (
                    <div className="mb-2 h-16 bg-black-deep border border-border-subtle flex items-center justify-center">
                      <span className="text-xs text-white-dim">No preview</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <button
                      onClick={() => rejectSubject(subject.id)}
                      className={`flex-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
                        isRejected
                          ? 'bg-red-hot text-white border-2 border-red-hot'
                          : 'border-2 border-red-hot text-red-hot hover:bg-red-hot hover:text-white'
                      }`}
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => acceptSubject(subject.id)}
                      className={`flex-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
                        isAccepted
                          ? 'bg-orange-accent text-white border-2 border-orange-accent'
                          : 'border-2 border-orange-accent text-orange-accent hover:bg-orange-accent hover:text-white'
                      }`}
                    >
                      Accept
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
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

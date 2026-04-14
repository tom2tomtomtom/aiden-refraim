import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useVideo } from '../contexts/VideoContext';
import { useFocusPoints } from '../contexts/FocusPointsContext';
import VideoExporter from '../components/video/VideoExporter';
import { OUTPUT_FORMATS } from '../types/video';
import { Play, Pause, Eye } from 'lucide-react';

const UNIQUE_RATIOS = [
  { label: '9:16', w: 9, h: 16, desc: 'TikTok / Stories / Shorts' },
  { label: '1:1', w: 1, h: 1, desc: 'Square Feed' },
  { label: '4:5', w: 4, h: 5, desc: 'Portrait Feed' },
  { label: '16:9', w: 16, h: 9, desc: 'YouTube / Landscape' },
];

function parseCompositionMode(description?: string): 'crop' | 'fit' | 'letterbox' {
  if (!description) return 'crop';
  const match = description.match(/\[(fit|letterbox|crop)\]/);
  return (match?.[1] as 'crop' | 'fit' | 'letterbox') || 'crop';
}

function ReframePreview({ ratioW, ratioH, label }: { ratioW: number; ratioH: number; label: string }) {
  const { videoUrl, videoElementRef, isPlaying, currentTime, setCurrentTime, setIsPlaying } = useVideo();
  const { activeFocusPoint } = useFocusPoints();
  const previewRef = useRef<HTMLVideoElement>(null);
  const blurBgRef = useRef<HTMLVideoElement>(null);

  const maxWidth = 320;
  const maxHeight = 400;
  const aspect = ratioW / ratioH;
  let previewW: number, previewH: number;
  if (aspect >= 1) {
    previewW = maxWidth;
    previewH = Math.round(maxWidth / aspect);
  } else {
    previewH = maxHeight;
    previewW = Math.round(maxHeight * aspect);
  }

  const compositionMode = useMemo(() => {
    if (!activeFocusPoint) return 'crop' as const;
    const explicit = parseCompositionMode(activeFocusPoint.description);
    if (explicit !== 'crop') return explicit;
    const sourceAspect = 16 / 9;
    const targetAspect = aspect;
    if (targetAspect < sourceAspect) {
      const visibleWidthFraction = targetAspect / sourceAspect;
      if (activeFocusPoint.width > visibleWidthFraction * 80) return 'fit' as const;
    }
    return 'crop' as const;
  }, [activeFocusPoint, aspect]);

  useEffect(() => {
    const main = videoElementRef.current;
    const preview = previewRef.current;
    const blur = blurBgRef.current;
    if (!main || (!preview && !blur)) return;

    let raf: number;
    const sync = () => {
      if (preview && Math.abs(preview.currentTime - main.currentTime) > 0.15) {
        preview.currentTime = main.currentTime;
      }
      if (blur && Math.abs(blur.currentTime - main.currentTime) > 0.15) {
        blur.currentTime = main.currentTime;
      }
      raf = requestAnimationFrame(sync);
    };
    raf = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(raf);
  }, [videoElementRef, videoUrl]);

  useEffect(() => {
    const previews = [previewRef.current, blurBgRef.current].filter(Boolean) as HTMLVideoElement[];
    if (previews.length === 0) return;
    if (isPlaying) { previews.forEach(v => v.play().catch(() => {})); }
    else { previews.forEach(v => v.pause()); }
  }, [isPlaying]);

  const focusX = activeFocusPoint ? activeFocusPoint.x : 50;
  const focusY = activeFocusPoint ? activeFocusPoint.y : 50;

  const togglePlay = useCallback(() => {
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  if (!videoUrl) return null;

  return (
    <div className="relative inline-block">
      {compositionMode !== 'crop' && (
        <span className="absolute top-2 right-2 z-10 text-[9px] px-1.5 py-0.5 bg-blue-500/80 text-white font-bold uppercase">
          {compositionMode === 'fit' ? 'Smart Fit' : 'Letterbox'}
        </span>
      )}
      <div
        className="overflow-hidden bg-black-ink border-2 border-border-subtle relative"
        style={{ width: `${previewW}px`, height: `${previewH}px` }}
      >
        {compositionMode === 'fit' ? (
          <>
            <video
              ref={blurBgRef}
              src={videoUrl}
              crossOrigin="anonymous"
              className="absolute inset-0 w-full h-full"
              style={{ objectFit: 'cover', filter: 'blur(20px) brightness(0.4)', transform: 'scale(1.2)' }}
              muted
              playsInline
              preload="auto"
            />
            <video
              ref={previewRef}
              src={videoUrl}
              crossOrigin="anonymous"
              className="absolute inset-0 w-full h-full"
              style={{ objectFit: 'contain' }}
              muted
              playsInline
              preload="auto"
            />
          </>
        ) : (
          <video
            ref={previewRef}
            src={videoUrl}
            crossOrigin="anonymous"
            className="w-full h-full"
            style={{
              objectFit: compositionMode === 'letterbox' ? 'contain' : 'cover',
              objectPosition: `${focusX}% ${focusY}%`,
            }}
            muted
            playsInline
            preload="auto"
          />
        )}
      </div>
      <button
        onClick={togglePlay}
        className="absolute bottom-2 left-2 bg-black/70 p-1.5 border border-border-subtle hover:bg-black/90 transition-colors z-10"
      >
        {isPlaying ? <Pause className="w-3 h-3 text-white" /> : <Play className="w-3 h-3 text-white" />}
      </button>
    </div>
  );
}

export default function ExportPage() {
  const { videoId: paramVideoId } = useParams<{ videoId: string }>();
  const { loadVideo, videoUrl, isLoading, videoElementRef, isPlaying, setIsPlaying, setCurrentTime, duration } = useVideo();
  const { loadFocusPoints, focusPoints } = useFocusPoints();
  const [activeRatio, setActiveRatio] = useState(UNIQUE_RATIOS[0]);
  const mainVideoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (paramVideoId && !videoUrl) {
      loadVideo(paramVideoId);
      loadFocusPoints(paramVideoId);
    }
  }, [paramVideoId, videoUrl, loadVideo, loadFocusPoints]);

  // Hidden main video for context sync
  const videoRefCallback = useCallback((el: HTMLVideoElement | null) => {
    (videoElementRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    mainVideoRef.current = el;
  }, [videoElementRef]);

  const handleTimeUpdate = useCallback(() => {
    const video = mainVideoRef.current;
    if (video) setCurrentTime(video.currentTime);
  }, [setCurrentTime]);

  const handlePlay = useCallback(() => setIsPlaying(true), [setIsPlaying]);
  const handlePause = useCallback(() => setIsPlaying(false), [setIsPlaying]);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="animate-pulse">
          <div className="h-64 bg-black-card border-2 border-border-subtle" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Hidden video element to drive VideoContext time */}
      {videoUrl && (
        <video
          ref={videoRefCallback}
          src={videoUrl}
          crossOrigin="anonymous"
          className="hidden"
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          preload="auto"
          playsInline
          muted
        />
      )}

      {/* Assembly Preview */}
      <div className="mb-6 bg-black-card border-2 border-border-subtle p-6">
        <div className="flex items-center gap-3 mb-4">
          <Eye className="w-5 h-5 text-orange-accent" />
          <h2 className="text-lg font-bold text-orange-accent uppercase">Assembly Preview</h2>
          <span className="text-xs text-white-dim">
            {focusPoints.length} focus point{focusPoints.length !== 1 ? 's' : ''} applied
          </span>
        </div>

        {/* Ratio tabs */}
        <div className="flex gap-2 mb-4">
          {UNIQUE_RATIOS.map(r => (
            <button
              key={r.label}
              onClick={() => setActiveRatio(r)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
                activeRatio.label === r.label
                  ? 'bg-orange-accent text-white border-2 border-orange-accent'
                  : 'bg-black-deep text-white-muted border-2 border-border-subtle hover:border-orange-accent'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Preview area */}
        <div className="flex flex-col items-center gap-3">
          <ReframePreview
            ratioW={activeRatio.w}
            ratioH={activeRatio.h}
            label={activeRatio.label}
          />
          <div className="text-center">
            <p className="text-xs text-white-dim uppercase tracking-wide">{activeRatio.desc}</p>
            <p className="text-[10px] text-white-dim mt-1">
              Play the video to see how your focus points drive the crop in real time
            </p>
          </div>

          {/* Simple scrubber */}
          {videoUrl && (
            <div className="w-full max-w-md flex items-center gap-3">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="p-2 bg-black-deep border border-border-subtle hover:border-orange-accent transition-colors"
              >
                {isPlaying ? <Pause className="w-4 h-4 text-white" /> : <Play className="w-4 h-4 text-white" />}
              </button>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={mainVideoRef.current?.currentTime || 0}
                onChange={e => {
                  const t = parseFloat(e.target.value);
                  if (mainVideoRef.current) mainVideoRef.current.currentTime = t;
                  setCurrentTime(t);
                }}
                className="flex-1 accent-orange-accent h-1 cursor-pointer"
              />
            </div>
          )}
        </div>

        {focusPoints.length === 0 && (
          <div className="mt-4 p-3 bg-black-deep border border-border-subtle text-center">
            <p className="text-xs text-white-dim">
              No focus points set. The export will use center-crop.{' '}
              <Link to={`/editor/${paramVideoId}`} className="text-orange-accent hover:text-red-hot">
                Go back to the Editor
              </Link>{' '}
              to scan &amp; apply AI focus.
            </p>
          </div>
        )}
      </div>

      {/* Export controls below */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <VideoExporter />
        </div>
        <div className="space-y-4">
          <Link
            to={`/editor/${paramVideoId}`}
            className="block w-full text-center bg-black-card text-white-muted px-6 py-3 text-xs font-bold uppercase tracking-wide border border-border-subtle hover:border-red-hot transition-all"
          >
            Back to Editor
          </Link>
        </div>
      </div>
    </div>
  );
}

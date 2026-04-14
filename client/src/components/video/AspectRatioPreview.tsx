import React, { useRef, useEffect, useMemo } from 'react';
import { useVideo } from '../../contexts/VideoContext';
import { useFocusPoints } from '../../contexts/FocusPointsContext';

interface AspectRatioPreviewProps {
  ratio: string;  // '9:16', '1:1', '4:5'
  width: number;
}

function parseCompositionMode(description?: string): 'crop' | 'fit' | 'letterbox' {
  if (!description) return 'crop';
  const match = description.match(/\[(fit|letterbox|crop)\]/);
  return (match?.[1] as 'crop' | 'fit' | 'letterbox') || 'crop';
}

export default function AspectRatioPreview({ ratio, width }: AspectRatioPreviewProps) {
  const { videoUrl, isPlaying, videoElementRef } = useVideo();
  const { activeFocusPoint } = useFocusPoints();
  const fillVideoRef = useRef<HTMLVideoElement>(null);
  const blurBgRef = useRef<HTMLVideoElement>(null);

  const [ratioW, ratioH] = ratio.split(':').map(Number);
  const aspectRatio = (ratioW || 1) / (ratioH || 1);
  const height = Math.round(width / aspectRatio);

  const compositionMode = useMemo(() => {
    if (!activeFocusPoint) return 'crop';
    const explicit = parseCompositionMode(activeFocusPoint.description);
    if (explicit !== 'crop') return explicit;
    // Auto-detect: if subject bbox is large relative to what the target crop shows
    const sourceAspect = 16 / 9;
    const targetAspect = aspectRatio;
    if (targetAspect < sourceAspect) {
      const visibleWidthFraction = targetAspect / sourceAspect;
      if (activeFocusPoint.width > visibleWidthFraction * 80) return 'fit';
    }
    return 'crop';
  }, [activeFocusPoint, aspectRatio]);

  useEffect(() => {
    const mainVideo = videoElementRef.current;
    const fillVideo = fillVideoRef.current;
    const blurVideo = blurBgRef.current;
    if (!mainVideo || (!fillVideo && !blurVideo)) return;

    let animFrameId: number;
    const sync = () => {
      const mainTime = mainVideo.currentTime;
      if (fillVideo && Math.abs(fillVideo.currentTime - mainTime) > 0.1) {
        fillVideo.currentTime = mainTime;
      }
      if (blurVideo && Math.abs(blurVideo.currentTime - mainTime) > 0.1) {
        blurVideo.currentTime = mainTime;
      }
      animFrameId = requestAnimationFrame(sync);
    };

    animFrameId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(animFrameId);
  }, [videoUrl, videoElementRef]);

  useEffect(() => {
    const previews = [fillVideoRef.current, blurBgRef.current].filter(Boolean) as HTMLVideoElement[];
    if (previews.length === 0) return;
    if (isPlaying) {
      previews.forEach(v => v.play().catch(() => {}));
    } else {
      previews.forEach(v => v.pause());
    }
  }, [isPlaying]);

  const focusX = activeFocusPoint ? activeFocusPoint.x : 50;
  const focusY = activeFocusPoint ? activeFocusPoint.y : 50;

  if (!videoUrl) {
    return (
      <div className="mb-4">
        <h3 className="text-sm font-bold text-orange-accent uppercase tracking-wide mb-1">{ratio} Ratio</h3>
        <div
          className="bg-black-card border border-border-subtle flex items-center justify-center"
          style={{ width: `${width}px`, height: `${height}px` }}
        >
          <p className="text-white-dim text-xs uppercase tracking-wide">Upload a video</p>
        </div>
      </div>
    );
  }

  const modeLabel = compositionMode === 'fit' ? 'Smart Fit' : compositionMode === 'letterbox' ? 'Letterbox' : 'Crop';

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-1">
        <h3 className="text-sm font-bold text-orange-accent uppercase tracking-wide">{ratio} Ratio</h3>
        {compositionMode !== 'crop' && (
          <span className="text-[9px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 font-bold uppercase">
            {modeLabel}
          </span>
        )}
      </div>

      <div
        className="overflow-hidden bg-black-ink border border-border-subtle relative"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        {compositionMode === 'fit' ? (
          <>
            {/* Blurred background */}
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
            {/* Sharp foreground fitted */}
            <video
              ref={fillVideoRef}
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
            ref={fillVideoRef}
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
    </div>
  );
}

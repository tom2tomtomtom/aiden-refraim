import React, { useRef, useEffect } from 'react';
import { useVideo } from '../../contexts/VideoContext';
import { useFocusPoints } from '../../contexts/FocusPointsContext';

interface AspectRatioPreviewProps {
  ratio: string;  // '9:16', '1:1', '4:5'
  width: number;
}

export default function AspectRatioPreview({ ratio, width }: AspectRatioPreviewProps) {
  const { videoUrl, isPlaying, videoElementRef } = useVideo();
  const { activeFocusPoint } = useFocusPoints();
  const fillVideoRef = useRef<HTMLVideoElement>(null);
  const letterboxVideoRef = useRef<HTMLVideoElement>(null);

  const [ratioW, ratioH] = ratio.split(':').map(Number);
  const aspectRatio = (ratioW || 1) / (ratioH || 1);
  const height = Math.round(width / aspectRatio);

  // Sync both preview videos with main player via requestAnimationFrame
  useEffect(() => {
    const mainVideo = videoElementRef.current;
    const fillVideo = fillVideoRef.current;
    const letterboxVideo = letterboxVideoRef.current;
    if (!mainVideo || (!fillVideo && !letterboxVideo)) return;

    let animFrameId: number;
    const sync = () => {
      const mainTime = mainVideo.currentTime;
      if (fillVideo && Math.abs(fillVideo.currentTime - mainTime) > 0.1) {
        fillVideo.currentTime = mainTime;
      }
      if (letterboxVideo && Math.abs(letterboxVideo.currentTime - mainTime) > 0.1) {
        letterboxVideo.currentTime = mainTime;
      }
      animFrameId = requestAnimationFrame(sync);
    };

    animFrameId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(animFrameId);
  }, [videoUrl, videoElementRef]);

  // Mirror play/pause state from main player
  useEffect(() => {
    const previews = [fillVideoRef.current, letterboxVideoRef.current].filter(Boolean) as HTMLVideoElement[];
    if (previews.length === 0) return;

    if (isPlaying) {
      previews.forEach(v => v.play().catch(() => {}));
    } else {
      previews.forEach(v => v.pause());
    }
  }, [isPlaying]);

  // Determine focus point for object-position
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

  return (
    <div className="mb-4">
      <h3 className="text-sm font-bold text-orange-accent uppercase tracking-wide mb-1">{ratio} Ratio</h3>

      {/* Fill and Crop preview */}
      <p className="text-xs text-white-dim uppercase tracking-wide mb-1">Fill and Crop:</p>
      <div
        className="overflow-hidden bg-black-ink border border-border-subtle mb-2"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        <video
          ref={fillVideoRef}
          src={videoUrl}
          crossOrigin="anonymous"
          className="w-full h-full"
          style={{
            objectFit: 'cover',
            objectPosition: `${focusX}% ${focusY}%`,
          }}
          muted
          playsInline
          preload="auto"
        />
      </div>

      {/* Letterbox preview */}
      <p className="text-xs text-white-dim uppercase tracking-wide mb-1">With Letterboxing:</p>
      <div
        className="overflow-hidden bg-black-ink border border-border-subtle flex items-center justify-center"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        <video
          ref={letterboxVideoRef}
          src={videoUrl}
          crossOrigin="anonymous"
          className="max-w-full max-h-full"
          style={{
            objectFit: 'contain',
          }}
          muted
          playsInline
          preload="auto"
        />
      </div>
    </div>
  );
}

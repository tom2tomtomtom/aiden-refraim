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
  const videoRef = useRef<HTMLVideoElement>(null);

  const [ratioW, ratioH] = ratio.split(':').map(Number);
  const aspectRatio = (ratioW || 1) / (ratioH || 1);
  const height = Math.round(width / aspectRatio);

  useEffect(() => {
    const mainVideo = videoElementRef.current;
    const preview = videoRef.current;
    if (!mainVideo || !preview) return;

    let animFrameId: number;
    const sync = () => {
      if (Math.abs(preview.currentTime - mainVideo.currentTime) > 0.1) {
        preview.currentTime = mainVideo.currentTime;
      }
      animFrameId = requestAnimationFrame(sync);
    };

    animFrameId = requestAnimationFrame(sync);
    return () => cancelAnimationFrame(animFrameId);
  }, [videoUrl, videoElementRef]);

  useEffect(() => {
    const preview = videoRef.current;
    if (!preview) return;
    if (isPlaying) { preview.play().catch(() => {}); }
    else { preview.pause(); }
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

  return (
    <div className="mb-4">
      <h3 className="text-sm font-bold text-orange-accent uppercase tracking-wide mb-1">{ratio} Ratio</h3>
      <div
        className="overflow-hidden bg-black-ink border border-border-subtle"
        style={{ width: `${width}px`, height: `${height}px` }}
      >
        <video
          ref={videoRef}
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
    </div>
  );
}

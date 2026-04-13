import React, { useRef, useEffect, useCallback } from 'react';
import { useVideo } from '../../contexts/VideoContext';

export default function VideoPlayer() {
  const {
    videoUrl,
    currentTime,
    isPlaying,
    setCurrentTime,
    setIsPlaying,
    setDuration,
    videoElementRef,
  } = useVideo();

  const containerRef = useRef<HTMLDivElement>(null);
  const lastSyncRef = useRef(0);

  // Assign video element ref to context
  const videoRefCallback = useCallback((el: HTMLVideoElement | null) => {
    (videoElementRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
  }, [videoElementRef]);

  // Sync playback state from context to video element
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;

    if (isPlaying) {
      video.play().catch(() => setIsPlaying(false));
    } else {
      video.pause();
    }
  }, [isPlaying, videoElementRef, setIsPlaying]);

  // Sync seek from context to video element (when timeline scrubs)
  useEffect(() => {
    const video = videoElementRef.current;
    if (!video) return;
    if (Math.abs(video.currentTime - currentTime) > 0.5) {
      video.currentTime = currentTime;
    }
  }, [currentTime, videoElementRef]);

  // Handle video element events
  const handleTimeUpdate = useCallback(() => {
    const video = videoElementRef.current;
    if (!video) return;
    const now = performance.now();
    if (now - lastSyncRef.current < 100) return; // throttle to 10fps
    lastSyncRef.current = now;
    setCurrentTime(video.currentTime);
  }, [videoElementRef, setCurrentTime]);

  const handleDurationChange = useCallback(() => {
    const video = videoElementRef.current;
    if (video && video.duration && isFinite(video.duration)) {
      setDuration(video.duration);
    }
  }, [videoElementRef, setDuration]);

  const handlePlay = useCallback(() => setIsPlaying(true), [setIsPlaying]);
  const handlePause = useCallback(() => setIsPlaying(false), [setIsPlaying]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const video = videoElementRef.current;
      if (!video) return;

      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault();
          setIsPlaying(!isPlaying);
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          setCurrentTime(Math.min(video.duration, video.currentTime + 5));
          break;
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          setCurrentTime(Math.max(0, video.currentTime - 5));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, setIsPlaying, setCurrentTime, videoElementRef]);

  if (!videoUrl) {
    return (
      <div className="aspect-video bg-black-card border-2 border-border-subtle flex items-center justify-center">
        <p className="text-white-dim text-sm uppercase tracking-wide">No video loaded</p>
      </div>
    );
  }

  const togglePlayPause = useCallback(() => {
    setIsPlaying(!isPlaying);
  }, [isPlaying, setIsPlaying]);

  return (
    <div ref={containerRef} className="relative cursor-pointer" onClick={togglePlayPause}>
      <video
        ref={videoRefCallback}
        src={videoUrl}
        className="w-full aspect-video bg-black-ink"
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onLoadedMetadata={handleDurationChange}
        onPlay={handlePlay}
        onPause={handlePause}
        preload="metadata"
        playsInline
      />
      {/* Play/pause overlay */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
          isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'
        }`}
        style={{ pointerEvents: 'none' }}
      >
        <div className="bg-black/50 p-5">
          {isPlaying ? (
            <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-12 h-12 text-white" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6,4 20,12 6,20" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}

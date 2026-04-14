import React, { useRef, useCallback, useState, useEffect } from 'react';
import { useVideo } from '../../contexts/VideoContext';
import { useFocusPoints } from '../../contexts/FocusPointsContext';

interface VideoTimelineProps {
  selectedPointId?: string | null;
  onFocusPointSelect?: (id: string | null) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function VideoTimeline({ selectedPointId, onFocusPointSelect }: VideoTimelineProps = {}) {
  const { currentTime, duration, isPlaying, setCurrentTime, setIsPlaying } = useVideo();
  const { focusPoints } = useFocusPoints();
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const seekToPosition = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || duration === 0) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setCurrentTime(pct * duration);
  }, [duration, setCurrentTime]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    seekToPosition(e.clientX);
  }, [seekToPosition]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => seekToPosition(e.clientX);
    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, seekToPosition]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        setCurrentTime(Math.min(duration, currentTime + 5));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        setCurrentTime(Math.max(0, currentTime - 5));
        break;
      case 'Home':
        e.preventDefault();
        setCurrentTime(0);
        break;
      case 'End':
        e.preventDefault();
        setCurrentTime(duration);
        break;
      case ' ':
        e.preventDefault();
        setIsPlaying(!isPlaying);
        break;
    }
  }, [currentTime, duration, isPlaying, setCurrentTime, setIsPlaying]);

  return (
    <div className="bg-black-card border-2 border-border-subtle p-3">
      <div className="flex items-center gap-3">
        {/* Play/Pause */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className="bg-red-hot text-white w-8 h-8 flex items-center justify-center text-xs font-bold uppercase hover:bg-red-dim transition-all"
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>

        {/* Time display */}
        <span className="text-white-dim text-xs font-mono min-w-[90px]">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {/* Timeline track */}
        <div
          ref={trackRef}
          className="flex-1 h-6 bg-black-deep relative cursor-pointer select-none"
          onMouseDown={handleMouseDown}
          onKeyDown={handleKeyDown}
          tabIndex={0}
          role="slider"
          aria-label="Video timeline"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
        >
          {/* Progress bar */}
          <div
            className="absolute top-0 left-0 h-full bg-red-hot pointer-events-none"
            style={{ width: `${progressPct}%` }}
          />

          {/* Focus point markers */}
          {focusPoints.map(fp => {
            if (duration === 0) return null;
            const leftPct = (fp.time_start / duration) * 100;
            const widthPct = ((fp.time_end - fp.time_start) / duration) * 100;
            const isSelected = fp.id === selectedPointId;
            return (
              <div
                key={fp.id}
                className={`absolute top-0 h-full cursor-pointer transition-opacity ${
                  isSelected
                    ? 'bg-red-hot opacity-60 z-10'
                    : 'bg-yellow-electric opacity-40 hover:opacity-60'
                }`}
                style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 0.5)}%` }}
                title={`${fp.description} (${formatTime(fp.time_start)} - ${formatTime(fp.time_end)})`}
                onClick={(e) => {
                  e.stopPropagation();
                  onFocusPointSelect?.(isSelected ? null : fp.id);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setCurrentTime(fp.time_start);
                  onFocusPointSelect?.(fp.id);
                }}
              />
            );
          })}

          {/* Playhead cursor */}
          <div
            className="absolute top-0 w-1 h-full bg-white-full pointer-events-none"
            style={{ left: `${progressPct}%` }}
          >
            <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-black-card border border-border-subtle px-1 py-0.5 text-[10px] text-white-dim font-mono whitespace-nowrap pointer-events-none">
              {formatTime(currentTime)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

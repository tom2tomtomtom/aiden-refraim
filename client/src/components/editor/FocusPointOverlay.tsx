import React, { useRef, useCallback, useState } from 'react';
import { useVideo } from '../../contexts/VideoContext';
import { useFocusPoints } from '../../contexts/FocusPointsContext';
import { useInterpolatedPosition } from '../../hooks/useActiveFocusPoint';
import type { FocusPointCreate } from '../../types/focusPoint';

interface FocusPointOverlayProps {
  onFocusPointSelect?: (id: string | null) => void;
  selectedPointId?: string | null;
}

export default function FocusPointOverlay({ onFocusPointSelect, selectedPointId }: FocusPointOverlayProps) {
  const { currentTime, duration, videoElementRef } = useVideo();
  const { focusPoints, addFocusPoint, updateFocusPoint } = useFocusPoints();
  const interpolated = useInterpolatedPosition(focusPoints, currentTime);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPointId, setDragPointId] = useState<string | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; fpX: number; fpY: number } | null>(null);

  const getRelativePosition = useCallback((clientX: number, clientY: number) => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const rect = overlay.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
  }, []);

  // Get focus points active at current time
  const activeFocusPoints = focusPoints.filter(
    fp => currentTime >= fp.time_start && currentTime <= fp.time_end
  );

  const handleOverlayClick = useCallback(async (e: React.MouseEvent) => {
    if (isDragging) return;

    const pos = getRelativePosition(e.clientX, e.clientY);
    if (!pos) return;

    // Check if clicking on an existing focus point
    const clickedFp = activeFocusPoints.find(fp => {
      return pos.x >= fp.x && pos.x <= fp.x + fp.width &&
             pos.y >= fp.y && pos.y <= fp.y + fp.height;
    });

    if (clickedFp) {
      onFocusPointSelect?.(clickedFp.id);
      return;
    }

    // Deselect if clicking empty space
    onFocusPointSelect?.(null);
  }, [isDragging, getRelativePosition, activeFocusPoints, onFocusPointSelect]);

  const handleDoubleClick = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const pos = getRelativePosition(e.clientX, e.clientY);
    if (!pos) return;

    const defaultSize = 20;
    const newFocusPoint: FocusPointCreate = {
      time_start: currentTime,
      time_end: Math.min(currentTime + 3, duration),
      x: Math.max(0, Math.min(pos.x - defaultSize / 2, 100 - defaultSize)),
      y: Math.max(0, Math.min(pos.y - defaultSize / 2, 100 - defaultSize)),
      width: defaultSize,
      height: defaultSize,
      description: 'manual_focus',
      source: 'manual',
    };

    await addFocusPoint(newFocusPoint);
  }, [currentTime, duration, getRelativePosition, addFocusPoint]);

  const handleMouseDown = useCallback((e: React.MouseEvent, fpId: string) => {
    e.stopPropagation();
    const fp = focusPoints.find(f => f.id === fpId);
    if (!fp) return;

    const pos = getRelativePosition(e.clientX, e.clientY);
    if (!pos) return;

    setIsDragging(true);
    setDragPointId(fpId);
    dragStartRef.current = { x: pos.x, y: pos.y, fpX: fp.x, fpY: fp.y };
    onFocusPointSelect?.(fpId);
  }, [focusPoints, getRelativePosition, onFocusPointSelect]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !dragPointId || !dragStartRef.current) return;

    const pos = getRelativePosition(e.clientX, e.clientY);
    if (!pos) return;

    const fp = focusPoints.find(f => f.id === dragPointId);
    if (!fp) return;

    const dx = pos.x - dragStartRef.current.x;
    const dy = pos.y - dragStartRef.current.y;

    const newX = Math.max(0, Math.min(dragStartRef.current.fpX + dx, 100 - fp.width));
    const newY = Math.max(0, Math.min(dragStartRef.current.fpY + dy, 100 - fp.height));

    updateFocusPoint(dragPointId, { x: newX, y: newY });
  }, [isDragging, dragPointId, focusPoints, getRelativePosition, updateFocusPoint]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragPointId(null);
    dragStartRef.current = null;
  }, []);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 z-10"
      onClick={handleOverlayClick}
      onDoubleClick={handleDoubleClick}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Interpolated position indicator (ghost box) */}
      {interpolated && !selectedPointId && (
        <div
          className="absolute border border-dashed border-yellow-electric/40 pointer-events-none"
          style={{
            left: `${interpolated.x}%`,
            top: `${interpolated.y}%`,
            width: `${interpolated.width}%`,
            height: `${interpolated.height}%`,
          }}
        />
      )}

      {/* Active focus point boxes */}
      {activeFocusPoints.map(fp => {
        const isSelected = fp.id === selectedPointId;
        const borderColor = isSelected ? 'border-red-hot' : 'border-yellow-electric';
        const bgColor = isSelected ? 'bg-red-hot/10' : 'bg-yellow-electric/5';

        return (
          <div
            key={fp.id}
            className={`absolute border-2 ${borderColor} ${bgColor} cursor-move transition-colors`}
            style={{
              left: `${fp.x}%`,
              top: `${fp.y}%`,
              width: `${fp.width}%`,
              height: `${fp.height}%`,
            }}
            onMouseDown={(e) => handleMouseDown(e, fp.id)}
          >
            {/* Label */}
            <div className={`absolute -top-5 left-0 px-1 text-[10px] font-bold uppercase tracking-wide ${
              isSelected ? 'bg-red-hot text-white' : 'bg-yellow-electric/90 text-black'
            }`}>
              {fp.description}
            </div>

            {/* Resize handles (corners) for selected point */}
            {isSelected && (
              <>
                <div className="absolute -top-1 -left-1 w-2 h-2 bg-red-hot cursor-nw-resize" />
                <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-hot cursor-ne-resize" />
                <div className="absolute -bottom-1 -left-1 w-2 h-2 bg-red-hot cursor-sw-resize" />
                <div className="absolute -bottom-1 -right-1 w-2 h-2 bg-red-hot cursor-se-resize" />
              </>
            )}
          </div>
        );
      })}

      {/* Double-click hint when no focus points */}
      {activeFocusPoints.length === 0 && focusPoints.length === 0 && (
        <div className="absolute bottom-2 left-2 px-2 py-1 bg-black/60 text-white-dim text-[10px] uppercase tracking-wide pointer-events-none">
          Double-click to add focus point
        </div>
      )}
    </div>
  );
}

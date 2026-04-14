import { useMemo } from 'react';
import type { FocusPoint } from '../types/focusPoint';
import { getSmartFocusPosition, type InterpolatedPosition } from '../services/FocusInterpolationService';

/**
 * Returns the active interpolated focus point for the current playback time.
 * Uses smart subject prioritization and smooth position blending.
 */
export function useActiveFocusPoint(
  focusPoints: FocusPoint[],
  currentTime: number
): FocusPoint | null {
  return useMemo(() => {
    if (focusPoints.length === 0 || currentTime === null || currentTime === undefined) {
      return null;
    }

    const interpolated = getSmartFocusPosition(focusPoints, currentTime);
    if (!interpolated) return null;

    // Return a synthetic FocusPoint with interpolated values
    // Find the closest real focus point for metadata
    const closest = focusPoints.reduce((best, fp) => {
      const dist = Math.abs(fp.time_start - currentTime);
      const bestDist = Math.abs(best.time_start - currentTime);
      return dist < bestDist ? fp : best;
    });

    return {
      ...closest,
      x: interpolated.x,
      y: interpolated.y,
      width: interpolated.width,
      height: interpolated.height,
    };
  }, [focusPoints, currentTime]);
}

/**
 * Raw interpolated position with blend factor and scoring metadata.
 */
export function useInterpolatedPosition(
  focusPoints: FocusPoint[],
  currentTime: number
): InterpolatedPosition | null {
  return useMemo(
    () => getSmartFocusPosition(focusPoints, currentTime),
    [focusPoints, currentTime]
  );
}

export default useActiveFocusPoint;

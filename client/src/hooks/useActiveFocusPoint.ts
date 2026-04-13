import { useMemo } from 'react';
import type { FocusPoint } from '../types/focusPoint';

export function findActiveFocusPoint(
  focusPoints: FocusPoint[],
  currentTime: number | null | undefined
): FocusPoint | null {
  if (currentTime === null || currentTime === undefined) return null;
  return (
    focusPoints.find(
      (point) => currentTime >= point.time_start && currentTime <= point.time_end
    ) || null
  );
}

export function useActiveFocusPoint(
  focusPoints: FocusPoint[],
  currentTime: number
): FocusPoint | null {
  return useMemo(
    () => findActiveFocusPoint(focusPoints, currentTime),
    [focusPoints, currentTime]
  );
}

export default useActiveFocusPoint;

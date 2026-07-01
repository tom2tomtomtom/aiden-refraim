import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useActiveFocusPoint } from '../useActiveFocusPoint';
import type { FocusPoint } from '../../types/focusPoint';

function makeFocusPoint(overrides: Partial<FocusPoint> = {}): FocusPoint {
  return {
    id: 'fp-1',
    video_id: 'vid-1',
    time_start: 5,
    time_end: 10,
    x: 50,
    y: 50,
    width: 20,
    height: 20,
    description: 'test focus point',
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('useActiveFocusPoint', () => {
  it('returns null when focusPoints is empty', () => {
    const { result } = renderHook(() => useActiveFocusPoint([], 5));
    expect(result.current).toBeNull();
  });

  it('returns a focus point derived from the set when time is within range', () => {
    const points = [makeFocusPoint({ time_start: 5, time_end: 10 })];
    const { result } = renderHook(() => useActiveFocusPoint(points, 7));
    expect(result.current).not.toBeNull();
    expect(result.current?.id).toBe('fp-1');
  });

  it('carries metadata from the nearest focus point', () => {
    const points = [
      makeFocusPoint({ id: 'fp-1', time_start: 5, time_end: 10 }),
      makeFocusPoint({ id: 'fp-2', time_start: 15, time_end: 20, description: 'second' }),
    ];
    const { result } = renderHook(() => useActiveFocusPoint(points, 16));
    expect(result.current?.id).toBe('fp-2');
  });
});

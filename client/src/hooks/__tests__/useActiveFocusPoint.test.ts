import { describe, it, expect } from 'vitest';
import { findActiveFocusPoint } from '../useActiveFocusPoint';
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

describe('findActiveFocusPoint', () => {
  it('returns null when focusPoints is empty', () => {
    expect(findActiveFocusPoint([], 5)).toBeNull();
  });

  it('returns null when currentTime is null', () => {
    const points = [makeFocusPoint()];
    expect(findActiveFocusPoint(points, null)).toBeNull();
  });

  it('returns null when currentTime is undefined', () => {
    const points = [makeFocusPoint()];
    expect(findActiveFocusPoint(points, undefined)).toBeNull();
  });

  it('returns null when currentTime is outside all focus points', () => {
    const points = [
      makeFocusPoint({ time_start: 5, time_end: 10 }),
      makeFocusPoint({ id: 'fp-2', time_start: 15, time_end: 20 }),
    ];
    expect(findActiveFocusPoint(points, 12)).toBeNull();
  });

  it('returns the focus point that contains currentTime', () => {
    const target = makeFocusPoint({ id: 'fp-2', time_start: 15, time_end: 20 });
    const points = [
      makeFocusPoint({ time_start: 5, time_end: 10 }),
      target,
    ];
    expect(findActiveFocusPoint(points, 17)).toEqual(target);
  });

  it('returns first match when multiple focus points overlap', () => {
    const first = makeFocusPoint({ id: 'fp-1', time_start: 5, time_end: 15 });
    const second = makeFocusPoint({ id: 'fp-2', time_start: 10, time_end: 20 });
    const points = [first, second];
    expect(findActiveFocusPoint(points, 12)).toEqual(first);
  });

  it('returns focus point when currentTime equals time_end (inclusive boundary)', () => {
    const point = makeFocusPoint({ time_start: 5, time_end: 10 });
    expect(findActiveFocusPoint([point], 10)).toEqual(point);
  });

  it('returns focus point when currentTime equals time_start (boundary)', () => {
    const point = makeFocusPoint({ time_start: 5, time_end: 10 });
    expect(findActiveFocusPoint([point], 5)).toEqual(point);
  });
});

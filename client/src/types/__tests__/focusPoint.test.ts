import { describe, it, expect } from 'vitest';
import { validateFocusPoint } from '../focusPoint';
import type { FocusPointCreate } from '../focusPoint';

function makeValid(overrides: Partial<FocusPointCreate> = {}): FocusPointCreate {
  return {
    time_start: 0,
    time_end: 10,
    x: 25,
    y: 25,
    width: 50,
    height: 50,
    description: 'A valid focus point',
    source: 'manual',
    ...overrides,
  };
}

describe('validateFocusPoint', () => {
  it('returns empty array for valid focus point', () => {
    expect(validateFocusPoint(makeValid())).toEqual([]);
  });

  it('rejects negative time_start', () => {
    const errors = validateFocusPoint(makeValid({ time_start: -1 }));
    expect(errors).toContain('time_start must be >= 0');
  });

  it('rejects time_end <= time_start', () => {
    const errors = validateFocusPoint(makeValid({ time_start: 10, time_end: 10 }));
    expect(errors).toContain('time_end must be > time_start');

    const errors2 = validateFocusPoint(makeValid({ time_start: 10, time_end: 5 }));
    expect(errors2).toContain('time_end must be > time_start');
  });

  it('rejects x outside 0-100', () => {
    expect(validateFocusPoint(makeValid({ x: -1 }))).toContain('x must be 0-100');
    expect(validateFocusPoint(makeValid({ x: 101 }))).toContain('x must be 0-100');
  });

  it('rejects y outside 0-100', () => {
    expect(validateFocusPoint(makeValid({ y: -1 }))).toContain('y must be 0-100');
    expect(validateFocusPoint(makeValid({ y: 101 }))).toContain('y must be 0-100');
  });

  it('rejects width <= 0', () => {
    expect(validateFocusPoint(makeValid({ width: 0 }))).toContain('width must be 0-100');
    expect(validateFocusPoint(makeValid({ width: -5 }))).toContain('width must be 0-100');
  });

  it('rejects x + width > 100', () => {
    const errors = validateFocusPoint(makeValid({ x: 60, width: 50 }));
    expect(errors).toContain('x + width must be <= 100');
  });

  it('rejects y + height > 100', () => {
    const errors = validateFocusPoint(makeValid({ y: 60, height: 50 }));
    expect(errors).toContain('y + height must be <= 100');
  });

  it('rejects empty description', () => {
    expect(validateFocusPoint(makeValid({ description: '' }))).toContain('description required');
    expect(validateFocusPoint(makeValid({ description: '   ' }))).toContain('description required');
  });
});

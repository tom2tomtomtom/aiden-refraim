export interface FocusPoint {
  id: string;
  video_id: string;
  time_start: number;
  time_end: number;
  x: number;          // 0-100 percentage
  y: number;          // 0-100 percentage
  width: number;      // 0-100 percentage
  height: number;     // 0-100 percentage
  description: string;
  source: 'manual' | 'ai_detection';
  created_at: string;
  updated_at: string;
}

export interface FocusPointCreate {
  time_start: number;
  time_end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
  source: 'manual' | 'ai_detection';
}

export function validateFocusPoint(fp: FocusPointCreate): string[] {
  const errors: string[] = [];
  if (fp.time_start < 0) errors.push('time_start must be >= 0');
  if (fp.time_end <= fp.time_start) errors.push('time_end must be > time_start');
  if (fp.x < 0 || fp.x > 100) errors.push('x must be 0-100');
  if (fp.y < 0 || fp.y > 100) errors.push('y must be 0-100');
  if (fp.width <= 0 || fp.width > 100) errors.push('width must be 0-100');
  if (fp.height <= 0 || fp.height > 100) errors.push('height must be 0-100');
  if (fp.x + fp.width > 100) errors.push('x + width must be <= 100');
  if (fp.y + fp.height > 100) errors.push('y + height must be <= 100');
  if (!fp.description || fp.description.trim().length === 0) errors.push('description required');
  return errors;
}

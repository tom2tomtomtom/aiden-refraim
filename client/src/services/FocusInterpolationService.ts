import type { FocusPoint } from '../types/focusPoint';

export interface InterpolatedPosition {
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
  source: FocusPoint['source'];
  blendFactor: number; // 0 = at start point, 1 = at end point
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Given sorted focus points and a time, returns an interpolated position
 * that smoothly blends between consecutive focus points.
 */
export function interpolatePosition(
  focusPoints: FocusPoint[],
  currentTime: number
): InterpolatedPosition | null {
  if (focusPoints.length === 0) return null;

  const sorted = [...focusPoints].sort((a, b) => a.time_start - b.time_start);

  // Before first focus point
  if (currentTime < sorted[0].time_start) return null;

  // After last focus point
  const last = sorted[sorted.length - 1];
  if (currentTime > last.time_end) return null;

  // Find which segment we're in
  for (let i = 0; i < sorted.length; i++) {
    const fp = sorted[i];

    if (currentTime >= fp.time_start && currentTime <= fp.time_end) {
      const next = sorted[i + 1];

      // If no next point or there's a gap, use current point as-is
      if (!next || fp.time_end < next.time_start - 0.1) {
        return {
          x: fp.x,
          y: fp.y,
          width: fp.width,
          height: fp.height,
          description: fp.description,
          source: fp.source,
          blendFactor: 0,
        };
      }

      // Blend toward next point in the overlap/transition zone
      const segmentDuration = fp.time_end - fp.time_start;
      if (segmentDuration <= 0) {
        return {
          x: fp.x, y: fp.y, width: fp.width, height: fp.height,
          description: fp.description, source: fp.source, blendFactor: 0,
        };
      }

      const t = (currentTime - fp.time_start) / segmentDuration;
      const easedT = easeInOut(t);

      return {
        x: lerp(fp.x, next.x, easedT),
        y: lerp(fp.y, next.y, easedT),
        width: lerp(fp.width, next.width, easedT),
        height: lerp(fp.height, next.height, easedT),
        description: fp.description,
        source: fp.source,
        blendFactor: easedT,
      };
    }

    // In a gap between two focus points
    const next = sorted[i + 1];
    if (next && currentTime > fp.time_end && currentTime < next.time_start) {
      const gapDuration = next.time_start - fp.time_end;
      const t = (currentTime - fp.time_end) / gapDuration;
      const easedT = easeInOut(t);

      return {
        x: lerp(fp.x, next.x, easedT),
        y: lerp(fp.y, next.y, easedT),
        width: lerp(fp.width, next.width, easedT),
        height: lerp(fp.height, next.height, easedT),
        description: fp.description,
        source: fp.source,
        blendFactor: easedT,
      };
    }
  }

  return null;
}

/**
 * Groups focus points by subject (using description as key)
 * and finds the best interpolated position considering all active subjects.
 * Prioritizes by: number of focus points (more = more important subject),
 * then by screen coverage (larger bounding box).
 */
export function getSmartFocusPosition(
  focusPoints: FocusPoint[],
  currentTime: number
): InterpolatedPosition | null {
  if (focusPoints.length === 0) return null;

  const validPoints = focusPoints.filter(fp => fp && fp.description);
  if (validPoints.length === 0) return null;

  // Group by subject description
  const subjectGroups = new Map<string, FocusPoint[]>();
  for (const fp of validPoints) {
    const key = fp.description;
    if (!subjectGroups.has(key)) subjectGroups.set(key, []);
    subjectGroups.get(key)!.push(fp);
  }

  // Score each subject group and find the best active one
  let bestPosition: InterpolatedPosition | null = null;
  let bestScore = -1;

  for (const [, group] of subjectGroups) {
    const position = interpolatePosition(group, currentTime);
    if (!position) continue;

    // Score: more focus points = more important subject
    const frequencyScore = group.length;
    // Score: larger bounding box = more prominent
    const sizeScore = position.width * position.height / 10000;
    // Score: person class gets a boost
    const classBoost = group[0]?.description.toLowerCase().includes('person') ? 2 : 1;

    const totalScore = frequencyScore * classBoost + sizeScore;

    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestPosition = position;
    }
  }

  return bestPosition;
}

/**
 * Segments a subject's tracked positions into consecutive focus points.
 * Each focus point covers a ~segmentDuration window with averaged position.
 */
export function segmentPositionsToFocusPoints(
  positions: Array<{ time: number; bbox: [number, number, number, number]; score: number }>,
  subjectClass: string,
  segmentDuration: number = 2.0
): Array<{
  time_start: number;
  time_end: number;
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
  source: 'ai_detection';
  position_order: number;
}> {
  if (positions.length === 0) return [];

  const sorted = [...positions].sort((a, b) => a.time - b.time);
  const firstTime = sorted[0].time;
  const lastTime = sorted[sorted.length - 1].time;
  const totalDuration = lastTime - firstTime;

  // For very short tracks, create a single focus point
  if (totalDuration < segmentDuration) {
    const avg = averagePositions(sorted);
    return [{
      time_start: firstTime,
      time_end: Math.max(lastTime, firstTime + 0.5),
      ...avg,
      description: subjectClass,
      source: 'ai_detection',
      position_order: 0,
    }];
  }

  const segments: ReturnType<typeof segmentPositionsToFocusPoints> = [];
  let segStart = firstTime;
  let order = 0;

  while (segStart < lastTime) {
    const segEnd = Math.min(segStart + segmentDuration, lastTime);

    // Get positions within this segment (with some overlap for smoothing)
    const overlap = segmentDuration * 0.25;
    const windowPositions = sorted.filter(
      p => p.time >= segStart - overlap && p.time <= segEnd + overlap
    );

    if (windowPositions.length > 0) {
      const avg = averagePositions(windowPositions);
      segments.push({
        time_start: segStart,
        time_end: segEnd,
        ...avg,
        description: subjectClass,
        source: 'ai_detection',
        position_order: order,
      });
      order++;
    }

    segStart = segEnd;
  }

  return segments;
}

function averagePositions(
  positions: Array<{ bbox: [number, number, number, number]; score: number }>
): { x: number; y: number; width: number; height: number } {
  let totalWeight = 0;
  let sumCx = 0, sumCy = 0, sumW = 0, sumH = 0;

  for (const pos of positions) {
    const [bx, by, bw, bh] = pos.bbox;
    const weight = pos.score;
    const cx = bx + bw / 2;
    const cy = by + bh / 2;

    sumCx += cx * weight;
    sumCy += cy * weight;
    sumW += bw * weight;
    sumH += bh * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) totalWeight = 1;

  const avgW = sumW / totalWeight;
  const avgH = sumH / totalWeight;
  const avgCx = sumCx / totalWeight;
  const avgCy = sumCy / totalWeight;

  const width = Math.min(avgW, 100);
  const height = Math.min(avgH, 100);
  const x = Math.min(Math.max(0, avgCx - width / 2), 100 - width);
  const y = Math.min(Math.max(0, avgCy - height / 2), 100 - height);

  return { x, y, width, height };
}

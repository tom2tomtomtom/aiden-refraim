import { supabase } from '../config/supabase';
import { analyzeVideo } from './videoAnalysisService';
import { StorageService } from './storageService';
import path from 'path';

interface ScanOptions {
  interval: number;
  min_score: number;
  similarity_threshold: number;
  min_detections: number;
}

interface Subject {
  id: string;
  class: string;
  first_seen: number;
  last_seen: number;
  positions: Array<{ time: number; bbox: [number, number, number, number]; score: number }>;
}

export async function runScan(
  scanId: string,
  videoId: string,
  videoUrl: string,
  options: ScanOptions
): Promise<void> {
  try {
    // Update progress
    await updateScanProgress(scanId, 10);

    // Download video to temp
    const tempPath = path.join('/tmp', `scan-${scanId}.mp4`);
    await StorageService.downloadVideo(videoUrl, tempPath);
    await updateScanProgress(scanId, 30);

    // Run analysis using existing analyzeVideo
    const analysis = await analyzeVideo(videoUrl);
    await updateScanProgress(scanId, 70);

    // Convert motion data to subjects
    const subjects = convertAnalysisToSubjects(analysis, options);
    await updateScanProgress(scanId, 90);

    // Save results
    await supabase
      .from('scan_jobs')
      .update({
        status: 'completed',
        progress: 100,
        detected_subjects: subjects,
      })
      .eq('id', scanId);

    // Clean up temp file
    await StorageService.deleteFile(tempPath).catch(() => {});
  } catch (error) {
    console.error(`Scan ${scanId} failed:`, error);
    await supabase
      .from('scan_jobs')
      .update({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      .eq('id', scanId);
  }
}

function convertAnalysisToSubjects(analysis: any, options: ScanOptions): Subject[] {
  const subjects: Subject[] = [];
  const { motionData, metadata } = analysis;

  if (!motionData || motionData.length === 0) {
    // Create a single center-focused subject for the full duration
    subjects.push({
      id: `subject_center_${Date.now()}`,
      class: 'focus_region',
      first_seen: 0,
      last_seen: metadata?.duration || 0,
      positions: [{
        time: 0,
        bbox: [
          metadata?.resolution?.width ? (analysis.focusRegion.x / metadata.resolution.width) * 100 : 25,
          metadata?.resolution?.height ? (analysis.focusRegion.y / metadata.resolution.height) * 100 : 25,
          metadata?.resolution?.width ? (analysis.focusRegion.width / metadata.resolution.width) * 100 : 50,
          metadata?.resolution?.height ? (analysis.focusRegion.height / metadata.resolution.height) * 100 : 50,
        ],
        score: 1.0,
      }],
    });
    return subjects;
  }

  // Group motion data into clusters by spatial proximity
  const clusters: Map<string, { times: number[]; positions: Array<{ time: number; bbox: [number, number, number, number]; score: number }> }> = new Map();

  for (const motion of motionData) {
    const gridX = Math.floor(motion.x / (metadata.resolution.width * options.similarity_threshold));
    const gridY = Math.floor(motion.y / (metadata.resolution.height * options.similarity_threshold));
    const key = `${gridX}_${gridY}`;

    if (!clusters.has(key)) {
      clusters.set(key, { times: [], positions: [] });
    }

    const cluster = clusters.get(key)!;
    cluster.times.push(motion.timestamp);

    // Convert pixel coordinates to percentage
    const pctX = (motion.x / metadata.resolution.width) * 100;
    const pctY = (motion.y / metadata.resolution.height) * 100;
    const bboxSize = 20; // default 20% bounding box

    cluster.positions.push({
      time: motion.timestamp,
      bbox: [
        Math.max(0, pctX - bboxSize / 2),
        Math.max(0, pctY - bboxSize / 2),
        Math.min(100, bboxSize),
        Math.min(100, bboxSize),
      ],
      score: Math.min(1.0, motion.magnitude / 100),
    });
  }

  // Convert clusters to subjects, filter by min_detections
  let subjectIndex = 0;
  for (const [, cluster] of clusters) {
    if (cluster.positions.length < options.min_detections) continue;
    if (cluster.positions.every(p => p.score < options.min_score)) continue;

    const times = cluster.times.sort((a, b) => a - b);
    subjects.push({
      id: `subject_${subjectIndex}_${Date.now()}`,
      class: 'motion_region',
      first_seen: times[0],
      last_seen: times[times.length - 1],
      positions: cluster.positions.filter(p => p.score >= options.min_score),
    });
    subjectIndex++;
  }

  return subjects;
}

async function updateScanProgress(scanId: string, progress: number): Promise<void> {
  await supabase
    .from('scan_jobs')
    .update({ progress })
    .eq('id', scanId);
}

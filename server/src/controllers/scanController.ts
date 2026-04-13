import { Request, Response } from 'express';
import { supabase } from '../config/supabase';
import { runScan } from '../services/scanService';

export async function startScan(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const { videoId } = req.params;

    // Validate video exists and belongs to user
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('id, original_url')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (videoError || !video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Check no active scan exists for this video
    const { data: activeScan } = await supabase
      .from('scan_jobs')
      .select('id')
      .eq('video_id', videoId)
      .eq('status', 'scanning')
      .single();

    if (activeScan) {
      res.status(409).json({ error: 'A scan is already in progress for this video', scan_id: activeScan.id });
      return;
    }

    // Validate optional params
    const interval = clamp(Number(req.body.interval) || 1, 0.1, 60);
    const min_score = clamp(Number(req.body.min_score) || 0.5, 0, 1);
    const similarity_threshold = clamp(Number(req.body.similarity_threshold) || 0.3, 0, 1);
    const min_detections = clamp(Math.round(Number(req.body.min_detections) || 3), 1, 100);

    const scanOptions = { interval, min_score, similarity_threshold, min_detections };

    // Create scan_jobs record
    const { data: scanJob, error: scanError } = await supabase
      .from('scan_jobs')
      .insert({
        video_id: videoId,
        user_id: userId,
        status: 'scanning',
        progress: 0,
        scan_options: scanOptions,
      })
      .select('id')
      .single();

    if (scanError || !scanJob) {
      console.error('Failed to create scan job:', scanError);
      res.status(500).json({ error: 'Failed to create scan job' });
      return;
    }

    // Kick off scan asynchronously
    runScan(scanJob.id, videoId, video.original_url, scanOptions).catch((err) => {
      console.error(`Background scan ${scanJob.id} error:`, err);
    });

    res.status(202).json({ scan_id: scanJob.id, status: 'scanning' });
  } catch (error) {
    console.error('startScan error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getScanStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = (req as any).user.id;
    const { videoId, scanId } = req.params;

    // Validate video belongs to user
    const { data: video, error: videoError } = await supabase
      .from('videos')
      .select('id')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (videoError || !video) {
      res.status(404).json({ error: 'Video not found' });
      return;
    }

    // Get scan record
    const { data: scan, error: scanError } = await supabase
      .from('scan_jobs')
      .select('id, status, progress, detected_subjects, error')
      .eq('id', scanId)
      .eq('video_id', videoId)
      .single();

    if (scanError || !scan) {
      res.status(404).json({ error: 'Scan not found' });
      return;
    }

    const response: Record<string, any> = {
      status: scan.status,
      progress: scan.progress,
    };

    if (scan.status === 'completed' && scan.detected_subjects) {
      response.subjects = scan.detected_subjects;
    }

    if (scan.status === 'failed' && scan.error) {
      response.error_message = scan.error;
    }

    res.json(response);
  } catch (error) {
    console.error('getScanStatus error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

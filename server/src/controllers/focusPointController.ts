import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

/** Verify the video belongs to the authenticated user. Returns true if valid, sends error response if not. */
async function verifyVideoOwnership(req: Request, res: Response, videoId: string, userId: string): Promise<boolean> {
  const { data: video, error } = await supabase
    .from('videos')
    .select('id')
    .eq('id', videoId)
    .eq('user_id', userId)
    .single();

  if (error || !video) {
    res.status(404).json({ error: 'Video not found' });
    return false;
  }
  return true;
}

/** GET /:videoId/focus-points */
export async function listFocusPoints(req: Request, res: Response) {
  try {
    const userId = (req as any).user.id;
    const { videoId } = req.params;

    if (!await verifyVideoOwnership(req, res, videoId, userId)) return;

    const { data, error } = await supabase
      .from('focus_points')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .order('position_order', { ascending: true });

    if (error) {
      console.error('Error fetching focus points:', error);
      return res.status(500).json({ error: 'Failed to fetch focus points' });
    }

    return res.json(data || []);
  } catch (error) {
    console.error('Error in listFocusPoints:', error);
    return res.status(500).json({ error: 'Failed to fetch focus points' });
  }
}

/** POST /:videoId/focus-points (batch create) */
export async function createFocusPoints(req: Request, res: Response) {
  try {
    const userId = (req as any).user.id;
    const { videoId } = req.params;
    const { focus_points } = req.body;

    if (!Array.isArray(focus_points) || focus_points.length === 0) {
      return res.status(400).json({ error: 'focus_points array is required and must not be empty' });
    }

    if (focus_points.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 focus points per request' });
    }

    if (!await verifyVideoOwnership(req, res, videoId, userId)) return;

    // Validate each focus point
    for (let i = 0; i < focus_points.length; i++) {
      const fp = focus_points[i];
      const prefix = `focus_points[${i}]`;

      if (typeof fp.time_start !== 'number' || fp.time_start < 0) {
        return res.status(400).json({ error: `${prefix}.time_start must be a number >= 0` });
      }
      if (typeof fp.time_end !== 'number' || fp.time_end <= fp.time_start) {
        return res.status(400).json({ error: `${prefix}.time_end must be a number greater than time_start` });
      }
      if (typeof fp.x !== 'number' || fp.x < 0 || fp.x > 100) {
        return res.status(400).json({ error: `${prefix}.x must be a number between 0 and 100` });
      }
      if (typeof fp.y !== 'number' || fp.y < 0 || fp.y > 100) {
        return res.status(400).json({ error: `${prefix}.y must be a number between 0 and 100` });
      }
      if (typeof fp.width !== 'number' || fp.width < 0 || fp.width > 100) {
        return res.status(400).json({ error: `${prefix}.width must be a number between 0 and 100` });
      }
      if (typeof fp.height !== 'number' || fp.height < 0 || fp.height > 100) {
        return res.status(400).json({ error: `${prefix}.height must be a number between 0 and 100` });
      }
      if (fp.x + fp.width > 100) {
        return res.status(400).json({ error: `${prefix}: x + width must be <= 100` });
      }
      if (fp.y + fp.height > 100) {
        return res.status(400).json({ error: `${prefix}: y + height must be <= 100` });
      }
      if (!fp.source || !['manual', 'ai_detection'].includes(fp.source)) {
        return res.status(400).json({ error: `${prefix}.source must be 'manual' or 'ai_detection'` });
      }
      if (!fp.description || typeof fp.description !== 'string' || fp.description.trim().length === 0) {
        return res.status(400).json({ error: `${prefix}.description is required` });
      }
      if (fp.description.length > 255) {
        return res.status(400).json({ error: `${prefix}.description must be 255 characters or fewer` });
      }
    }

    const rows = focus_points.map((fp: any, i: number) => ({
      video_id: videoId,
      user_id: userId,
      time_start: fp.time_start,
      time_end: fp.time_end,
      x: fp.x,
      y: fp.y,
      width: fp.width,
      height: fp.height,
      description: fp.description.trim(),
      source: fp.source,
      position_order: fp.position_order ?? i,
    }));

    const { data, error } = await supabase
      .from('focus_points')
      .insert(rows)
      .select();

    if (error) {
      console.error('Error creating focus points:', error);
      return res.status(500).json({ error: 'Failed to create focus points' });
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error('Error in createFocusPoints:', error);
    return res.status(500).json({ error: 'Failed to create focus points' });
  }
}

/** PUT /:videoId/focus-points/:fpId */
export async function updateFocusPoint(req: Request, res: Response) {
  try {
    const userId = (req as any).user.id;
    const { videoId, fpId } = req.params;

    if (!await verifyVideoOwnership(req, res, videoId, userId)) return;

    const allowedFields = ['time_start', 'time_end', 'x', 'y', 'width', 'height', 'description', 'source', 'position_order'];
    const updates: Record<string, any> = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    // Validate fields that are present
    if (updates.time_start !== undefined && (typeof updates.time_start !== 'number' || updates.time_start < 0)) {
      return res.status(400).json({ error: 'time_start must be a number >= 0' });
    }
    if (updates.time_end !== undefined && typeof updates.time_end !== 'number') {
      return res.status(400).json({ error: 'time_end must be a number' });
    }
    if (updates.x !== undefined && (typeof updates.x !== 'number' || updates.x < 0 || updates.x > 100)) {
      return res.status(400).json({ error: 'x must be a number between 0 and 100' });
    }
    if (updates.y !== undefined && (typeof updates.y !== 'number' || updates.y < 0 || updates.y > 100)) {
      return res.status(400).json({ error: 'y must be a number between 0 and 100' });
    }
    if (updates.width !== undefined && (typeof updates.width !== 'number' || updates.width < 0 || updates.width > 100)) {
      return res.status(400).json({ error: 'width must be a number between 0 and 100' });
    }
    if (updates.height !== undefined && (typeof updates.height !== 'number' || updates.height < 0 || updates.height > 100)) {
      return res.status(400).json({ error: 'height must be a number between 0 and 100' });
    }
    if (updates.source !== undefined && !['manual', 'ai_detection'].includes(updates.source)) {
      return res.status(400).json({ error: "source must be 'manual' or 'ai_detection'" });
    }
    if (updates.description !== undefined) {
      if (typeof updates.description !== 'string' || updates.description.trim().length === 0) {
        return res.status(400).json({ error: 'description is required' });
      }
      if (updates.description.length > 255) {
        return res.status(400).json({ error: 'description must be 255 characters or fewer' });
      }
      updates.description = updates.description.trim();
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('focus_points')
      .update(updates)
      .eq('id', fpId)
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error updating focus point:', error);
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Focus point not found' });
      }
      return res.status(500).json({ error: 'Failed to update focus point' });
    }

    return res.json(data);
  } catch (error) {
    console.error('Error in updateFocusPoint:', error);
    return res.status(500).json({ error: 'Failed to update focus point' });
  }
}

/** DELETE /:videoId/focus-points/:fpId */
export async function deleteFocusPoint(req: Request, res: Response) {
  try {
    const userId = (req as any).user.id;
    const { videoId, fpId } = req.params;

    if (!await verifyVideoOwnership(req, res, videoId, userId)) return;

    const { data, error } = await supabase
      .from('focus_points')
      .delete()
      .eq('id', fpId)
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Error deleting focus point:', error);
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Focus point not found' });
      }
      return res.status(500).json({ error: 'Failed to delete focus point' });
    }

    return res.status(200).json({ message: 'Focus point deleted', id: data.id });
  } catch (error) {
    console.error('Error in deleteFocusPoint:', error);
    return res.status(500).json({ error: 'Failed to delete focus point' });
  }
}

/** DELETE /:videoId/focus-points */
export async function deleteAllFocusPoints(req: Request, res: Response) {
  try {
    const userId = (req as any).user.id;
    const { videoId } = req.params;

    if (!await verifyVideoOwnership(req, res, videoId, userId)) return;

    const { data, error } = await supabase
      .from('focus_points')
      .delete()
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .select();

    if (error) {
      console.error('Error deleting all focus points:', error);
      return res.status(500).json({ error: 'Failed to delete focus points' });
    }

    return res.status(200).json({ message: 'All focus points deleted', count: data?.length ?? 0 });
  } catch (error) {
    console.error('Error in deleteAllFocusPoints:', error);
    return res.status(500).json({ error: 'Failed to delete focus points' });
  }
}

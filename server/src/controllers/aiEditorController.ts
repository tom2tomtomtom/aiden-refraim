import { Request, Response } from 'express';
import {
  generateFocusStrategy,
  SubjectInput,
  StoryAnnotationInput,
  KeyFrameInput,
  reviewCrops,
  CropReviewInput,
} from '../services/aiEditorService';
import { supabase } from '../config/supabase';

// Hard input caps. These routes fan out to LLM calls that bill per
// request and per token, so we refuse anything that would let a single
// request balloon upstream cost. The array/string budgets below are
// deliberately generous for normal editing but cut off runaway payloads.
const MAX_SUBJECTS = 50;
const MAX_STORY_ANNOTATIONS = 200;
const MAX_KEY_FRAMES = 24;
const MAX_CROPS = 24;
const MAX_IMAGE_BASE64_CHARS = 2_000_000; // ~1.5MB decoded
const MAX_STRING = 1000;
const MAX_STORY_BRIEF = 4000;
const MAX_VIDEO_DURATION_SECONDS = 60 * 60 * 4; // 4 hours
const VALID_PLATFORMS = new Set([
  'instagram-story',
  'instagram-feed-square',
  'instagram-feed-portrait',
  'facebook-story',
  'facebook-feed',
  'tiktok',
  'youtube-main',
  'youtube-shorts',
]);

function str(v: unknown, max = MAX_STRING): string | undefined {
  if (typeof v !== 'string') return undefined;
  if (v.length > max) return undefined;
  return v;
}

function num(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  if (v < min || v > max) return undefined;
  return v;
}

async function assertVideoOwnership(
  userId: string,
  videoId: string,
): Promise<'ok' | 'bad-id' | 'not-found'> {
  if (!videoId || typeof videoId !== 'string' || videoId.length > 100) {
    return 'bad-id';
  }
  // Rely on the supabase layer to reject malformed ids; we just want to
  // confirm the video exists AND belongs to this user before burning any
  // LLM budget on it.
  const { data, error } = await supabase
    .from('videos')
    .select('id')
    .eq('id', videoId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return 'not-found';
  return 'ok';
}

export const getAIFocusStrategy = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const videoId = req.params.videoId;
    const ownership = await assertVideoOwnership(user.id, videoId);
    if (ownership !== 'ok') {
      return res.status(404).json({ error: 'Video not found' });
    }

    const body = req.body ?? {};
    const { subjects, videoDuration, targetPlatform, storyBrief, storyAnnotations, keyFrames } =
      body;

    if (!Array.isArray(subjects) || subjects.length === 0) {
      return res.status(400).json({ error: 'subjects array is required' });
    }
    if (subjects.length > MAX_SUBJECTS) {
      return res.status(400).json({ error: `subjects may not exceed ${MAX_SUBJECTS} entries` });
    }

    const duration = num(videoDuration, 0.01, MAX_VIDEO_DURATION_SECONDS);
    if (duration === undefined) {
      return res.status(400).json({ error: 'videoDuration must be a positive number' });
    }

    const platform = str(targetPlatform, 64);
    if (!platform || !VALID_PLATFORMS.has(platform)) {
      return res.status(400).json({ error: 'targetPlatform is invalid' });
    }

    if (storyAnnotations !== undefined && !Array.isArray(storyAnnotations)) {
      return res.status(400).json({ error: 'storyAnnotations must be an array' });
    }
    if (Array.isArray(storyAnnotations) && storyAnnotations.length > MAX_STORY_ANNOTATIONS) {
      return res
        .status(400)
        .json({ error: `storyAnnotations may not exceed ${MAX_STORY_ANNOTATIONS} entries` });
    }

    if (keyFrames !== undefined && !Array.isArray(keyFrames)) {
      return res.status(400).json({ error: 'keyFrames must be an array' });
    }
    if (Array.isArray(keyFrames) && keyFrames.length > MAX_KEY_FRAMES) {
      return res.status(400).json({ error: `keyFrames may not exceed ${MAX_KEY_FRAMES} entries` });
    }

    const brief = storyBrief == null ? undefined : str(storyBrief, MAX_STORY_BRIEF);
    if (storyBrief != null && brief === undefined) {
      return res.status(400).json({ error: 'storyBrief is too long' });
    }

    const subjectInputs: SubjectInput[] = subjects.map((s: any) => ({
      id: str(s?.id, 200) ?? '',
      class: str(s?.class, 200) ?? 'unknown',
      first_seen: num(s?.first_seen, 0, MAX_VIDEO_DURATION_SECONDS) ?? 0,
      last_seen: num(s?.last_seen, 0, MAX_VIDEO_DURATION_SECONDS) ?? duration,
      position_count:
        num(s?.position_count, 0, 1_000_000) ??
        (Array.isArray(s?.positions) ? Math.min(s.positions.length, 1_000_000) : 1),
      avg_screen_coverage: num(s?.avg_screen_coverage, 0, 100) ?? 10,
      avg_confidence: num(s?.avg_confidence, 0, 1) ?? 0.5,
    }));

    const annotationInputs: StoryAnnotationInput[] | undefined = Array.isArray(storyAnnotations)
      ? storyAnnotations.map((a: any) => ({
          id: str(a?.id, 200) ?? '',
          time: num(a?.time, 0, MAX_VIDEO_DURATION_SECONDS) ?? 0,
          bbox: Array.isArray(a?.bbox) && a.bbox.length === 4 ? a.bbox : [0, 0, 100, 100],
          label: str(a?.label, 400) ?? '',
          isKeyMoment: a?.isKeyMoment === true,
        }))
      : undefined;

    const keyFrameInputs: KeyFrameInput[] | undefined = Array.isArray(keyFrames)
      ? keyFrames.map((kf: any) => {
          const img = typeof kf?.imageBase64 === 'string' ? kf.imageBase64 : '';
          if (img.length > MAX_IMAGE_BASE64_CHARS) {
            throw new Error('keyFrame image too large');
          }
          return {
            time: num(kf?.time, 0, MAX_VIDEO_DURATION_SECONDS) ?? 0,
            imageBase64: img,
          };
        })
      : undefined;

    const strategy = await generateFocusStrategy(
      subjectInputs,
      duration,
      platform,
      brief || undefined,
      annotationInputs,
      keyFrameInputs,
    );

    return res.json(strategy);
  } catch (error) {
    console.error('Error in getAIFocusStrategy:', error);
    // Map the one validation throw above to a 400; everything else is 500.
    if (error instanceof Error && error.message === 'keyFrame image too large') {
      return res.status(413).json({ error: 'keyFrame image exceeds size limit' });
    }
    return res.status(500).json({
      error: 'Failed to generate AI focus strategy',
    });
  }
};

export const reviewCropQuality = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const videoId = req.params.videoId;
    const ownership = await assertVideoOwnership(user.id, videoId);
    if (ownership !== 'ok') {
      return res.status(404).json({ error: 'Video not found' });
    }

    const { crops, targetPlatform } = req.body ?? {};

    if (!Array.isArray(crops) || crops.length === 0) {
      return res.status(400).json({ error: 'crops array is required' });
    }
    if (crops.length > MAX_CROPS) {
      return res.status(400).json({ error: `crops may not exceed ${MAX_CROPS} entries` });
    }

    const platform = str(targetPlatform, 64);
    if (!platform || !VALID_PLATFORMS.has(platform)) {
      return res.status(400).json({ error: 'targetPlatform is invalid' });
    }

    const cropInputs: CropReviewInput[] = crops.map((c: any) => {
      const img = typeof c?.imageBase64 === 'string' ? c.imageBase64 : '';
      if (img.length > MAX_IMAGE_BASE64_CHARS) {
        throw new Error('crop image too large');
      }
      return {
        time: num(c?.time, 0, MAX_VIDEO_DURATION_SECONDS) ?? 0,
        imageBase64: img,
        description: str(c?.description, 1000) ?? '',
        ratio: str(c?.ratio, 20) ?? '9:16',
      };
    });

    const reviews = await reviewCrops(cropInputs, platform);
    return res.json({ reviews });
  } catch (error) {
    console.error('Error in reviewCropQuality:', error);
    if (error instanceof Error && error.message === 'crop image too large') {
      return res.status(413).json({ error: 'crop image exceeds size limit' });
    }
    return res.status(500).json({
      error: 'Failed to review crops',
    });
  }
};

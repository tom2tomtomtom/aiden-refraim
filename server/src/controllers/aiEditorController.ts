import { Request, Response } from 'express';
import { generateFocusStrategy, SubjectInput, StoryAnnotationInput, KeyFrameInput, reviewCrops, CropReviewInput } from '../services/aiEditorService';

export const getAIFocusStrategy = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { subjects, videoDuration, targetPlatform, storyBrief, storyAnnotations, keyFrames } = req.body;

    if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
      return res.status(400).json({ error: 'subjects array is required' });
    }

    if (!videoDuration || typeof videoDuration !== 'number' || videoDuration <= 0) {
      return res.status(400).json({ error: 'videoDuration must be a positive number' });
    }

    if (!targetPlatform || typeof targetPlatform !== 'string') {
      return res.status(400).json({ error: 'targetPlatform is required' });
    }

    const subjectInputs: SubjectInput[] = subjects.map((s: any) => ({
      id: s.id || '',
      class: s.class || 'unknown',
      first_seen: s.first_seen || 0,
      last_seen: s.last_seen || videoDuration,
      position_count: s.position_count || s.positions?.length || 1,
      avg_screen_coverage: s.avg_screen_coverage || 10,
      avg_confidence: s.avg_confidence || 0.5,
    }));

    const annotationInputs: StoryAnnotationInput[] | undefined = storyAnnotations?.map((a: any) => ({
      id: a.id || '',
      time: a.time || 0,
      bbox: a.bbox || [0, 0, 100, 100],
      label: a.label || '',
      isKeyMoment: a.isKeyMoment ?? false,
    }));

    const keyFrameInputs: KeyFrameInput[] | undefined = keyFrames?.map((kf: any) => ({
      time: kf.time || 0,
      imageBase64: kf.imageBase64 || '',
    }));

    const strategy = await generateFocusStrategy(
      subjectInputs,
      videoDuration,
      targetPlatform,
      storyBrief || undefined,
      annotationInputs,
      keyFrameInputs,
    );

    return res.json(strategy);
  } catch (error) {
    console.error('Error in getAIFocusStrategy:', error);
    return res.status(500).json({
      error: 'Failed to generate AI focus strategy',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

export const reviewCropQuality = async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { crops, targetPlatform } = req.body;

    if (!crops || !Array.isArray(crops) || crops.length === 0) {
      return res.status(400).json({ error: 'crops array is required' });
    }

    if (!targetPlatform || typeof targetPlatform !== 'string') {
      return res.status(400).json({ error: 'targetPlatform is required' });
    }

    const cropInputs: CropReviewInput[] = crops.map((c: any) => ({
      time: c.time || 0,
      imageBase64: c.imageBase64 || '',
      description: c.description || '',
      ratio: c.ratio || '9:16',
    }));

    const reviews = await reviewCrops(cropInputs, targetPlatform);
    return res.json({ reviews });
  } catch (error) {
    console.error('Error in reviewCropQuality:', error);
    return res.status(500).json({
      error: 'Failed to review crops',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

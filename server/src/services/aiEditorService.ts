import axios from 'axios';

export interface SubjectInput {
  id: string;
  class: string;
  first_seen: number;
  last_seen: number;
  position_count: number;
  avg_screen_coverage: number; // percentage of frame area
  avg_confidence: number;
}

export interface FocusStrategy {
  segments: FocusSegment[];
  reasoning: string;
}

export interface FocusSegment {
  time_start: number;
  time_end: number;
  follow_subject: string; // subject class or "none"
  composition: 'center' | 'rule_of_thirds_left' | 'rule_of_thirds_right' | 'top_center' | 'bottom_center';
  offset_x: number; // -50 to 50 adjustment from detected center
  offset_y: number;
  transition: 'smooth_pan' | 'hard_cut';
  reason: string;
}

const PLATFORM_RULES: Record<string, string> = {
  'instagram-story': `9:16 vertical. Center subject. Keep 15% safe zone top/bottom for text overlays. Faces should be in upper third. Fast pacing.`,
  'instagram-feed-square': `1:1 square. Center composition. Tight framing on subjects. Keep action within center 70% of frame.`,
  'instagram-feed-portrait': `4:5 portrait. Center-weighted. Slightly more headroom than story format.`,
  'tiktok': `9:16 vertical. Center-dominant. Faces must be prominent and in upper 40% of frame. Quick cuts preferred over slow pans. High energy framing.`,
  'youtube-shorts': `9:16 vertical. Similar to TikTok but allow more cinematic headroom. Subject center-weighted.`,
  'youtube-main': `16:9 landscape. Rule of thirds for single subjects. Center for symmetry. Lead space in direction of movement. Standard film composition.`,
  'facebook-story': `9:16 vertical. Center composition. Similar to Instagram Story.`,
  'facebook-feed': `1:1 square. Center composition. Similar to Instagram square.`,
};

export async function generateFocusStrategy(
  subjects: SubjectInput[],
  videoDuration: number,
  targetPlatform: string
): Promise<FocusStrategy> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return generateRuleBasedStrategy(subjects, videoDuration, targetPlatform);
  }

  const platformRule = PLATFORM_RULES[targetPlatform] || PLATFORM_RULES['youtube-main'];

  const prompt = buildPrompt(subjects, videoDuration, targetPlatform, platformRule);

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 30000,
      }
    );

    const text = response.data.content[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return generateRuleBasedStrategy(subjects, videoDuration, targetPlatform);
    }

    const parsed = JSON.parse(jsonMatch[0]) as FocusStrategy;

    // Validate and clamp values
    for (const seg of parsed.segments) {
      seg.time_start = Math.max(0, seg.time_start);
      seg.time_end = Math.min(videoDuration, seg.time_end);
      seg.offset_x = Math.max(-50, Math.min(50, seg.offset_x || 0));
      seg.offset_y = Math.max(-50, Math.min(50, seg.offset_y || 0));
      if (!['smooth_pan', 'hard_cut'].includes(seg.transition)) {
        seg.transition = 'smooth_pan';
      }
      if (!['center', 'rule_of_thirds_left', 'rule_of_thirds_right', 'top_center', 'bottom_center'].includes(seg.composition)) {
        seg.composition = 'center';
      }
    }

    return parsed;
  } catch (error) {
    console.error('AI editor API call failed, falling back to rule-based:', error);
    return generateRuleBasedStrategy(subjects, videoDuration, targetPlatform);
  }
}

function buildPrompt(
  subjects: SubjectInput[],
  videoDuration: number,
  platform: string,
  platformRule: string
): string {
  const subjectList = subjects
    .map(s => `- ${s.class}: visible ${s.first_seen.toFixed(1)}s-${s.last_seen.toFixed(1)}s, detected ${s.position_count} times, avg ${s.avg_screen_coverage.toFixed(1)}% screen coverage, confidence ${(s.avg_confidence * 100).toFixed(0)}%`)
    .join('\n');

  return `You are a professional video editor. Analyze these detected subjects and create a focus/framing strategy for reframing this video.

VIDEO: ${videoDuration.toFixed(1)}s duration
TARGET: ${platform}
PLATFORM RULES: ${platformRule}

DETECTED SUBJECTS:
${subjectList}

Create a focus strategy that:
1. Identifies the hero subject for each time segment (the most important thing to follow)
2. Applies composition rules appropriate for the platform
3. Uses smooth_pan for gradual changes and hard_cut for scene changes or new subjects entering
4. Provides offset_x and offset_y adjustments (-50 to 50) for composition (e.g., +15 offset_x for rule of thirds right)

Respond with ONLY valid JSON in this exact format:
{
  "segments": [
    {
      "time_start": 0,
      "time_end": 5,
      "follow_subject": "person",
      "composition": "center",
      "offset_x": 0,
      "offset_y": -5,
      "transition": "smooth_pan",
      "reason": "Solo subject, center framed with slight headroom"
    }
  ],
  "reasoning": "Brief overall strategy explanation"
}`;
}

/**
 * Rule-based fallback when no API key is available.
 * Makes reasonable default decisions without AI.
 */
function generateRuleBasedStrategy(
  subjects: SubjectInput[],
  videoDuration: number,
  targetPlatform: string
): FocusStrategy {
  if (subjects.length === 0) {
    return {
      segments: [{
        time_start: 0,
        time_end: videoDuration,
        follow_subject: 'none',
        composition: 'center',
        offset_x: 0,
        offset_y: 0,
        transition: 'smooth_pan',
        reason: 'No subjects detected, center framing',
      }],
      reasoning: 'No subjects detected. Using center composition.',
    };
  }

  // Score subjects: person > other, more detections = more important, bigger = more important
  const scored = subjects.map(s => ({
    ...s,
    score: (s.class === 'person' ? 3 : 1) * s.position_count * (s.avg_screen_coverage / 100),
  })).sort((a, b) => b.score - a.score);

  const hero = scored[0];
  const isVertical = ['instagram-story', 'tiktok', 'youtube-shorts', 'facebook-story'].includes(targetPlatform);

  const segments: FocusSegment[] = [];
  const segmentDuration = 3;

  for (let t = 0; t < videoDuration; t += segmentDuration) {
    const segEnd = Math.min(t + segmentDuration, videoDuration);

    // Find which scored subjects are active in this time window
    const activeSubjects = scored.filter(s => s.first_seen <= segEnd && s.last_seen >= t);
    const activeHero = activeSubjects[0] || hero;

    segments.push({
      time_start: t,
      time_end: segEnd,
      follow_subject: activeHero.class,
      composition: activeSubjects.length > 1 ? 'center' : (isVertical ? 'center' : 'rule_of_thirds_left'),
      offset_x: isVertical ? 0 : (activeSubjects.length > 1 ? 0 : 10),
      offset_y: activeHero.class === 'person' ? -5 : 0, // headroom for people
      transition: t === 0 ? 'hard_cut' : 'smooth_pan',
      reason: `Following ${activeHero.class}${activeSubjects.length > 1 ? ` (${activeSubjects.length} subjects)` : ''}`,
    });
  }

  return {
    segments,
    reasoning: `Hero subject: ${hero.class} (${hero.position_count} detections). ${scored.length > 1 ? `${scored.length - 1} secondary subjects.` : 'Solo subject.'} ${isVertical ? 'Vertical' : 'Landscape'} framing for ${targetPlatform}.`,
  };
}

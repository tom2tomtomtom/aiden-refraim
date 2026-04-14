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

  return `You are a professional video editor creating a dynamic reframing strategy. Your goal is to produce an engaging, visually varied result—not a static lock on one subject.

VIDEO: ${videoDuration.toFixed(1)}s duration
TARGET: ${platform}
PLATFORM RULES: ${platformRule}

DETECTED SUBJECTS:
${subjectList}

IMPORTANT CREATIVE DIRECTION:
- Do NOT follow the same subject for every segment. Switch between subjects when multiple are visible in the same time window. For example, if a person and dog are both visible from 2-17s, dedicate some segments to the dog.
- Vary composition across segments (center, rule_of_thirds_left, rule_of_thirds_right, top_center). Avoid repeating the same composition for consecutive segments.
- Use hard_cut when switching between different subjects. Use smooth_pan when staying on the same subject but adjusting framing.
- If the hero subject leaves the frame (their visibility window ends), switch to the next best subject or use "none" with center composition.
- Vary segment durations based on action: shorter (2-4s) for dynamic moments with multiple subjects, longer (5-8s) for solo subjects.
- Use offset_x and offset_y creatively: negative offset_y (-5 to -15) for headroom on people, positive offset_x (+10 to +20) for rule_of_thirds_right, etc.

Create a focus strategy with these rules:
1. Identify the best subject for each time segment—alternate between subjects when possible
2. Apply composition rules appropriate for the platform
3. Use smooth_pan for gradual changes and hard_cut for subject switches or scene changes
4. Provide offset_x and offset_y adjustments (-50 to 50) for composition

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

  const compositions: Array<FocusSegment['composition']> = isVertical
    ? ['center', 'center', 'top_center', 'center']
    : ['rule_of_thirds_left', 'center', 'rule_of_thirds_right', 'center'];

  const segments: FocusSegment[] = [];
  const segmentDuration = 3;
  let lastSubjectClass = '';

  for (let t = 0; t < videoDuration; t += segmentDuration) {
    const segEnd = Math.min(t + segmentDuration, videoDuration);

    const activeSubjects = scored.filter(s => s.first_seen <= segEnd && s.last_seen >= t);

    let target: typeof scored[0];
    if (activeSubjects.length > 1 && lastSubjectClass === activeSubjects[0].class) {
      target = activeSubjects[1];
    } else {
      target = activeSubjects[0] || hero;
    }

    const switchedSubject = target.class !== lastSubjectClass && lastSubjectClass !== '';
    const compIndex = segments.length % compositions.length;

    segments.push({
      time_start: t,
      time_end: segEnd,
      follow_subject: target.class,
      composition: activeSubjects.length > 1 ? compositions[compIndex] : (isVertical ? 'center' : compositions[compIndex]),
      offset_x: isVertical ? 0 : (compositions[compIndex] === 'rule_of_thirds_right' ? 15 : compositions[compIndex] === 'rule_of_thirds_left' ? -15 : 0),
      offset_y: target.class === 'person' ? -5 : 0,
      transition: t === 0 || switchedSubject ? 'hard_cut' : 'smooth_pan',
      reason: `Following ${target.class}${activeSubjects.length > 1 ? ` (${activeSubjects.length} active)` : ''}${switchedSubject ? ' — subject switch' : ''}`,
    });

    lastSubjectClass = target.class;
  }

  const uniqueSubjectsUsed = new Set(segments.map(s => s.follow_subject)).size;

  return {
    segments,
    reasoning: `Hero subject: ${hero.class} (${hero.position_count} detections). ${scored.length > 1 ? `${scored.length - 1} secondary subjects.` : 'Solo subject.'} ${uniqueSubjectsUsed > 1 ? `Alternating between ${uniqueSubjectsUsed} subjects.` : ''} ${isVertical ? 'Vertical' : 'Landscape'} framing for ${targetPlatform}.`,
  };
}

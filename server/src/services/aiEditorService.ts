import axios from 'axios';

export interface SubjectInput {
  id: string;
  class: string;
  first_seen: number;
  last_seen: number;
  position_count: number;
  avg_screen_coverage: number;
  avg_confidence: number;
}

export interface StoryAnnotationInput {
  id: string;
  time: number;
  bbox: [number, number, number, number];
  label: string;
  isKeyMoment: boolean;
}

export interface KeyFrameInput {
  time: number;
  imageBase64: string;
}

export interface FocusStrategy {
  segments: FocusSegment[];
  reasoning: string;
}

export interface FocusSegment {
  time_start: number;
  time_end: number;
  follow_subject: string;
  composition: 'center' | 'rule_of_thirds_left' | 'rule_of_thirds_right' | 'top_center' | 'bottom_center';
  offset_x: number;
  offset_y: number;
  transition: 'smooth_pan' | 'hard_cut';
  reason: string;
}

interface SceneDescription {
  time: number;
  description: string;
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

// Vision analysis cache: videoId -> scene descriptions
const visionCache = new Map<string, SceneDescription[]>();

export async function generateFocusStrategy(
  subjects: SubjectInput[],
  videoDuration: number,
  targetPlatform: string,
  storyBrief?: string,
  annotations?: StoryAnnotationInput[],
  keyFrames?: KeyFrameInput[],
): Promise<FocusStrategy> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return generateRuleBasedStrategy(subjects, videoDuration, targetPlatform);
  }

  const platformRule = PLATFORM_RULES[targetPlatform] || PLATFORM_RULES['youtube-main'];

  // Run vision analysis if key frames are provided (with caching)
  let sceneDescriptions: SceneDescription[] = [];
  if (keyFrames && keyFrames.length > 0) {
    const cacheKey = keyFrames.map(kf => kf.time.toFixed(1)).join(',');
    const cached = visionCache.get(cacheKey);
    if (cached) {
      sceneDescriptions = cached;
      console.log('Using cached vision analysis');
    } else {
      try {
        sceneDescriptions = await analyzeScenes(keyFrames, apiKey);
        visionCache.set(cacheKey, sceneDescriptions);
        // Evict old entries if cache grows too large
        if (visionCache.size > 20) {
          const firstKey = visionCache.keys().next().value;
          if (firstKey) visionCache.delete(firstKey);
        }
      } catch (err) {
        console.error('Vision analysis failed, continuing without scene descriptions:', err);
      }
    }
  }

  const prompt = buildPrompt(
    subjects,
    videoDuration,
    targetPlatform,
    platformRule,
    storyBrief,
    annotations,
    sceneDescriptions,
  );

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 45000,
      }
    );

    const text = (response.data.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('') || '';

    // TODO: harden if model upgrades surface multi-object output
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return generateRuleBasedStrategy(subjects, videoDuration, targetPlatform);
    }

    const parsed = JSON.parse(jsonMatch[0]) as FocusStrategy;

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

/**
 * Send key frames to Claude Vision for rich scene descriptions.
 */
async function analyzeScenes(
  keyFrames: KeyFrameInput[],
  apiKey: string
): Promise<SceneDescription[]> {
  const imageContent = keyFrames.map((kf, i) => {
    const base64Data = kf.imageBase64.replace(/^data:image\/[^;]+;base64,/, '');
    return [
      {
        type: 'text' as const,
        text: `Frame ${i + 1} at ${kf.time.toFixed(1)}s:`,
      },
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: 'image/jpeg' as const,
          data: base64Data,
        },
      },
    ];
  }).flat();

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          ...imageContent,
          {
            type: 'text',
            text: `For each frame above, write ONE concise sentence describing what is happening visually: subjects, actions, mood, lighting, weather, props, spatial relationships. Focus on what a video editor needs to know for framing decisions.

Respond with ONLY valid JSON:
{ "scenes": [{ "frame": 1, "time": 0.0, "description": "..." }, ...] }`,
          },
        ],
      }],
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

  const text = (response.data.content ?? [])
    .filter((b: any) => b?.type === 'text')
    .map((b: any) => b.text)
    .join('') || '';
  // TODO: harden if model upgrades surface multi-object output
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.scenes || !Array.isArray(parsed.scenes)) return [];

  return parsed.scenes.map((s: any, i: number) => ({
    time: s.time ?? keyFrames[i]?.time ?? 0,
    description: s.description || '',
  }));
}

function buildPrompt(
  subjects: SubjectInput[],
  videoDuration: number,
  platform: string,
  platformRule: string,
  storyBrief?: string,
  annotations?: StoryAnnotationInput[],
  sceneDescriptions?: SceneDescription[],
): string {
  const sections: string[] = [];

  sections.push(`You are a professional video editor creating a reframing strategy. Your goal is to serve the STORY, not just follow the biggest or most-detected object.

VIDEO: ${videoDuration.toFixed(1)}s duration
TARGET: ${platform}
PLATFORM RULES: ${platformRule}`);

  // HIGHEST PRIORITY: Story brief from the user
  if (storyBrief) {
    sections.push(`STORY BRIEF (from the user, HIGHEST PRIORITY):
"${storyBrief}"

The user has described the narrative intent. Your editorial choices MUST serve this story. A subject's narrative importance overrides its detection frequency or screen coverage. If the brief mentions something specific (e.g. "rain on the window"), that IS the shot, even if object detection labelled it differently.`);
  }

  // HIGH PRIORITY: Manual annotations
  if (annotations && annotations.length > 0) {
    const annotationList = annotations
      .sort((a, b) => a.time - b.time)
      .map(a => {
        const keyTag = a.isKeyMoment ? ' (KEY MOMENT)' : '';
        return `[${a.time.toFixed(1)}s] "${a.label}" (region: ${a.bbox[0].toFixed(0)}%,${a.bbox[1].toFixed(0)}%,${a.bbox[2].toFixed(0)}%x${a.bbox[3].toFixed(0)}%)${keyTag}`;
      })
      .join('\n');

    sections.push(`USER ANNOTATIONS (manually marked, HIGH PRIORITY):
${annotationList}

These annotations identify elements that automatic detection missed or mislabelled. The user drew a box and named it semantically. KEY MOMENT annotations are narrative pivot points that MUST be prominently featured. Use the user's label as the follow_subject name, and the bbox position for framing.`);
  }

  // MEDIUM PRIORITY: Vision scene descriptions
  if (sceneDescriptions && sceneDescriptions.length > 0) {
    const sceneList = sceneDescriptions
      .map(s => `[${s.time.toFixed(1)}s] ${s.description}`)
      .join('\n');

    sections.push(`SCENE DESCRIPTIONS (from vision analysis):
${sceneList}

These describe what is actually happening in each shot. Use them to understand the editorial flow: scene changes, mood shifts, and narrative beats that object detection alone cannot capture.`);
  }

  // LOWEST PRIORITY: Auto-detected subjects with shot scale analysis
  const subjectList = subjects
    .map(s => {
      const scale = s.avg_screen_coverage > 50 ? 'EXTREME CLOSE-UP'
        : s.avg_screen_coverage > 30 ? 'CLOSE-UP'
        : s.avg_screen_coverage > 15 ? 'MEDIUM SHOT'
        : 'WIDE SHOT';
      return `- ${s.class}: visible ${s.first_seen.toFixed(1)}s-${s.last_seen.toFixed(1)}s, detected ${s.position_count} times, avg ${s.avg_screen_coverage.toFixed(1)}% screen coverage (${scale}), confidence ${(s.avg_confidence * 100).toFixed(0)}%`;
    })
    .join('\n');

  sections.push(`DETECTED SUBJECTS (auto-detection, use as fallback):
${subjectList}

These are COCO-SSD object detection labels. They may be wrong or misleading (e.g. "potted_plant" might be a window with rain). If user annotations or the story brief contradict these labels, trust the user.

SHOT SCALE AWARENESS (CRITICAL FOR VERTICAL CROPS):
The screen coverage % tells you how tight the original framing is. When cropping 16:9 landscape to 9:16 vertical, you only keep ~32% of the horizontal frame width. Your offset_x and offset_y values MUST account for this.

- EXTREME CLOSE-UP (>50% coverage): Subject fills the frame. The vertical crop will only show a narrow slice. Use offset_x to center precisely on the FACE (not body center). Use offset_y of -15 to -25 to weight toward the head. The crop will be tight; that's OK, but the face must not be cut off.
- CLOSE-UP (30-50%): Tight but workable. Ensure offset_x centers on the subject's face/key feature. offset_y of -10 to -20 for people.
- MEDIUM SHOT (15-30%): Good reframing room. Standard offsets work.
- WIDE SHOT (<15%): Plenty of room. Use composition variety.

KEY RULE FOR PEOPLE IN VERTICAL: The crop will be a narrow vertical slice. For people, the crop must be centered on their FACE horizontally, and weighted toward the head vertically. A person's body center is NOT where you want the crop. The FACE is what viewers look at. Use offset_y of -15 to -25 for close-ups of people.`);

  // Priority rules
  sections.push(`PRIORITY RULES:
1. User annotations override COCO-SSD labels at the same timestamp
2. KEY MOMENT annotations must be featured prominently
3. Story brief determines which shots are editorially important
4. A subject's narrative importance overrides its detection frequency
5. When the brief or annotations mention an element, use THAT as follow_subject (e.g. "rain_on_window" not "potted_plant")
6. Vary composition and transition types across segments
7. Use hard_cut for scene changes or subject switches, smooth_pan for reframing within a shot

CREATIVE DIRECTION:
- Do NOT follow the same subject for every segment
- Vary composition: center, rule_of_thirds_left, rule_of_thirds_right, top_center
- Use offset_x and offset_y for precise framing (-50 to 50). These are CRITICAL for close-ups in vertical crops.
- For person subjects: ALWAYS use negative offset_y (-15 to -25) to weight the crop toward the FACE
- For close-up person shots in vertical: use offset_x to precisely center on the face, not body midpoint
- Segment durations: 2-4s for dynamic moments, 5-8s for establishing shots
- If an annotated key moment exists at a timestamp, dedicate a segment to it

Respond with ONLY valid JSON:
{
  "segments": [
    {
      "time_start": 0,
      "time_end": 5,
      "follow_subject": "person",
      "composition": "center",
      "offset_x": 0,
      "offset_y": -20,
      "transition": "smooth_pan",
      "reason": "..."
    }
  ],
  "reasoning": "Brief overall strategy explanation"
}`);

  return sections.join('\n\n');
}

/**
 * Rule-based fallback when no API key is available.
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

    const isCloseUp = target.avg_screen_coverage > 30;
    const personFaceOffset = target.class === 'person' ? (isCloseUp ? -25 : -15) : 0;

    segments.push({
      time_start: t,
      time_end: segEnd,
      follow_subject: target.class,
      composition: activeSubjects.length > 1 ? compositions[compIndex] : (isVertical ? 'center' : compositions[compIndex]),
      offset_x: isVertical ? 0 : (compositions[compIndex] === 'rule_of_thirds_right' ? 15 : compositions[compIndex] === 'rule_of_thirds_left' ? -15 : 0),
      offset_y: personFaceOffset,
      transition: t === 0 || switchedSubject ? 'hard_cut' : 'smooth_pan',
      reason: `Following ${target.class}${isCloseUp ? ' (close-up, face-weighted crop)' : ''}${activeSubjects.length > 1 ? ` (${activeSubjects.length} active)` : ''}${switchedSubject ? ' (subject switch)' : ''}`,
    });

    lastSubjectClass = target.class;
  }

  const uniqueSubjectsUsed = new Set(segments.map(s => s.follow_subject)).size;

  return {
    segments,
    reasoning: `Hero subject: ${hero.class} (${hero.position_count} detections). ${scored.length > 1 ? `${scored.length - 1} secondary subjects.` : 'Solo subject.'} ${uniqueSubjectsUsed > 1 ? `Alternating between ${uniqueSubjectsUsed} subjects.` : ''} ${isVertical ? 'Vertical' : 'Landscape'} framing for ${targetPlatform}.`,
  };
}

// --- Crop QA Review ---

export interface CropReviewInput {
  time: number;
  imageBase64: string;
  description: string;
  ratio: string;
}

export interface CropReviewResult {
  time: number;
  quality: 'good' | 'needs_adjustment' | 'bad';
  issues: string[];
  suggestion: string;
}

export async function reviewCrops(
  crops: CropReviewInput[],
  targetPlatform: string,
): Promise<CropReviewResult[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return crops.map(c => ({ time: c.time, quality: 'good' as const, issues: [], suggestion: '' }));
  }

  const imageContent = crops.map((crop, i) => {
    const base64Data = crop.imageBase64.replace(/^data:image\/[^;]+;base64,/, '');
    return [
      {
        type: 'text' as const,
        text: `Crop ${i + 1} at ${crop.time.toFixed(1)}s, ${crop.ratio} for ${targetPlatform}. Focus point: "${crop.description}"`,
      },
      {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: 'image/jpeg' as const,
          data: base64Data,
        },
      },
    ];
  }).flat();

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            ...imageContent,
            {
              type: 'text',
              text: `You are a video editor reviewing cropped frames. Each image above is how a frame will look after being cropped to ${crops[0]?.ratio || '9:16'} for ${targetPlatform}.

For each crop, evaluate the COMPOSITION QUALITY of what you see in the actual image:

CHECK FOR:
1. FACES: Is any person's face cut off at the edge? Is the face partially out of frame?
2. SUBJECT POSITION: Is the main subject awkwardly jammed against an edge?
3. HEADROOM: For people, is there reasonable space above their head, or is it cropped too tight?
4. KEY ELEMENTS: Are important elements (text, products, key props) cut off or missing?
5. BALANCE: Does the crop look intentionally composed, or accidental/awkward?

Rate each crop:
- "good": Well composed, subject properly framed
- "needs_adjustment": Minor issues; subject slightly off-center or edge-clipped
- "bad": Major issue; face cut off, subject barely visible, or key element missing

Respond with ONLY valid JSON:
{
  "reviews": [
    {
      "crop": 1,
      "time": 0.0,
      "quality": "good",
      "issues": [],
      "suggestion": ""
    },
    {
      "crop": 2,
      "time": 3.0,
      "quality": "needs_adjustment",
      "issues": ["Person's face cut off on left edge"],
      "suggestion": "Shift crop window right to fully include face"
    }
  ]
}`,
            },
          ],
        }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        timeout: 45000,
      }
    );

    const text = (response.data.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('') || '';
    // TODO: harden if model upgrades surface multi-object output
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return crops.map(c => ({ time: c.time, quality: 'good' as const, issues: [], suggestion: '' }));
    }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.reviews || !Array.isArray(parsed.reviews)) {
      return crops.map(c => ({ time: c.time, quality: 'good' as const, issues: [], suggestion: '' }));
    }

    return parsed.reviews.map((r: any, i: number) => ({
      time: r.time ?? crops[i]?.time ?? 0,
      quality: ['good', 'needs_adjustment', 'bad'].includes(r.quality) ? r.quality : 'good',
      issues: Array.isArray(r.issues) ? r.issues : [],
      suggestion: r.suggestion || '',
    }));
  } catch (error) {
    console.error('Crop review API call failed:', error);
    return crops.map(c => ({ time: c.time, quality: 'good' as const, issues: [], suggestion: '' }));
  }
}

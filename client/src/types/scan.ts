export interface ScanOptions {
  interval?: number;              // seconds between frames, default 1.0
  min_score?: number;             // 0-1, default 0.5
  similarity_threshold?: number;  // 0-1, default 0.3
  min_detections?: number;        // default 3
}

export interface ScanProgress {
  status: 'scanning' | 'completed' | 'failed';
  progress: number;     // 0-100
  subjects?: Subject[];
  error_message?: string;
}

export interface Subject {
  id: string;
  class: string;
  first_seen: number;
  last_seen: number;
  positions: SubjectPosition[];
}

export interface SubjectPosition {
  time: number;
  bbox: [number, number, number, number]; // [x, y, width, height] in percentage 0-100
  score: number;
}

export type ScanStatus = 'idle' | 'scanning' | 'review' | 'finalizing';

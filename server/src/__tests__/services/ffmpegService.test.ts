import { EventEmitter } from 'events';

const mockSpawn = jest.fn();

jest.mock('child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}));

// Mock storageService (transitive dep via ffmpegService -> storageService -> supabase)
jest.mock('../../services/storageService', () => ({
  StorageService: {
    downloadVideo: jest.fn(),
    uploadProcessedVideo: jest.fn(),
  },
}));

jest.mock('../../config/supabase', () => ({
  supabase: {},
}));

import { FFmpegService, CropSegment, FocusPoint } from '../../services/ffmpegService';

describe('FFmpegService.buildSegments', () => {
  it('returns single center-crop segment when no focus points', () => {
    const segments = FFmpegService.buildSegments([], 10);

    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      startTime: 0,
      endTime: 10,
      focusX: 0.5,
      focusY: 0.5,
      label: 'center-fill',
    });
  });

  it('fills trailing gap when one focus point starts at 0', () => {
    const focusPoints: FocusPoint[] = [
      { time_start: 0, time_end: 5, x: 25, y: 30, description: 'face' },
    ];

    const segments = FFmpegService.buildSegments(focusPoints, 10);

    expect(segments).toHaveLength(2);
    // Focus segment
    expect(segments[0]).toEqual({
      startTime: 0,
      endTime: 5,
      focusX: 0.25,
      focusY: 0.3,
      label: 'face',
    });
    // Trailing center-fill
    expect(segments[1]).toEqual({
      startTime: 5,
      endTime: 10,
      focusX: 0.5,
      focusY: 0.5,
      label: 'center-fill',
    });
  });

  it('fills both gaps when focus point is in the middle', () => {
    const focusPoints: FocusPoint[] = [
      { time_start: 3, time_end: 7, x: 50, y: 50, description: 'subject' },
    ];

    const segments = FFmpegService.buildSegments(focusPoints, 10);

    expect(segments).toHaveLength(3);
    // Leading gap
    expect(segments[0]).toEqual({
      startTime: 0,
      endTime: 3,
      focusX: 0.5,
      focusY: 0.5,
      label: 'center-fill',
    });
    // Focus segment
    expect(segments[1]).toEqual({
      startTime: 3,
      endTime: 7,
      focusX: 0.5,
      focusY: 0.5,
      label: 'subject',
    });
    // Trailing gap
    expect(segments[2]).toEqual({
      startTime: 7,
      endTime: 10,
      focusX: 0.5,
      focusY: 0.5,
      label: 'center-fill',
    });
  });

  it('keeps earlier focus point when overlapping', () => {
    const focusPoints: FocusPoint[] = [
      { time_start: 0, time_end: 6, x: 20, y: 20, description: 'first' },
      { time_start: 4, time_end: 10, x: 80, y: 80, description: 'second' },
    ];

    const segments = FFmpegService.buildSegments(focusPoints, 10);

    expect(segments).toHaveLength(2);
    // First segment runs full 0-6
    expect(segments[0]).toEqual({
      startTime: 0,
      endTime: 6,
      focusX: 0.2,
      focusY: 0.2,
      label: 'first',
    });
    // Second segment is trimmed to 6-10
    expect(segments[1]).toEqual({
      startTime: 6,
      endTime: 10,
      focusX: 0.8,
      focusY: 0.8,
      label: 'second',
    });
  });

  it('converts x/y from 0-100 to 0-1', () => {
    const focusPoints: FocusPoint[] = [
      { time_start: 0, time_end: 10, x: 75, y: 25, description: 'corner' },
    ];

    const segments = FFmpegService.buildSegments(focusPoints, 10);

    expect(segments).toHaveLength(1);
    expect(segments[0].focusX).toBeCloseTo(0.75);
    expect(segments[0].focusY).toBeCloseTo(0.25);
  });

  it('sorts by time_start regardless of input order', () => {
    const focusPoints: FocusPoint[] = [
      { time_start: 5, time_end: 8, x: 60, y: 60, description: 'later' },
      { time_start: 1, time_end: 4, x: 30, y: 30, description: 'earlier' },
    ];

    const segments = FFmpegService.buildSegments(focusPoints, 10);

    // Should be: gap(0-1), earlier(1-4), gap(4-5), later(5-8), gap(8-10)
    expect(segments).toHaveLength(5);
    expect(segments[0]).toMatchObject({ startTime: 0, endTime: 1, label: 'center-fill' });
    expect(segments[1]).toMatchObject({ startTime: 1, endTime: 4, label: 'earlier' });
    expect(segments[2]).toMatchObject({ startTime: 4, endTime: 5, label: 'center-fill' });
    expect(segments[3]).toMatchObject({ startTime: 5, endTime: 8, label: 'later' });
    expect(segments[4]).toMatchObject({ startTime: 8, endTime: 10, label: 'center-fill' });
  });
});

describe('FFmpegService.buildCropFilter', () => {
  // buildCropFilter is private, so we access it via reflection
  const buildCropFilter = (FFmpegService as any).buildCropFilter.bind(FFmpegService);

  it('returns correct filter for letterbox mode', () => {
    const filter = buildCropFilter(
      0.5, 0.5,     // focusX, focusY
      1920, 1080,   // source
      1080, 1920,   // target (9:16)
      true          // letterbox
    );

    // Should contain crop, scale with force_original_aspect_ratio, and pad
    expect(filter).toContain('crop=');
    expect(filter).toContain('scale=');
    expect(filter).toContain('force_original_aspect_ratio=decrease');
    expect(filter).toContain('pad=');
    expect(filter).toContain('black');
  });

  it('returns correct filter for crop mode', () => {
    const filter = buildCropFilter(
      0.5, 0.5,     // focusX, focusY
      1920, 1080,   // source
      1080, 1920,   // target (9:16)
      false         // crop mode
    );

    // Should contain crop and scale, no pad
    expect(filter).toContain('crop=');
    expect(filter).toContain('scale=1080:1920');
    expect(filter).not.toContain('pad=');
    expect(filter).not.toContain('force_original_aspect_ratio');
  });
});

describe('FFmpegService.processVideo upload contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSpawn.mockImplementation((command: string) => {
      const process = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      process.stdout = new EventEmitter();
      process.stderr = new EventEmitter();
      setImmediate(() => {
        if (command === 'ffprobe') {
          process.stdout.emit('data', Buffer.from(JSON.stringify({
            streams: [{
              width: 1920,
              height: 1080,
              duration: '10',
              r_frame_rate: '30/1',
            }],
          })));
        }
        process.emit('close', 0);
      });
      return process;
    });
  });

  it('passes the requested platform to storage instead of parsing the UUID filename', async () => {
    const { StorageService } = require('../../services/storageService');
    StorageService.downloadVideo.mockResolvedValue(undefined);
    StorageService.uploadProcessedVideo.mockResolvedValue('processed/output.mp4');
    const outputPath = '/tmp/59fc1b71-3a01-41f4-ba2f-b75efbcaddfb-instagram-story.mp4';

    await FFmpegService.processVideo(
      'https://signed.example/input.mp4?token=sig',
      outputPath,
      { width: 1080, height: 1920, aspectRatio: '9:16' },
      { x: 0, y: 0, width: 1920, height: 1080 },
      'instagram-story',
    );

    expect(StorageService.uploadProcessedVideo).toHaveBeenCalledWith(
      outputPath,
      'instagram-story',
    );
  });
});

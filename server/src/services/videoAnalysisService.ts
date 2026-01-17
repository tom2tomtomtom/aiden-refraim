import { spawn } from 'child_process';
import path from 'path';
import { StorageService } from './storageService';

interface SceneData {
  timestamp: number;
  score: number;
}

interface MotionData {
  timestamp: number;
  x: number;
  y: number;
  magnitude: number;
}

interface AnalysisResult {
  focusRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  scenes: SceneData[];
  motionData: MotionData[];
  metadata: {
    duration: number;
    fps: number;
    resolution: {
      width: number;
      height: number;
    };
  };
  keypoints?: Array<{
    x: number;
    y: number;
    confidence: number;
    type: string;
  }>;
  saliencyMap?: Uint8Array;
}

export const analyzeVideo = async (videoUrl: string): Promise<AnalysisResult> => {
  // Download video to temp location
  const tempPath = path.join('/tmp', `analysis-${Date.now()}.mp4`);
  await StorageService.downloadVideo(videoUrl, tempPath);

  try {
    // Run scene detection and motion analysis in parallel
    const [scenes, motionData, metadata] = await Promise.all([
      detectScenes(tempPath),
      analyzeMotion(tempPath),
      getVideoMetadata(tempPath),
    ]);

    // Calculate focus region based on motion data
    const focusRegion = calculateFocusRegion(motionData);

    return {
      focusRegion,
      scenes,
      motionData,
      metadata,
      keypoints: [], // Will be added in phase 3 with OpenPose
      saliencyMap: new Uint8Array(), // Will be added in phase 3
    };
  } finally {
    // Clean up temp file
    await StorageService.deleteFile(tempPath);
  }
};

const detectScenes = async (videoPath: string): Promise<SceneData[]> => {
  return new Promise((resolve, reject) => {
    try {
      const ffmpeg = spawn('ffmpeg', [
        '-i',
        videoPath,
        '-vf',
        'select=gt(scene\,0.3)',
        '-f',
        'null',
        '-',
      ]);

      const scenes: SceneData[] = [];
      let currentTime = 0;

      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();
        const matches = output.match(/scene:(\d+\.\d+)/g);
        if (matches) {
          matches.forEach((match: string) => {
            const score = parseFloat(match.split(':')[1]);
            scenes.push({
              timestamp: currentTime,
              score,
            });
            currentTime += 1/30; // Assuming 30fps
          });
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('FFmpeg process error:', err);
        reject(new Error(`FFmpeg process error: ${err.message}`));
      });

      ffmpeg.on('close', (code) => {
        if (code !== 0) {
          console.error(`FFmpeg process exited with code ${code}`);
          reject(new Error(`FFmpeg process exited with code ${code}`));
          return;
        }
        resolve(scenes);
      });
    } catch (err) {
      console.error('Error in detectScenes:', err);
      reject(err);
    }
  });
};


const analyzeMotion = async (videoPath: string): Promise<MotionData[]> => {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i',
      videoPath,
      '-vf',
      'mestimate=method=epzs:mb_size=16:search_param=32,metadata=print:file=-',
      '-f',
      'null',
      '-',
    ]);

    const motionData: MotionData[] = [];
    let currentTime = 0;

    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString();
      const matches = output.match(/motion_est=(\S+)/g);
      if (matches) {
        matches.forEach((match: string) => {
          const [x, y, mag] = match.split(':')[1].split(',').map(Number);
          motionData.push({
            timestamp: currentTime,
            x,
            y,
            magnitude: mag,
          });
          currentTime += 1/30; // Assuming 30fps
        });
      }
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Motion analysis failed'));
      } else {
        resolve(motionData);
      }
    });
  });
};

const getVideoMetadata = async (videoPath: string): Promise<{
  duration: number;
  fps: number;
  resolution: {
    width: number;
    height: number;
  };
}> => {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,duration,r_frame_rate',
      '-of',
      'json',
      videoPath,
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('Failed to get video metadata'));
      } else {
        try {
          const data = JSON.parse(output);
          const stream = data.streams[0];
          const [num, den] = stream.r_frame_rate.split('/');
          resolve({
            duration: parseFloat(stream.duration),
            fps: Math.round(parseInt(num) / parseInt(den)),
            resolution: {
              width: stream.width,
              height: stream.height
            }
          });
        } catch (error) {
          reject(error);
        }
      }
    });
  });
};

const calculateFocusRegion = (motionData: MotionData[]): {
  x: number;
  y: number;
  width: number;
  height: number;
} => {
  // Calculate weighted average of motion vectors
  let totalX = 0;
  let totalY = 0;
  let totalWeight = 0;

  motionData.forEach(({ x, y, magnitude }) => {
    totalX += x * magnitude;
    totalY += y * magnitude;
    totalWeight += magnitude;
  });

  const centerX = totalWeight ? totalX / totalWeight : 0.5;
  const centerY = totalWeight ? totalY / totalWeight : 0.5;

  // Calculate standard deviation to determine region size
  let varianceX = 0;
  let varianceY = 0;

  motionData.forEach(({ x, y, magnitude }) => {
    varianceX += Math.pow(x - centerX, 2) * magnitude;
    varianceY += Math.pow(y - centerY, 2) * magnitude;
  });

  const stdDevX = Math.sqrt(varianceX / totalWeight) || 0.25;
  const stdDevY = Math.sqrt(varianceY / totalWeight) || 0.25;

  return {
    x: Math.max(0, centerX - stdDevX),
    y: Math.max(0, centerY - stdDevY),
    width: Math.min(1, stdDevX * 2),
    height: Math.min(1, stdDevY * 2),
  };
};

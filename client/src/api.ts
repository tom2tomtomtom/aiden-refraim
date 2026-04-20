import type { FocusPoint, FocusPointCreate } from './types/focusPoint';
import type { ScanOptions, ScanProgress } from './types/scan';
import type { ExportQuality } from './types/video';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api';

export interface ProcessingJob {
  id: string;
  video_id: string;
  user_id: string;
  platforms: string[];
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Video {
  id: string;
  user_id: string;
  original_url: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  platform_outputs: Record<string, {
    url: string;
    format: string;
    width: number;
    height: number;
    status: 'complete' | 'error';
    error?: string;
  }> | null;
  processing_metadata?: {
    duration: number;
    fps: number;
    resolution: {
      width: number;
      height: number;
    };
  } | null;
  title?: string | null;
  description?: string | null;
  created_at: string;
  updated_at: string;
  processing_jobs?: ProcessingJob[];
}

export class ApiClient {
  // Auth travels via the HttpOnly `aiden-gw` cookie on every request.
  // The cookie is set by Gateway at login and scoped to .aiden.services,
  // so it reaches the refrAIm server automatically. We never read or
  // hold the JWT client-side.

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      const isFormData = options.body instanceof FormData;
      const headers: Record<string, string> = {
        ...options.headers as Record<string, string>,
      };

      if (!isFormData) {
        headers['Content-Type'] = 'application/json';
      }

      const url = `${API_BASE_URL}${endpoint}`;

      let response: Response;
      try {
        response = await fetch(url, {
          ...options,
          credentials: 'include',
          headers,
        });
      } catch (fetchError) {
        // Handle network errors
        if (fetchError instanceof TypeError && fetchError.message === 'Failed to fetch') {
          throw new Error(`Cannot connect to server at ${url}. Please ensure the server is running and try again.`);
        }
        throw fetchError;
      }

      let responseData: any;
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        try {
          responseData = await response.json();
        } catch {
          throw new Error('Server returned invalid JSON response');
        }
      } else {
        const text = await response.text();
        try {
          responseData = JSON.parse(text);
        } catch {
          responseData = { error: text };
        }
      }

      if (!response.ok) {
        let errorMessage = 'Request failed';
        if (responseData?.error) {
          errorMessage += `: ${responseData.error}`;
          if (responseData.details) {
            errorMessage += ` (${responseData.details})`;
          }
        } else {
          errorMessage += `: ${response.statusText}`;
        }

        const error = new Error(errorMessage);
        (error as any).status = response.status;
        (error as any).details = responseData;
        throw error;
      }

      return responseData;
    } catch (error) {
      throw error;
    }
  }

  async uploadVideo(
    file: File,
    platforms: string[],
    onProgress?: (percent: number) => void
  ): Promise<Video> {
    if (!(file instanceof File)) {
      throw new Error('Invalid file object');
    }

    const validTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
    if (!validTypes.includes(file.type)) {
      throw new Error(`Invalid file type: ${file.type}. Supported types: ${validTypes.join(', ')}`);
    }

    // Matches the server's multer fileSize limit.
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum size is 100MB.`);
    }

    if (!Array.isArray(platforms)) {
      throw new Error('platforms must be an array');
    }

    const formData = new FormData();
    formData.append('video', file);
    formData.append('platforms', JSON.stringify(platforms));
    const title = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    formData.append('title', title);

    // Use XHR (not fetch) because the Fetch API still doesn't expose
    // upload byte progress. Reporting actual bytes-sent %% up to 99 while
    // the server finishes its storage handoff gives the user meaningful
    // feedback during 100MB / multi-minute uploads.
    const url = `${API_BASE_URL}/videos/upload`;

    return new Promise<Video>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;

      // No Content-Type: FormData sets its own multipart boundary. Don't
      // set Authorization either — the aiden-gw cookie is HttpOnly and
      // travels automatically via withCredentials.

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            // Cap at 99 while we wait for the server to hand off to Supabase
            // storage; the server response flips us to 100.
            const pct = Math.min(99, Math.round((e.loaded / e.total) * 99));
            onProgress(pct);
          }
        });
      }

      xhr.onload = () => {
        let body: unknown;
        try {
          body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
        } catch {
          body = { error: xhr.responseText || 'Invalid server response' };
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as Video);
        } else {
          const msg = (body as { error?: string; details?: string })?.error || `Request failed: ${xhr.statusText || xhr.status}`;
          const err = new Error(msg);
          (err as Error & { status?: number }).status = xhr.status;
          reject(err);
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.ontimeout = () => reject(new Error('Upload timed out'));
      xhr.onabort = () => reject(new Error('Upload aborted'));

      xhr.send(formData);
    });
  }

  async getUserVideos(): Promise<Video[]> {
    return this.request<Video[]>('/videos/user/videos');
  }

  // Focus Points
  async getFocusPoints(videoId: string): Promise<FocusPoint[]> {
    const data = await this.request<FocusPoint[] | { focus_points: FocusPoint[] }>(`/videos/${videoId}/focus-points`);
    const raw = Array.isArray(data) ? data : (data.focus_points || []);
    return raw.map(fp => ({ ...fp, description: fp.description || 'untitled' }));
  }

  async createFocusPoints(videoId: string, points: FocusPointCreate[]): Promise<FocusPoint[]> {
    const data = await this.request<FocusPoint[] | { focus_points: FocusPoint[] }>(`/videos/${videoId}/focus-points`, {
      method: 'POST',
      body: JSON.stringify({ focus_points: points }),
    });
    const raw = Array.isArray(data) ? data : (data.focus_points || []);
    return raw.map(fp => ({ ...fp, description: fp.description || 'untitled' }));
  }

  async updateFocusPoint(videoId: string, pointId: string, updates: Partial<FocusPointCreate>): Promise<FocusPoint> {
    const data = await this.request<{ focus_point: FocusPoint }>(`/videos/${videoId}/focus-points/${pointId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return { ...data.focus_point, description: data.focus_point.description || 'untitled' };
  }

  async deleteFocusPoint(videoId: string, pointId: string): Promise<void> {
    await this.request(`/videos/${videoId}/focus-points/${pointId}`, { method: 'DELETE' });
  }

  async deleteAllFocusPoints(videoId: string): Promise<number> {
    const data = await this.request<{ deleted_count: number }>(`/videos/${videoId}/focus-points`, { method: 'DELETE' });
    return data.deleted_count;
  }

  // Scanning
  async startScan(videoId: string, options: ScanOptions = {}): Promise<{ scan_id: string }> {
    return this.request<{ scan_id: string }>(`/videos/${videoId}/scan`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async getScanStatus(videoId: string, scanId: string): Promise<ScanProgress> {
    return this.request<ScanProgress>(`/videos/${videoId}/scan/${scanId}/status`);
  }

  // Processing
  async processVideo(videoId: string, options: { platforms: string[]; letterbox?: boolean; quality?: ExportQuality }): Promise<{ job_id: string }> {
    return this.request<{ job_id: string }>(`/videos/${videoId}/process`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async getProcessingStatus(videoId: string): Promise<{ status: string; progress: number; platforms: Record<string, { status: string; progress: number; url?: string; error?: string }> }> {
    return this.request(`/videos/${videoId}/status`);
  }

  async getOutputDownloadUrl(videoId: string, platform: string): Promise<{ url: string; platform: string; expires_in: number }> {
    return this.request(`/videos/${videoId}/outputs/${platform}`);
  }

  // Single video fetch
  async getVideo(videoId: string): Promise<Video> {
    return this.request<Video>(`/videos/${videoId}`);
  }

  // Delete video
  async deleteVideo(videoId: string): Promise<void> {
    await this.request(`/videos/${videoId}`, { method: 'DELETE' });
  }

  // Billing
  async getCurrentPlan(): Promise<{ plan: string; exports_this_month: number; exports_limit: number; subscription_status?: string }> {
    return this.request('/billing/plan');
  }

  async getPlans(): Promise<{ plans: Array<{ id: string; name: string; price: number; exports_per_month: number }> }> {
    return this.request('/billing/plans');
  }

  async createCheckout(plan: string): Promise<{ url: string }> {
    return this.request('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
  }

  async createPortalSession(): Promise<{ url: string }> {
    return this.request('/billing/portal', { method: 'POST' });
  }

  // AI Editor
  async getAIFocusStrategy(
    videoId: string,
    subjects: Array<{
      id: string;
      class: string;
      first_seen: number;
      last_seen: number;
      position_count: number;
      avg_screen_coverage: number;
      avg_confidence: number;
    }>,
    videoDuration: number,
    targetPlatform: string,
    storyBrief?: string,
    storyAnnotations?: Array<{
      id: string;
      time: number;
      bbox: [number, number, number, number];
      label: string;
      isKeyMoment: boolean;
      frameImageBase64?: string;
    }>,
    keyFrames?: Array<{
      time: number;
      imageBase64: string;
    }>,
  ): Promise<{
    segments: Array<{
      time_start: number;
      time_end: number;
      follow_subject: string;
      composition: string;
      offset_x: number;
      offset_y: number;
      transition: string;
      reason: string;
    }>;
    reasoning: string;
  }> {
    return this.request(`/videos/${videoId}/ai-edit`, {
      method: 'POST',
      body: JSON.stringify({
        subjects,
        videoDuration,
        targetPlatform,
        storyBrief,
        storyAnnotations,
        keyFrames,
      }),
    });
  }

  async reviewCrops(
    videoId: string,
    crops: Array<{
      time: number;
      imageBase64: string;
      description: string;
      ratio: string;
    }>,
    targetPlatform: string,
  ): Promise<{
    reviews: Array<{
      time: number;
      quality: 'good' | 'needs_adjustment' | 'bad';
      issues: string[];
      suggestion: string;
    }>;
  }> {
    return this.request(`/videos/${videoId}/review-crops`, {
      method: 'POST',
      body: JSON.stringify({ crops, targetPlatform }),
    });
  }
}

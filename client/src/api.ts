import type { FocusPoint, FocusPointCreate } from './types/focusPoint';
import type { ScanOptions, ScanProgress } from './types/scan';
import type { ExportQuality } from './types/video';

const API_BASE_URL = import.meta.env.VITE_API_URL;

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
  private accessToken: string;

  constructor(accessToken: string) {
    if (!accessToken) {
      throw new Error('Access token is required');
    }
    console.log('ApiClient initialized, hasToken:', !!accessToken);
    this.accessToken = accessToken;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    try {
      const isFormData = options.body instanceof FormData;
      const headers: Record<string, string> = {
        ...options.headers as Record<string, string>,
        'Authorization': `Bearer ${this.accessToken}`,
      };

      if (!isFormData) {
        headers['Content-Type'] = 'application/json';
      }

      const url = `${API_BASE_URL}${endpoint}`;
      console.log('Making request:', {
        url,
        method: options.method || 'GET',
        hasToken: !!this.accessToken,
        isFormData,
        bodySize: options.body instanceof FormData ? 
          Array.from(options.body.entries()).reduce((size, [_, value]) => 
            size + (value instanceof File ? value.size : value.toString().length), 0) : 
          options.body ? JSON.stringify(options.body).length : 0
      });

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
        } catch (parseError) {
          console.error('Failed to parse JSON response:', parseError);
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
        console.error('Request failed:', {
          status: response.status,
          statusText: response.statusText,
          error: responseData
        });

        // Try to extract error details
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
      console.error('Request error:', {
        error,
        stack: error instanceof Error ? error.stack : undefined,
        endpoint,
        method: options.method || 'GET'
      });
      throw error;
    }
  }

  async uploadVideo(file: File, platforms: string[]): Promise<Video> {
    // Validate file
    if (!(file instanceof File)) {
      throw new Error('Invalid file object');
    }

    // Validate file type
    const validTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
    if (!validTypes.includes(file.type)) {
      throw new Error(`Invalid file type: ${file.type}. Supported types: ${validTypes.join(', ')}`);
    }

    // Validate file size (500MB)
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum size is 500MB.`);
    }

    // Validate platforms
    if (!Array.isArray(platforms) || platforms.length === 0) {
      throw new Error('Please specify at least one target platform');
    }

    const formData = new FormData();
    formData.append('video', file);
    formData.append('platforms', JSON.stringify(platforms));

    return this.request<Video>('/videos/upload', {
      method: 'POST',
      body: formData
    });
  }

  async getUserVideos(): Promise<Video[]> {
    console.log('Fetching user videos...');
    try {
      const videos = await this.request<Video[]>('/videos/user/videos');
      console.log('Fetched videos:', videos);
      return videos;
    } catch (err) {
      console.error('Failed to fetch videos:', err);
      throw err;
    }
  }

  // Focus Points
  async getFocusPoints(videoId: string): Promise<FocusPoint[]> {
    const data = await this.request<FocusPoint[] | { focus_points: FocusPoint[] }>(`/videos/${videoId}/focus-points`);
    return Array.isArray(data) ? data : (data.focus_points || []);
  }

  async createFocusPoints(videoId: string, points: FocusPointCreate[]): Promise<FocusPoint[]> {
    const data = await this.request<FocusPoint[] | { focus_points: FocusPoint[] }>(`/videos/${videoId}/focus-points`, {
      method: 'POST',
      body: JSON.stringify({ focus_points: points }),
    });
    return Array.isArray(data) ? data : (data.focus_points || []);
  }

  async updateFocusPoint(videoId: string, pointId: string, updates: Partial<FocusPointCreate>): Promise<FocusPoint> {
    const data = await this.request<{ focus_point: FocusPoint }>(`/videos/${videoId}/focus-points/${pointId}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    return data.focus_point;
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
}

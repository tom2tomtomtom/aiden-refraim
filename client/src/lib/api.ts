import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL;

interface VideoUploadData {
  title?: string;
  description?: string;
  file: File;
}

interface ProcessVideoData {
  platforms: string[];
}

export class ApiClient {
  private static async getAuthHeaders(): Promise<HeadersInit> {
    const { data: { session } } = await supabase.auth.getSession();
    return {
      Authorization: `Bearer ${session?.access_token}`,
    };
  }

  static async uploadVideo(data: VideoUploadData) {
    const formData = new FormData();
    formData.append('video', data.file);
    if (data.title) formData.append('title', data.title);
    if (data.description) formData.append('description', data.description);

    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_URL}/videos/upload`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!response.ok) {
      throw new Error('Failed to upload video');
    }

    return response.json();
  }

  static async getUserVideos() {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_URL}/videos/user/videos`, {
      headers,
    });

    if (!response.ok) {
      throw new Error('Failed to fetch videos');
    }

    return response.json();
  }

  static async getVideo(id: string) {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_URL}/videos/${id}`, {
      headers,
    });

    if (!response.ok) {
      throw new Error('Failed to fetch video');
    }

    return response.json();
  }

  static async getVideoStatus(id: string) {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_URL}/videos/${id}/status`, {
      headers,
    });

    if (!response.ok) {
      throw new Error('Failed to fetch video status');
    }

    return response.json();
  }

  static async processVideo(id: string, data: ProcessVideoData) {
    const headers = {
      ...(await this.getAuthHeaders()),
      'Content-Type': 'application/json',
    };

    const response = await fetch(`${API_URL}/videos/${id}/process`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error('Failed to start video processing');
    }

    return response.json();
  }

  static async deleteVideo(id: string) {
    const headers = await this.getAuthHeaders();
    const response = await fetch(`${API_URL}/videos/${id}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok) {
      throw new Error('Failed to delete video');
    }
  }
}

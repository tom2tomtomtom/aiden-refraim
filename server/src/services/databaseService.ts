import { supabase } from '../config/supabase';
import { Video, ProcessingJob } from '../types/database';

export class DatabaseService {
  static async createVideo(data: Partial<Video>): Promise<Video> {
    console.log('Creating video record:', data);

    try {
      // 1. Validate required fields
      if (!data.user_id) throw new Error('user_id is required');
      if (!data.original_url) throw new Error('original_url is required');
      if (!data.status) throw new Error('status is required');

      // 2. Ensure platforms is an array
      if (!Array.isArray(data.platforms)) {
        console.warn('Platforms is not an array, defaulting to empty array');
        data.platforms = [];
      }

      // 3. Create the record
      const { data: video, error } = await supabase
        .from('videos')
        .insert([{
          ...data,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();

      if (error) {
        console.error('Database error creating video:', error);
        throw new Error(`Database error: ${error.message}`);
      }

      if (!video) {
        throw new Error('Failed to create video record: No data returned');
      }

      console.log('Video record created successfully:', { id: video.id });
      return video;
    } catch (error) {
      console.error('Error in createVideo:', error);
      throw error;
    }
  }

  static async getVideo(id: string): Promise<Video | null> {
    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return video;
  }

  static async updateVideo(id: string, data: Partial<Video>): Promise<Video> {
    const { data: video, error } = await supabase
      .from('videos')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return video;
  }

  static async createProcessingJob(data: Partial<ProcessingJob>): Promise<ProcessingJob> {
    const { data: job, error } = await supabase
      .from('processing_jobs')
      .insert([data])
      .select()
      .single();

    if (error) throw error;
    return job;
  }

  static async updateProcessingJob(id: string, data: Partial<ProcessingJob>): Promise<ProcessingJob> {
    const { data: job, error } = await supabase
      .from('processing_jobs')
      .update(data)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return job;
  }

  static async getProcessingJob(id: string): Promise<ProcessingJob | null> {
    const { data: job, error } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return job;
  }

  static async getUserVideos(userId: string): Promise<Video[]> {
    const { data: videos, error } = await supabase
      .from('videos')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return videos;
  }

  static async deleteVideo(id: string): Promise<void> {
    const { error } = await supabase
      .from('videos')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

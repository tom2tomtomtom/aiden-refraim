import { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useApi } from './ApiContext';
import type { Video } from '../types/video';

interface VideoContextType {
  video: Video | null;
  videoUrl: string | null;
  videoId: string | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  isLoading: boolean;
  error: string | null;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (p: boolean) => void;
  setDuration: (d: number) => void;
  loadVideo: (id: string) => Promise<void>;
  videoElementRef: React.RefObject<HTMLVideoElement | null>;
}

const VideoContext = createContext<VideoContextType | undefined>(undefined);

export function VideoProvider({ children }: { children: React.ReactNode }) {
  const { api } = useApi();
  const [video, setVideo] = useState<Video | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);

  const loadVideo = useCallback(async (id: string) => {
    if (!api) return;
    setIsLoading(true);
    setError(null);
    try {
      const videoData = await api.getVideo(id);
      setVideo(videoData);
      setVideoUrl(videoData.original_url);
      setVideoId(videoData.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load video');
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  return (
    <VideoContext.Provider
      value={{
        video,
        videoUrl,
        videoId,
        duration,
        currentTime,
        isPlaying,
        isLoading,
        error,
        setCurrentTime,
        setIsPlaying,
        setDuration,
        loadVideo,
        videoElementRef,
      }}
    >
      {children}
    </VideoContext.Provider>
  );
}

export function useVideo() {
  const context = useContext(VideoContext);
  if (context === undefined) {
    throw new Error('useVideo must be used within a VideoProvider');
  }
  return context;
}

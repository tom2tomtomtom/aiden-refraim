import { useEffect, useState } from 'react';
import { Video } from '../api';
import { useApi } from '../contexts/ApiContext';
import { Trash2, Play, Settings } from 'lucide-react';

interface VideoListProps {
  onVideoSelect: (video: Video) => void;
  onProcessVideo: (video: Video) => void;
  onDeleteVideo: (video: Video) => void;
}

export function VideoList({ onVideoSelect, onProcessVideo, onDeleteVideo }: VideoListProps) {
  const { api } = useApi();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadVideos = async () => {
    if (!api) {
      setError('Not authenticated');
      return;
    }

    try {
      setLoading(true);
      console.log('Loading videos...');
      const fetchedVideos = await api.getUserVideos();
      console.log('Fetched videos:', fetchedVideos);
      setVideos(fetchedVideos);
      setError(null);

      // If any videos are processing, poll for updates
      const hasProcessingVideos = fetchedVideos.some(v => v.status === 'processing');
      if (hasProcessingVideos) {
        const pollInterval = setInterval(async () => {
          const updatedVideos = await api.getUserVideos();
          setVideos(updatedVideos);
          
          // Stop polling if no videos are processing
          if (!updatedVideos.some(v => v.status === 'processing')) {
            clearInterval(pollInterval);
          }
        }, 5000); // Poll every 5 seconds

        // Cleanup interval on unmount
        return () => clearInterval(pollInterval);
      }
    } catch (err) {
      console.error('Failed to load videos:', err);
      setError('Failed to load videos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (api) {
      loadVideos();
    } else {
      setLoading(false);
      setError('Please log in to view videos');
    }
  }, [api]);



  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-500 p-4">
        {error}
        <button
          onClick={loadVideos}
          className="ml-2 text-blue-500 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="text-center text-gray-500 p-8">
        No videos uploaded yet
      </div>
    );
  }

  return (
    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {videos.map((video) => (
        <div
          key={video.id}
          className="bg-white rounded-lg shadow-md overflow-hidden"
        >
          <div className="aspect-video bg-gray-100 relative">
            <video
              src={video.platform_outputs?.youtube?.url || video.original_url}
              className="w-full h-full object-cover"
              onClick={() => onVideoSelect(video)}
              controls
            />
            <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-opacity flex items-center justify-center opacity-0 hover:opacity-100">
              <Play className="w-12 h-12 text-white" />
            </div>
          </div>

          <div className="p-4">
            <h3 className="font-medium truncate">
              {video.original_url.split('/').pop() || 'Untitled Video'}
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {new Date(video.created_at).toLocaleDateString()}
            </p>

            <div className="flex items-center justify-between mt-4">
              <div className="text-sm">
                {video.status === 'completed' ? (
                  <span className="text-green-500">✓ Processed</span>
                ) : video.status === 'processing' ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                    <span className="text-blue-500">
                      Processing {video.processing_jobs?.[0]?.progress || 0}%
                    </span>
                  </div>
                ) : video.status === 'failed' ? (
                  <span className="text-red-500" title={video.processing_jobs?.[0]?.error || 'Processing failed'}>
                    Failed
                  </span>
                ) : (
                  <span className="text-gray-500">Pending</span>
                )}
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => onProcessVideo(video)}
                  disabled={video.status === 'processing'}
                  className="p-2 text-gray-600 hover:text-blue-500 rounded-full hover:bg-blue-50"
                  title="Process Video"
                >
                  <Settings className="w-5 h-5" />
                </button>
                <button
                  onClick={() => onDeleteVideo(video)}
                  className="p-2 text-gray-600 hover:text-red-500 rounded-full hover:bg-red-50"
                  title="Delete Video"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

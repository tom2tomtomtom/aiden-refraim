import { useEffect, useState, useRef } from 'react';
import { Video } from '../api';
import { useApi } from '../contexts/ApiContext';
import { Trash2, Play, Settings, AlertTriangle } from 'lucide-react';

function formatVideoName(url: string): string {
  const filename = url.split('/').pop() || 'Untitled Video';
  // Strip UUIDs and timestamps from filenames like "abc123-def456_1234567890_video.mp4"
  const cleaned = filename
    .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}[_-]?/gi, '')
    .replace(/^\d{10,}_?/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return cleaned || 'Untitled Video';
}

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
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Video | null>(null);

  const loadVideos = async () => {
    if (!api) {
      setError('Not authenticated');
      return;
    }

    try {
      setLoading(true);
      const fetchedVideos = await api.getUserVideos();
      setVideos(fetchedVideos);
      setError(null);

      // Clear any existing polling interval
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      // If any videos are processing, poll for updates
      const hasProcessingVideos = fetchedVideos.some(v => v.status === 'PROCESSING');
      if (hasProcessingVideos) {
        pollIntervalRef.current = setInterval(async () => {
          const updatedVideos = await api.getUserVideos();
          setVideos(updatedVideos);

          // Stop polling if no videos are processing
          if (!updatedVideos.some(v => v.status === 'PROCESSING')) {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
          }
        }, 5000); // Poll every 5 seconds
      }
    } catch {
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

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [api]);



  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <div className="animate-spin h-8 w-8 border-b-2 border-red-hot" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-500 p-4">
        {error}
        <button
          onClick={loadVideos}
          className="ml-2 text-orange-accent hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="text-center p-12 bg-black-card border-2 border-border-subtle">
        <p className="text-white-muted text-lg font-bold uppercase tracking-wide mb-2">No videos yet</p>
        <p className="text-white-dim text-sm mb-6">Upload your first video to get started</p>
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className="px-6 py-3 bg-red-hot text-white text-sm font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all"
        >
          Upload a Video
        </button>
      </div>
    );
  }

  const confirmDelete = (video: Video) => {
    setDeleteTarget(video);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      onDeleteVideo(deleteTarget);
      setDeleteTarget(null);
    }
  };

  return (
    <>
    {/* Delete confirmation dialog */}
    {deleteTarget && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
        <div className="bg-black-card border-2 border-red-hot p-6 max-w-sm w-full mx-4">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-red-hot shrink-0" />
            <h3 className="text-white-full font-bold uppercase text-sm">Delete Video</h3>
          </div>
          <p className="text-white-muted text-sm mb-6">
            Are you sure you want to delete "{deleteTarget.title || formatVideoName(deleteTarget.original_url)}"? This action cannot be undone.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setDeleteTarget(null)}
              className="px-4 py-2 bg-black-card text-white-muted text-xs font-bold uppercase tracking-wide border border-border-subtle hover:border-white-dim transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDelete}
              className="px-4 py-2 bg-red-hot text-white text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    )}

    <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
      {videos.map((video) => (
        <div
          key={video.id}
          className="bg-black-card border border-border-subtle overflow-hidden"
        >
          <div
            className="aspect-video bg-black-deep relative cursor-pointer group"
            onClick={() => onVideoSelect(video)}
          >
            <video
              src={video.platform_outputs?.youtube?.url || video.original_url}
              crossOrigin="anonymous"
              className="w-full h-full object-cover pointer-events-none"
              preload="metadata"
            />
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-opacity flex items-center justify-center">
              <Play className="w-12 h-12 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>

          <div className="p-4">
            <h3 className="font-bold text-white uppercase tracking-wide truncate">
              {video.title || formatVideoName(video.original_url)}
            </h3>
            <p className="text-sm text-white-dim mt-1">
              {new Date(video.created_at).toLocaleDateString()}
            </p>

            <div className="flex items-center justify-between mt-4">
              <div className="text-sm">
                {video.status === 'COMPLETE' ? (
                  <span className="text-green-500">✓ Processed</span>
                ) : video.status === 'PROCESSING' ? (
                  <div className="flex items-center space-x-2">
                    <div className="animate-spin h-4 w-4 border-b-2 border-red-hot" />
                    <span className="text-orange-accent">
                      Processing {video.processing_jobs?.[0]?.progress || 0}%
                    </span>
                  </div>
                ) : video.status === 'ERROR' ? (
                  <span className="text-red-500" title={video.processing_jobs?.[0]?.error || 'Processing failed'}>
                    Failed
                  </span>
                ) : (
                  <span className="text-white-muted">Pending</span>
                )}
              </div>

              <div className="flex space-x-2">
                <button
                  onClick={() => onVideoSelect(video)}
                  className="p-2 text-white-muted hover:text-orange-accent hover:bg-black-deep"
                  title="Edit Video"
                >
                  <Settings className="w-5 h-5" />
                </button>
                <button
                  onClick={() => confirmDelete(video)}
                  className="p-2 text-white-muted hover:text-red-hot hover:bg-black-deep"
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
    </>
  );
}

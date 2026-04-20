import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { VideoUpload } from '../components/VideoUpload';
import { VideoList } from '../components/VideoList';
import { ProcessingDialog } from '../components/ProcessingDialog';
import { Toast } from '../components/Toast';
import { useApi } from '../contexts/ApiContext';
import { useAuth } from '../contexts/AuthContext';

interface Video {
  id: string;
  title: string | null;
  description: string | null;
  original_url: string;
  status: string;
  platform_outputs: Record<string, any> | null;
  created_at: string;
}

export function Dashboard() {
  const { user } = useAuth();
  const { api } = useApi();
  const navigate = useNavigate();
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [processingDialogOpen, setProcessingDialogOpen] = useState(false);
  const [toast, setToast] = useState<{
    open: boolean;
    title: string;
    description?: string;
    type?: 'success' | 'error' | 'info';
  }>({
    open: false,
    title: '',
  });

  const showToast = (
    title: string,
    description?: string,
    type: 'success' | 'error' | 'info' = 'info'
  ) => {
    setToast({ open: true, title, description, type });
  };

  const handleUploadComplete = (videoId: string) => {
    showToast(
      'Video uploaded successfully',
      'Navigating to editor...',
      'success'
    );
    navigate(`/editor/${videoId}`);
  };

  const handleUploadError = (error: Error) => {
    showToast('Upload failed', error.message, 'error');
  };

  const handleProcessVideo = (video: Video) => {
    setSelectedVideo(video);
    setProcessingDialogOpen(true);
  };

  const handleStartProcessing = async (formats: string[]) => {
    if (!selectedVideo) return;

    try {
      if (!api) return;
      await api.processVideo(selectedVideo.id, { platforms: formats });
      showToast(
        'Processing started',
        'You will be notified when processing is complete',
        'success'
      );
    } catch (error) {
      showToast(
        'Processing failed',
        'Failed to start video processing',
        'error'
      );
    }
  };

  const handleDeleteVideo = async (video: Video) => {
    try {
      if (!api) return;
      await api.deleteVideo(video.id);
      showToast('Video deleted', undefined, 'success');
    } catch (error) {
      showToast('Delete failed', 'Failed to delete video', 'error');
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen bg-black-deep">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4 text-white-full">Please sign in</h1>
          <p className="text-white-dim">
            You need to be signed in to access this page
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2 text-white-full">refrAIm</h1>
        <p className="text-white-dim">
          AI-powered video processing for social media
        </p>
      </div>

      <div className="mb-12">
        <h2 className="text-xl font-semibold mb-4 text-white-muted">Upload New Video</h2>
        <VideoUpload
          onUploadComplete={handleUploadComplete}
          onError={handleUploadError}
        />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4 text-white-muted">Your Videos</h2>
        <VideoList
          onVideoSelect={(video) => navigate(`/editor/${video.id}`)}
          onProcessVideo={handleProcessVideo}
          onDeleteVideo={handleDeleteVideo}
        />
      </div>

      <ProcessingDialog
        open={processingDialogOpen}
        onOpenChange={setProcessingDialogOpen}
        onProcess={handleStartProcessing}
      />

      <Toast
        open={toast.open}
        onOpenChange={(open) => setToast((prev) => ({ ...prev, open }))}
        title={toast.title}
        description={toast.description}
        type={toast.type}
      />
    </div>
  );
}

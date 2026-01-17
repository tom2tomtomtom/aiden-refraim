import { useState } from 'react';
import { VideoUpload } from '../components/VideoUpload';
import { VideoList } from '../components/VideoList';
import { ProcessingDialog } from '../components/ProcessingDialog';
import { Toast } from '../components/Toast';
import { ApiClient } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Video } from '../api';

export function Dashboard() {
  const { user } = useAuth();
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

  const handleUploadComplete = (_videoId: string) => {
    showToast(
      'Video uploaded successfully',
      'Your video is ready for processing',
      'success'
    );
    // Trigger a refresh of the video list
    // You might want to implement this using React Query or similar
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
      await ApiClient.processVideo(selectedVideo.id, { platforms: formats });
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
    if (!confirm('Are you sure you want to delete this video?')) return;

    try {
      await ApiClient.deleteVideo(video.id);
      showToast('Video deleted', undefined, 'success');
      // Trigger a refresh of the video list
    } catch (error) {
      showToast('Delete failed', 'Failed to delete video', 'error');
    }
  };

  if (!user) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Please sign in</h1>
          <p className="text-gray-600">
            You need to be signed in to access this page
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">REFRAIM</h1>
        <p className="text-gray-600">
          AI-powered video processing for social media
        </p>
      </div>

      <div className="mb-12">
        <h2 className="text-xl font-semibold mb-4">Upload New Video</h2>
        <VideoUpload
          onUploadComplete={handleUploadComplete}
          onError={handleUploadError}
        />
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Your Videos</h2>
        <VideoList
          onVideoSelect={() => {}}
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

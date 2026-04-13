import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useVideo } from '../contexts/VideoContext';
import { useFocusPoints } from '../contexts/FocusPointsContext';
import VideoExporter from '../components/video/VideoExporter';
import AspectRatioPreview from '../components/video/AspectRatioPreview';

export default function ExportPage() {
  const { videoId: paramVideoId } = useParams<{ videoId: string }>();
  const { loadVideo, videoUrl, isLoading } = useVideo();
  const { loadFocusPoints } = useFocusPoints();

  useEffect(() => {
    if (paramVideoId && !videoUrl) {
      loadVideo(paramVideoId);
      loadFocusPoints(paramVideoId);
    }
  }, [paramVideoId, videoUrl, loadVideo, loadFocusPoints]);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="animate-pulse">
          <div className="h-64 bg-black-card border-2 border-border-subtle" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <VideoExporter />
        </div>
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-red-hot uppercase">Preview</h2>
          <AspectRatioPreview ratio="9:16" width={200} />
          <AspectRatioPreview ratio="1:1" width={200} />
          <AspectRatioPreview ratio="4:5" width={200} />

          <Link
            to={`/editor/${paramVideoId}`}
            className="block w-full text-center bg-black-card text-white-muted px-6 py-3 text-xs font-bold uppercase tracking-wide border border-border-subtle hover:border-red-hot transition-all"
          >
            Back to Editor
          </Link>
        </div>
      </div>
    </div>
  );
}

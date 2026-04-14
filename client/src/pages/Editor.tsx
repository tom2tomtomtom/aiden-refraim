import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useVideo } from '../contexts/VideoContext';
import { useFocusPoints } from '../contexts/FocusPointsContext';
import VideoPlayer from '../components/editor/VideoPlayer';
import VideoTimeline from '../components/editor/VideoTimeline';
import FocusSelector from '../components/editor/FocusSelector';
import FocusPointOverlay from '../components/editor/FocusPointOverlay';
import FocusPointEditor from '../components/editor/FocusPointEditor';
import AspectRatioPreview from '../components/video/AspectRatioPreview';

export default function Editor() {
  const { videoId: paramVideoId } = useParams<{ videoId: string }>();
  const { loadVideo, videoUrl, isLoading, error } = useVideo();
  const { loadFocusPoints } = useFocusPoints();
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  useEffect(() => {
    if (paramVideoId) {
      loadVideo(paramVideoId);
      loadFocusPoints(paramVideoId);
    }
  }, [paramVideoId, loadVideo, loadFocusPoints]);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="animate-pulse">
          <div className="aspect-video bg-black-card border-2 border-border-subtle mb-4" />
          <div className="h-12 bg-black-card border-2 border-border-subtle mb-4" />
          <div className="h-40 bg-black-card border-2 border-border-subtle" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 text-center">
        <div className="bg-black-card border-2 border-red-hot p-8">
          <p className="text-red-hot text-sm font-bold uppercase mb-4">Error Loading Video</p>
          <p className="text-white-muted text-sm mb-4">{error}</p>
          <Link to="/" className="text-orange-accent text-xs font-bold uppercase tracking-wide hover:text-red-hot transition-colors">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Video + Controls */}
        <div className="lg:col-span-2 space-y-4">
          {/* Video player with focus point overlay */}
          <div className="relative">
            <VideoPlayer />
            {videoUrl && (
              <FocusPointOverlay
                selectedPointId={selectedPointId}
                onFocusPointSelect={setSelectedPointId}
              />
            )}
          </div>

          <VideoTimeline
            selectedPointId={selectedPointId}
            onFocusPointSelect={setSelectedPointId}
          />

          {/* Focus point editor (shown when a point is selected) */}
          {selectedPointId && (
            <FocusPointEditor
              selectedPointId={selectedPointId}
              onClose={() => setSelectedPointId(null)}
            />
          )}

          <FocusSelector />
        </div>

        {/* Right: Previews */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <h2 className="text-lg font-bold text-red-hot uppercase">Live Preview</h2>
          </div>
          <p className="text-[10px] text-white-dim uppercase tracking-wide -mt-2">
            Shows reframe using your focus points in real time
          </p>
          <AspectRatioPreview ratio="9:16" width={240} />
          <AspectRatioPreview ratio="1:1" width={240} />
          <AspectRatioPreview ratio="4:5" width={240} />

          <Link
            to={`/export/${paramVideoId}`}
            className="block w-full text-center bg-red-hot text-white px-6 py-3 text-sm font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all"
          >
            Preview &amp; Export
          </Link>
        </div>
      </div>
    </div>
  );
}

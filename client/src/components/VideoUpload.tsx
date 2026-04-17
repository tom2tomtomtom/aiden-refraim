import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload } from 'lucide-react';
import { ApiClient } from '../api';
import { useAuth } from '../contexts/AuthContext';

interface VideoUploadProps {
  onUploadComplete: (videoId: string) => void;
  onError: (error: Error) => void;
}

export function VideoUpload({ onUploadComplete, onError }: VideoUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const videoFile = acceptedFiles[0];
    if (videoFile) {
      setFile(videoFile);
    }
  }, []);

  // Keep this aligned with the server's multer limit in server/src/routes/videoRoutes.ts
  const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100MB
  const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.avi']
    },
    maxFiles: 1,
    maxSize: MAX_UPLOAD_BYTES,
  });

  const { jwt } = useAuth();

  const handleUpload = async () => {
    if (!file) {
      onError(new Error('Please select a video file to upload'));
      return;
    }

    if (!jwt) {
      onError(new Error('You must be logged in to upload videos'));
      return;
    }

    // Validate file type
    const validTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
    if (!validTypes.includes(file.type)) {
      onError(new Error(`Invalid file type: ${file.type}. Please upload an MP4, MOV, or AVI file.`));
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      onError(new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum size is ${MAX_UPLOAD_MB}MB.`));
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      // Simulate progress during upload
      const progressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return 90;
          }
          return prev + 10;
        });
      }, 500);

      const apiClient = new ApiClient(jwt);
      // Platforms are selected later in the editor/process step. Sending an
      // empty array here avoids tripping the server's platform allowlist with
      // bogus values like ["youtube","instagram","tiktok"] that don't match
      // its canonical ids (youtube-main, instagram-story, etc.).
      const response = await apiClient.uploadVideo(file, []);

      clearInterval(progressInterval);
      setUploadProgress(100);

      onUploadComplete(response.id);
    } catch (error) {
      if (error instanceof Error) {
        onError(error);
      } else {
        onError(new Error('Failed to upload video. Please try again.'));
      }
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setFile(null);
    }
  };

  return (
    <div className="p-4 bg-black-card border-2 border-border-subtle">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${isDragActive ? 'border-red-hot bg-black-deep' : 'border-border-subtle hover:border-red-hot'}`}
      >
        <input {...getInputProps()} />
        {file ? (
          <div className="space-y-4">
            <p className="text-sm text-white-muted">{file.name}</p>
            {uploading && (
              <div className="w-full max-w-xs mx-auto">
                <div className="w-full h-3 bg-black-deep">
                  <div className="h-full bg-red-hot transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-xs text-white-dim mt-1">{uploadProgress}%</p>
              </div>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleUpload();
              }}
              disabled={uploading}
              className="px-4 py-2 bg-red-hot text-white text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <span className="flex items-center space-x-2">
                  <div className="animate-spin h-4 w-4 border-b-2 border-white" />
                  <span>Uploading...</span>
                </span>
              ) : (
                <span className="flex items-center space-x-2">
                  <Upload className="w-4 h-4" />
                  <span>Upload Video</span>
                </span>
              )}
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Upload className="w-12 h-12 mx-auto text-white-dim" />
            <p className="text-white-muted">
              Drag and drop a video file here, or click to select
            </p>
            <p className="text-sm text-white-dim">
              MP4, MOV, or AVI (max {MAX_UPLOAD_MB}MB)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

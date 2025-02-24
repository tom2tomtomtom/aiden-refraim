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
  const [file, setFile] = useState<File | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const videoFile = acceptedFiles[0];
    if (videoFile) {
      setFile(videoFile);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.mov', '.avi']
    },
    maxFiles: 1,
    maxSize: 500 * 1024 * 1024, // 500MB
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

    // Validate file size (500MB)
    const maxSize = 500 * 1024 * 1024;
    if (file.size > maxSize) {
      onError(new Error(`File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB. Maximum size is 500MB.`));
      return;
    }

    try {
      setUploading(true);
      console.log('Starting upload:', {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        jwt: jwt.substring(0, 20) + '...'
      });

      const apiClient = new ApiClient(jwt);
      const response = await apiClient.uploadVideo(
        file,
        ['youtube', 'instagram', 'tiktok'] // TODO: Make this configurable
      );

      console.log('Upload completed successfully:', response);
      onUploadComplete(response.id);
    } catch (error) {
      console.error('Upload error:', {
        error,
        file: {
          name: file.name,
          type: file.type,
          size: file.size
        }
      });

      if (error instanceof Error) {
        onError(error);
      } else {
        onError(new Error('Failed to upload video. Please try again.'));
      }
    } finally {
      setUploading(false);
      setFile(null);
    }
  };

  return (
    <div className="p-4 bg-white rounded-lg shadow">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-500'}`}
      >
        <input {...getInputProps()} />
        {file ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{file.name}</p>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleUpload();
              }}
              disabled={uploading}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <span className="flex items-center space-x-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
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
            <Upload className="w-12 h-12 mx-auto text-gray-400" />
            <p className="text-gray-600">
              Drag and drop a video file here, or click to select
            </p>
            <p className="text-sm text-gray-500">
              MP4, MOV, or AVI (max 500MB)
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

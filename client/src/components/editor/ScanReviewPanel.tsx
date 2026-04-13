import React, { useRef, useState, useEffect } from 'react';
import { useScan } from '../../contexts/ScanContext';
import { useVideo } from '../../contexts/VideoContext';
import type { Subject } from '../../types/scan';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function SubjectCard({
  subject,
  isAccepted,
  isRejected,
  onAccept,
  onReject,
  onPreview,
  videoElement,
}: {
  subject: Subject;
  isAccepted: boolean;
  isRejected: boolean;
  onAccept: () => void;
  onReject: () => void;
  onPreview: () => void;
  videoElement: HTMLVideoElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasThumbnail, setHasThumbnail] = useState(false);
  const [thumbnailTimedOut, setThumbnailTimedOut] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!videoElement || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const firstPos = subject.positions[0];
    if (!firstPos) return;

    const savedTime = videoElement.currentTime;
    const onSeeked = () => {
      const vw = videoElement.videoWidth;
      const vh = videoElement.videoHeight;
      if (vw === 0 || vh === 0) return;
      canvas.width = 320;
      canvas.height = 180;
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

      // Draw yellow bounding box
      const scaleX = canvas.width / vw;
      const scaleY = canvas.height / vh;
      const [bx, by, bw, bh] = firstPos.bbox;
      // bbox is in percentage 0-100, convert to pixels
      const px = (bx / 100) * vw * scaleX;
      const py = (by / 100) * vh * scaleY;
      const pw = (bw / 100) * vw * scaleX;
      const ph = (bh / 100) * vh * scaleY;
      ctx.strokeStyle = '#FFFF00';
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, pw, ph);

      ctx.fillStyle = 'rgba(255, 255, 0, 0.85)';
      ctx.font = 'bold 11px Arial';
      const tm = ctx.measureText(subject.class);
      ctx.fillRect(px, py - 14, tm.width + 6, 14);
      ctx.fillStyle = '#000';
      ctx.fillText(subject.class, px + 3, py - 3);

      setHasThumbnail(true);
      videoElement.removeEventListener('seeked', onSeeked);
      videoElement.currentTime = savedTime;
    };
    videoElement.addEventListener('seeked', onSeeked);
    videoElement.currentTime = subject.first_seen;

    return () => videoElement.removeEventListener('seeked', onSeeked);
  }, [videoElement, subject]);

  useEffect(() => {
    if (hasThumbnail) return;
    const timer = setTimeout(() => {
      if (!hasThumbnail) setThumbnailTimedOut(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [hasThumbnail]);

  const showFeedback = (msg: string) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(null), 1500);
  };

  const handleAccept = () => {
    onAccept();
    showFeedback('Subject accepted');
  };

  const handleReject = () => {
    onReject();
    showFeedback('Subject rejected');
  };

  let borderClass = 'border-2 border-border-subtle bg-black-card';
  if (isAccepted) borderClass = 'border-2 border-orange-accent bg-black-deep';
  if (isRejected) borderClass = 'border-2 border-red-hot bg-black-card';

  return (
    <div className={`${borderClass} overflow-hidden relative`}>
      {feedbackMsg && (
        <div className="absolute top-0 left-0 right-0 z-10 bg-black-deep border-b border-border-subtle px-3 py-1.5 text-xs text-orange-accent font-bold uppercase text-center animate-pulse">
          {feedbackMsg}
        </div>
      )}
      <div className="p-3">
        <div className="flex justify-between items-start mb-2">
          <h4 className="font-bold text-white-muted capitalize text-sm">{subject.class}</h4>
          <span className="text-xs bg-black-deep text-orange-accent border border-orange-accent px-2 py-0.5">
            {subject.positions.length} frames
          </span>
        </div>
        <div className="text-xs text-white-dim mb-2">
          <div>Time: {formatTime(subject.first_seen)} - {formatTime(subject.last_seen)}</div>
          <div>Duration: {formatTime(subject.last_seen - subject.first_seen)}</div>
        </div>
        <div className="mb-3 cursor-pointer" onClick={onPreview}>
          <canvas
            ref={canvasRef}
            className={`w-full ${hasThumbnail ? '' : 'hidden'}`}
            style={{ display: hasThumbnail ? 'block' : 'none' }}
          />
          {!hasThumbnail && (
            <div className="bg-black-deep h-20 flex items-center justify-center border border-border-subtle">
              <span className="text-xs text-white-dim">
                {thumbnailTimedOut ? 'Preview unavailable' : 'Click to Preview'}
              </span>
            </div>
          )}
        </div>
        <div className="flex justify-between gap-2">
          <button
            onClick={handleReject}
            className={`flex-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
              isRejected ? 'bg-red-hot text-white border-2 border-red-hot' : 'border-2 border-red-hot text-red-hot hover:bg-red-hot hover:text-white'
            }`}
          >
            Reject
          </button>
          <button
            onClick={handleAccept}
            className={`flex-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
              isAccepted ? 'bg-orange-accent text-white border-2 border-orange-accent' : 'border-2 border-orange-accent text-orange-accent hover:bg-orange-accent hover:text-white'
            }`}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}

interface ScanReviewPanelProps {
  videoElement: HTMLVideoElement | null;
}

export default function ScanReviewPanel({ videoElement }: ScanReviewPanelProps) {
  const { detectedSubjects, acceptedIds, rejectedIds, acceptSubject, rejectSubject, acceptAll, rejectAll, finalize, cancelReview, scanStatus } = useScan();
  const { setCurrentTime, setIsPlaying } = useVideo();

  const handlePreview = (subject: Subject) => {
    setIsPlaying(false);
    setCurrentTime(subject.first_seen);
  };

  return (
    <div className="mt-3">
      <h4 className="text-sm font-bold text-red-hot uppercase mb-2">Review Detected Subjects</h4>
      <p className="text-xs text-white-dim mb-3">
        {detectedSubjects.length} subjects detected. Accept or reject each subject.
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={acceptAll} className="px-3 py-1.5 bg-orange-accent text-white text-xs font-bold uppercase tracking-wide border-2 border-orange-accent hover:bg-red-hot hover:border-red-hot transition-all">
          Accept All
        </button>
        <button onClick={rejectAll} className="px-3 py-1.5 bg-red-hot text-white text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all">
          Reject All
        </button>
        <button
          onClick={finalize}
          disabled={scanStatus === 'finalizing'}
          className="px-3 py-1.5 bg-red-hot text-white text-xs font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all disabled:opacity-50"
        >
          {scanStatus === 'finalizing' ? 'Finalizing...' : 'Finalize'}
        </button>
        <button onClick={cancelReview} className="px-3 py-1.5 bg-black-card text-white-muted text-xs font-bold uppercase tracking-wide border border-border-subtle hover:border-red-hot transition-all">
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {detectedSubjects.map(subject => (
          <SubjectCard
            key={subject.id}
            subject={subject}
            isAccepted={acceptedIds.has(subject.id)}
            isRejected={rejectedIds.has(subject.id)}
            onAccept={() => acceptSubject(subject.id)}
            onReject={() => rejectSubject(subject.id)}
            onPreview={() => handlePreview(subject)}
            videoElement={videoElement}
          />
        ))}
      </div>
    </div>
  );
}

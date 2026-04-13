import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { useApi } from './ApiContext';
import { useVideo } from './VideoContext';
import { useFocusPoints } from './FocusPointsContext';
import type { ScanOptions, Subject, ScanStatus } from '../types/scan';
import type { FocusPointCreate } from '../types/focusPoint';

interface ScanContextValue {
  scanStatus: ScanStatus;
  progress: number;
  detectedSubjects: Subject[];
  acceptedIds: Set<string>;
  rejectedIds: Set<string>;
  scanOptions: ScanOptions;
  error: string | null;
  setScanOptions: (opts: Partial<ScanOptions>) => void;
  startScan: () => Promise<void>;
  stopScan: () => void;
  acceptSubject: (id: string) => void;
  rejectSubject: (id: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  finalize: () => Promise<void>;
  cancelReview: () => void;
}

const ScanContext = createContext<ScanContextValue | undefined>(undefined);

export function ScanProvider({ children }: { children: React.ReactNode }) {
  const { api } = useApi();
  const { videoId } = useVideo();
  const { addFocusPointsBatch } = useFocusPoints();

  const [scanStatus, setScanStatus] = useState<ScanStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [detectedSubjects, setDetectedSubjects] = useState<Subject[]>([]);
  const [acceptedIds, setAcceptedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [scanOptions, setScanOptionsState] = useState<ScanOptions>({
    interval: 1.0,
    min_score: 0.5,
    similarity_threshold: 0.3,
    min_detections: 3,
  });
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanIdRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const setScanOptions = useCallback((opts: Partial<ScanOptions>) => {
    setScanOptionsState(prev => ({ ...prev, ...opts }));
  }, []);

  const startScan = useCallback(async () => {
    if (!api || !videoId) return;

    // Stop any existing poll first
    stopPolling();

    setError(null);
    setScanStatus('scanning');
    setProgress(0);
    setDetectedSubjects([]);
    setAcceptedIds(new Set());
    setRejectedIds(new Set());

    try {
      const { scan_id } = await api.startScan(videoId, scanOptions);
      scanIdRef.current = scan_id;

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.getScanStatus(videoId, scan_id);
          setProgress(status.progress);

          if (status.status === 'completed' && status.subjects) {
            stopPolling();
            setDetectedSubjects(status.subjects);
            // Auto-accept all subjects initially
            setAcceptedIds(new Set(status.subjects.map(s => s.id)));
            setScanStatus('review');
          } else if (status.status === 'failed') {
            stopPolling();
            setError(status.error_message || 'Scan failed');
            setScanStatus('idle');
          }
        } catch (err) {
          stopPolling();
          setError(err instanceof Error ? err.message : 'Failed to get scan status');
          setScanStatus('idle');
        }
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
      setScanStatus('idle');
    }
  }, [api, videoId, scanOptions, stopPolling]);

  const stopScan = useCallback(() => {
    stopPolling();
    setScanStatus('idle');
    scanIdRef.current = null;
  }, [stopPolling]);

  const acceptSubject = useCallback((id: string) => {
    setAcceptedIds(prev => { const next = new Set(prev); next.add(id); return next; });
    setRejectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const rejectSubject = useCallback((id: string) => {
    setRejectedIds(prev => { const next = new Set(prev); next.add(id); return next; });
    setAcceptedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const acceptAll = useCallback(() => {
    setAcceptedIds(new Set(detectedSubjects.map(s => s.id)));
    setRejectedIds(new Set());
  }, [detectedSubjects]);

  const rejectAll = useCallback(() => {
    setRejectedIds(new Set(detectedSubjects.map(s => s.id)));
    setAcceptedIds(new Set());
  }, [detectedSubjects]);

  const finalize = useCallback(async () => {
    setScanStatus('finalizing');
    const accepted = detectedSubjects.filter(s => acceptedIds.has(s.id));

    const focusPointCreates: FocusPointCreate[] = accepted.map(subject => {
      const firstPos = subject.positions[0];
      // bbox is [x, y, width, height] in percentages (0-100)
      const bx = firstPos ? firstPos.bbox[0] : 25;
      const by = firstPos ? firstPos.bbox[1] : 25;
      const bw = firstPos ? firstPos.bbox[2] : 50;
      const bh = firstPos ? firstPos.bbox[3] : 50;

      // Center of the bounding box
      const cx = bx + bw / 2;
      const cy = by + bh / 2;

      // Clamp to valid ranges ensuring x + width <= 100
      const width = Math.min(bw, 100);
      const height = Math.min(bh, 100);
      const x = Math.min(Math.max(0, cx - width / 2), 100 - width);
      const y = Math.min(Math.max(0, cy - height / 2), 100 - height);

      return {
        time_start: subject.first_seen,
        time_end: subject.last_seen,
        x,
        y,
        width,
        height,
        description: subject.class || 'detected_region',
        source: 'ai_detection' as const,
      };
    });

    if (focusPointCreates.length > 0) {
      await addFocusPointsBatch(focusPointCreates);
    }

    setScanStatus('idle');
    setDetectedSubjects([]);
    setAcceptedIds(new Set());
    setRejectedIds(new Set());
    scanIdRef.current = null;
  }, [detectedSubjects, acceptedIds, addFocusPointsBatch]);

  const cancelReview = useCallback(() => {
    setScanStatus('idle');
    setDetectedSubjects([]);
    setAcceptedIds(new Set());
    setRejectedIds(new Set());
    scanIdRef.current = null;
  }, []);

  return (
    <ScanContext.Provider value={{
      scanStatus, progress, detectedSubjects, acceptedIds, rejectedIds,
      scanOptions, error, setScanOptions, startScan, stopScan,
      acceptSubject, rejectSubject, acceptAll, rejectAll, finalize, cancelReview,
    }}>
      {children}
    </ScanContext.Provider>
  );
}

export function useScan(): ScanContextValue {
  const context = useContext(ScanContext);
  if (context === undefined) {
    throw new Error('useScan must be used within a ScanProvider');
  }
  return context;
}

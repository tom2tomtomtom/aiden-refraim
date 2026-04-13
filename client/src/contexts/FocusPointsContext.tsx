import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { useApi } from './ApiContext';
import { useVideo } from './VideoContext';
import { useActiveFocusPoint } from '../hooks/useActiveFocusPoint';
import type { FocusPoint, FocusPointCreate } from '../types/focusPoint';

interface FocusPointsContextValue {
  focusPoints: FocusPoint[];
  selectedPointId: string | null;
  activeFocusPoint: FocusPoint | null;
  isLoading: boolean;
  error: string | null;
  loadFocusPoints: (videoId: string) => Promise<void>;
  addFocusPoint: (fp: FocusPointCreate) => Promise<void>;
  addFocusPointsBatch: (fps: FocusPointCreate[]) => Promise<void>;
  updateFocusPoint: (id: string, updates: Partial<FocusPointCreate>) => Promise<void>;
  removeFocusPoint: (id: string) => Promise<void>;
  removeAllFocusPoints: () => Promise<void>;
  setSelectedPoint: (id: string | null) => void;
}

const FocusPointsContext = createContext<FocusPointsContextValue | undefined>(undefined);

export function FocusPointsProvider({ children }: { children: React.ReactNode }) {
  const { api } = useApi();
  const { videoId, currentTime } = useVideo();
  const [focusPoints, setFocusPoints] = useState<FocusPoint[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeFocusPoint = useActiveFocusPoint(focusPoints, currentTime);

  const loadFocusPoints = useCallback(async (vid: string) => {
    if (!api) return;
    setIsLoading(true);
    setError(null);
    try {
      const points = await api.getFocusPoints(vid);
      setFocusPoints(points);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load focus points');
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  const addFocusPoint = useCallback(async (fp: FocusPointCreate) => {
    if (!api || !videoId) return;
    try {
      const created = await api.createFocusPoints(videoId, [fp]);
      setFocusPoints(prev => [...prev, ...created].sort((a, b) => a.time_start - b.time_start));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create focus point');
    }
  }, [api, videoId]);

  const addFocusPointsBatch = useCallback(async (fps: FocusPointCreate[]) => {
    if (!api || !videoId || fps.length === 0) return;
    try {
      const created = await api.createFocusPoints(videoId, fps);
      setFocusPoints(prev => [...prev, ...created].sort((a, b) => a.time_start - b.time_start));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create focus points');
    }
  }, [api, videoId]);

  const updateFocusPointFn = useCallback(async (id: string, updates: Partial<FocusPointCreate>) => {
    if (!api || !videoId) return;
    try {
      const updated = await api.updateFocusPoint(videoId, id, updates);
      setFocusPoints(prev =>
        prev.map(fp => fp.id === id ? updated : fp).sort((a, b) => a.time_start - b.time_start)
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update focus point');
    }
  }, [api, videoId]);

  const removeFocusPoint = useCallback(async (id: string) => {
    if (!api || !videoId) return;
    try {
      await api.deleteFocusPoint(videoId, id);
      setFocusPoints(prev => prev.filter(fp => fp.id !== id));
      if (selectedPointId === id) setSelectedPointId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete focus point');
    }
  }, [api, videoId, selectedPointId]);

  const removeAllFocusPoints = useCallback(async () => {
    if (!api || !videoId) return;
    try {
      await api.deleteAllFocusPoints(videoId);
      setFocusPoints([]);
      setSelectedPointId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete focus points');
    }
  }, [api, videoId]);

  const value = useMemo(() => ({
    focusPoints,
    selectedPointId,
    activeFocusPoint,
    isLoading,
    error,
    loadFocusPoints,
    addFocusPoint,
    addFocusPointsBatch,
    updateFocusPoint: updateFocusPointFn,
    removeFocusPoint,
    removeAllFocusPoints,
    setSelectedPoint: setSelectedPointId,
  }), [focusPoints, selectedPointId, activeFocusPoint, isLoading, error, loadFocusPoints, addFocusPoint, addFocusPointsBatch, updateFocusPointFn, removeFocusPoint, removeAllFocusPoints]);

  return (
    <FocusPointsContext.Provider value={value}>
      {children}
    </FocusPointsContext.Provider>
  );
}

export function useFocusPoints(): FocusPointsContextValue {
  const context = useContext(FocusPointsContext);
  if (context === undefined) {
    throw new Error('useFocusPoints must be used within a FocusPointsProvider');
  }
  return context;
}

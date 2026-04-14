import React, { useMemo } from 'react';
import { useFocusPoints } from '../../contexts/FocusPointsContext';
import { useVideo } from '../../contexts/VideoContext';
import { Trash2, MapPin, Clock, Maximize2 } from 'lucide-react';

interface FocusPointEditorProps {
  selectedPointId: string | null;
  onClose: () => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function FocusPointEditor({ selectedPointId, onClose }: FocusPointEditorProps) {
  const { focusPoints, updateFocusPoint, removeFocusPoint } = useFocusPoints();
  const { setCurrentTime, duration } = useVideo();

  const selectedPoint = useMemo(
    () => focusPoints.find(fp => fp.id === selectedPointId) || null,
    [focusPoints, selectedPointId]
  );

  if (!selectedPoint) return null;

  const handleUpdate = (field: string, value: number | string) => {
    updateFocusPoint(selectedPoint.id, { [field]: value });
  };

  const handleDelete = async () => {
    await removeFocusPoint(selectedPoint.id);
    onClose();
  };

  const jumpToPoint = () => {
    setCurrentTime(selectedPoint.time_start);
  };

  return (
    <div className="bg-black-card border-2 border-red-hot p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-red-hot uppercase tracking-wide">Edit Focus Point</h3>
        <button
          onClick={onClose}
          className="text-white-dim hover:text-white-full text-xs uppercase tracking-wide"
        >
          Done
        </button>
      </div>

      {/* Source badge + description */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 ${
          selectedPoint.source === 'ai_detection'
            ? 'bg-orange-accent text-white'
            : 'bg-white-dim text-black'
        }`}>
          {selectedPoint.source === 'ai_detection' ? 'AI' : 'Manual'}
        </span>
        <input
          type="text"
          value={selectedPoint.description}
          onChange={(e) => handleUpdate('description', e.target.value)}
          className="flex-1 bg-black-deep border border-border-subtle text-white-full px-2 py-1 text-sm"
          placeholder="Description"
        />
      </div>

      {/* Time Range */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <Clock className="w-3 h-3 text-orange-accent" />
          <span className="text-xs text-white-dim uppercase tracking-wide">Time Range</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-white-dim uppercase">Start</label>
            <input
              type="number"
              min={0}
              max={selectedPoint.time_end - 0.1}
              step={0.1}
              value={selectedPoint.time_start.toFixed(1)}
              onChange={(e) => handleUpdate('time_start', parseFloat(e.target.value))}
              className="w-full bg-black-deep border border-border-subtle text-white-full px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="text-[10px] text-white-dim uppercase">End</label>
            <input
              type="number"
              min={selectedPoint.time_start + 0.1}
              max={duration}
              step={0.1}
              value={selectedPoint.time_end.toFixed(1)}
              onChange={(e) => handleUpdate('time_end', parseFloat(e.target.value))}
              className="w-full bg-black-deep border border-border-subtle text-white-full px-2 py-1 text-sm"
            />
          </div>
        </div>
        <p className="text-[10px] text-white-dim mt-1">
          Duration: {formatTime(selectedPoint.time_end - selectedPoint.time_start)}
        </p>
      </div>

      {/* Position */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <MapPin className="w-3 h-3 text-orange-accent" />
          <span className="text-xs text-white-dim uppercase tracking-wide">Position</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-white-dim uppercase">X (%)</label>
            <input
              type="range"
              min={0}
              max={100 - selectedPoint.width}
              step={0.5}
              value={selectedPoint.x}
              onChange={(e) => handleUpdate('x', parseFloat(e.target.value))}
              className="w-full accent-red-hot"
            />
            <span className="text-[10px] text-white-dim">{selectedPoint.x.toFixed(1)}%</span>
          </div>
          <div>
            <label className="text-[10px] text-white-dim uppercase">Y (%)</label>
            <input
              type="range"
              min={0}
              max={100 - selectedPoint.height}
              step={0.5}
              value={selectedPoint.y}
              onChange={(e) => handleUpdate('y', parseFloat(e.target.value))}
              className="w-full accent-red-hot"
            />
            <span className="text-[10px] text-white-dim">{selectedPoint.y.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Size */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Maximize2 className="w-3 h-3 text-orange-accent" />
          <span className="text-xs text-white-dim uppercase tracking-wide">Size</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-white-dim uppercase">Width (%)</label>
            <input
              type="range"
              min={5}
              max={100}
              step={0.5}
              value={selectedPoint.width}
              onChange={(e) => handleUpdate('width', parseFloat(e.target.value))}
              className="w-full accent-red-hot"
            />
            <span className="text-[10px] text-white-dim">{selectedPoint.width.toFixed(1)}%</span>
          </div>
          <div>
            <label className="text-[10px] text-white-dim uppercase">Height (%)</label>
            <input
              type="range"
              min={5}
              max={100}
              step={0.5}
              value={selectedPoint.height}
              onChange={(e) => handleUpdate('height', parseFloat(e.target.value))}
              className="w-full accent-red-hot"
            />
            <span className="text-[10px] text-white-dim">{selectedPoint.height.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={jumpToPoint}
          className="flex-1 px-3 py-2 text-xs font-bold uppercase tracking-wide text-orange-accent border border-orange-accent hover:bg-orange-accent hover:text-white transition-all"
        >
          Jump to Point
        </button>
        <button
          onClick={handleDelete}
          className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-red-hot border border-red-hot hover:bg-red-hot hover:text-white transition-all"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

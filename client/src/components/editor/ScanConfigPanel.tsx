import React, { useState } from 'react';
import { useScan } from '../../contexts/ScanContext';

export default function ScanConfigPanel() {
  const { scanOptions, setScanOptions } = useScan();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mb-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="text-xs text-white-dim uppercase tracking-wide hover:text-orange-accent transition-colors"
      >
        {isOpen ? '▾ Hide' : '▸ Show'} Scan Settings
      </button>

      {isOpen && (
        <div className="mt-2 p-3 bg-black-deep border border-border-subtle">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white-dim uppercase tracking-wide mb-1">
                Interval (seconds)
              </label>
              <input
                type="number"
                min={0.5}
                max={5}
                step={0.5}
                value={scanOptions.interval || 1}
                onChange={e => setScanOptions({ interval: parseFloat(e.target.value) })}
                className="w-full bg-black-card border border-border-subtle text-white-full px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-white-dim uppercase tracking-wide mb-1">
                Min Confidence
              </label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={scanOptions.min_score || 0.5}
                onChange={e => setScanOptions({ min_score: parseFloat(e.target.value) })}
                className="w-full accent-red-hot"
              />
              <span className="text-xs text-white-dim">{((scanOptions.min_score || 0.5) * 100).toFixed(0)}%</span>
            </div>
            <div>
              <label className="block text-xs text-white-dim uppercase tracking-wide mb-1">
                Similarity Threshold
              </label>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={scanOptions.similarity_threshold || 0.3}
                onChange={e => setScanOptions({ similarity_threshold: parseFloat(e.target.value) })}
                className="w-full accent-red-hot"
              />
              <span className="text-xs text-white-dim">{((scanOptions.similarity_threshold || 0.3) * 100).toFixed(0)}%</span>
            </div>
            <div>
              <label className="block text-xs text-white-dim uppercase tracking-wide mb-1">
                Min Detections
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={scanOptions.min_detections || 3}
                onChange={e => setScanOptions({ min_detections: parseInt(e.target.value) })}
                className="w-full bg-black-card border border-border-subtle text-white-full px-2 py-1 text-sm"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

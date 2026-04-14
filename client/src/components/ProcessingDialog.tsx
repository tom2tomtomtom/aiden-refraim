import { X } from 'lucide-react';
import { useState } from 'react';

const PLATFORM_OPTIONS = [
  {
    platform: 'instagram',
    formats: [
      { id: 'instagram-story', label: 'Story/Reel (9:16)' },
      { id: 'instagram-feed-square', label: 'Feed Square (1:1)' },
      { id: 'instagram-feed-portrait', label: 'Feed Portrait (4:5)' },
    ],
  },
  {
    platform: 'facebook',
    formats: [
      { id: 'facebook-story', label: 'Story (9:16)' },
      { id: 'facebook-feed', label: 'Feed (1:1)' },
    ],
  },
  {
    platform: 'tiktok',
    formats: [
      { id: 'tiktok', label: 'TikTok Video (9:16)' },
    ],
  },
  {
    platform: 'youtube',
    formats: [
      { id: 'youtube-shorts', label: 'Shorts (9:16)' },
      { id: 'youtube-main', label: 'Main (16:9)' },
    ],
  },
];

interface ProcessingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProcess: (formats: string[]) => void;
}

export function ProcessingDialog({
  open,
  onOpenChange,
  onProcess,
}: ProcessingDialogProps) {
  const [selectedFormats, setSelectedFormats] = useState<string[]>([]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onProcess(selectedFormats);
    onOpenChange(false);
  };

  const toggleFormat = (formatId: string) => {
    setSelectedFormats((current) =>
      current.includes(formatId)
        ? current.filter((id) => id !== formatId)
        : [...current, formatId]
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-black-card border-2 border-border-subtle w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-4 border-b border-border-subtle">
          <h2 className="text-sm font-bold text-red-hot uppercase tracking-wide">
            Process Video
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="text-white-dim hover:text-red-hot transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-4 space-y-4">
            <p className="text-xs text-white-dim">
              Select the formats you want to process this video for:
            </p>

            <div className="space-y-4">
              {PLATFORM_OPTIONS.map((platform) => (
                <div key={platform.platform} className="space-y-2">
                  <h3 className="text-xs font-bold text-orange-accent uppercase tracking-wide">
                    {platform.platform}
                  </h3>
                  <div className="space-y-2">
                    {platform.formats.map((format) => (
                      <label
                        key={format.id}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFormats.includes(format.id)}
                          onChange={() => toggleFormat(format.id)}
                          className="h-4 w-4 accent-red-hot cursor-pointer"
                        />
                        <span className="text-sm text-white-muted">{format.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 p-4 border-t border-border-subtle">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="px-4 py-2 text-xs font-bold text-white-muted uppercase tracking-wide border border-border-subtle hover:border-white-dim transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={selectedFormats.length === 0}
              className="px-4 py-2 text-xs font-bold text-white uppercase tracking-wide bg-red-hot border-2 border-red-hot hover:bg-red-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Start Processing
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

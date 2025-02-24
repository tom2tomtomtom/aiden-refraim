import * as Dialog from '@radix-ui/react-dialog';
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl w-full max-w-md">
          <div className="flex items-center justify-between p-4 border-b">
            <Dialog.Title className="text-lg font-medium">
              Process Video
            </Dialog.Title>
            <Dialog.Close className="p-2 hover:bg-gray-100 rounded-full">
              <X className="w-5 h-5" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="p-4 space-y-4">
              <p className="text-sm text-gray-600">
                Select the formats you want to process this video for:
              </p>

              <div className="space-y-4">
                {PLATFORM_OPTIONS.map((platform) => (
                  <div key={platform.platform} className="space-y-2">
                    <h3 className="font-medium capitalize">
                      {platform.platform}
                    </h3>
                    <div className="space-y-2">
                      {platform.formats.map((format) => (
                        <label
                          key={format.id}
                          className="flex items-center space-x-2"
                        >
                          <input
                            type="checkbox"
                            checked={selectedFormats.includes(format.id)}
                            onChange={() => toggleFormat(format.id)}
                            className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                          />
                          <span className="text-sm">{format.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t bg-gray-50">
              <Dialog.Close className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md">
                Cancel
              </Dialog.Close>
              <button
                type="submit"
                disabled={selectedFormats.length === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-500 hover:bg-blue-600 rounded-md disabled:bg-blue-300"
              >
                Start Processing
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

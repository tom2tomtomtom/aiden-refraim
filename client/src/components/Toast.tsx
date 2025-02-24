import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';

interface ToastProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  type?: 'success' | 'error' | 'info';
}

export function Toast({
  open,
  onOpenChange,
  title,
  description,
  type = 'info',
}: ToastProps) {
  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-green-50 border-green-500 text-green-800';
      case 'error':
        return 'bg-red-50 border-red-500 text-red-800';
      default:
        return 'bg-blue-50 border-blue-500 text-blue-800';
    }
  };

  return (
    <ToastPrimitive.Provider>
      <ToastPrimitive.Root
        open={open}
        onOpenChange={onOpenChange}
        className={`fixed bottom-4 right-4 p-4 rounded-lg border-l-4 shadow-lg ${getTypeStyles()}`}
      >
        <div className="flex justify-between items-start gap-4">
          <div>
            <ToastPrimitive.Title className="font-medium mb-1">
              {title}
            </ToastPrimitive.Title>
            {description && (
              <ToastPrimitive.Description className="text-sm opacity-90">
                {description}
              </ToastPrimitive.Description>
            )}
          </div>
          <ToastPrimitive.Close className="rounded-full p-1 hover:bg-black/5">
            <X className="w-4 h-4" />
          </ToastPrimitive.Close>
        </div>
      </ToastPrimitive.Root>
      <ToastPrimitive.Viewport />
    </ToastPrimitive.Provider>
  );
}

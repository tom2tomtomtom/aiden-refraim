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
        return 'border-green-500';
      case 'error':
        return 'border-red-hot';
      default:
        return 'border-orange-accent';
    }
  };

  const getTitleColor = () => {
    switch (type) {
      case 'success':
        return 'text-green-500';
      case 'error':
        return 'text-red-hot';
      default:
        return 'text-orange-accent';
    }
  };

  return (
    <ToastPrimitive.Provider>
      <ToastPrimitive.Root
        open={open}
        onOpenChange={onOpenChange}
        className={`fixed bottom-4 right-4 p-4 bg-black-card border-l-4 shadow-lg ${getTypeStyles()}`}
      >
        <div className="flex justify-between items-start gap-4">
          <div>
            <ToastPrimitive.Title className={`font-bold text-xs uppercase tracking-wide mb-1 ${getTitleColor()}`}>
              {title}
            </ToastPrimitive.Title>
            {description && (
              <ToastPrimitive.Description className="text-sm text-white-muted">
                {description}
              </ToastPrimitive.Description>
            )}
          </div>
          <ToastPrimitive.Close className="text-white-dim hover:text-white-full transition-colors p-1">
            <X className="w-4 h-4" />
          </ToastPrimitive.Close>
        </div>
      </ToastPrimitive.Root>
      <ToastPrimitive.Viewport />
    </ToastPrimitive.Provider>
  );
}

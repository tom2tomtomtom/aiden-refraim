interface FormErrorProps {
  message: string | null;
  className?: string;
}

/**
 * Shared error announcement. Copied from Gateway's components/ui/form-error.tsx
 * with the palette swapped for refrAIm's; the behaviour is deliberately
 * identical across the estate.
 *
 * `role="alert"` puts the message in the accessibility tree's live region the
 * moment it appears, so a screen-reader user hears it without having to hunt
 * for it. Before this the client had no role="alert", aria-live or aria-atomic
 * anywhere: every failure was visible and silent.
 */
export function FormError({ message, className }: FormErrorProps) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className={
        className ?? 'bg-red-hot/10 border border-red-hot text-red-hot px-4 py-3 text-sm'
      }
    >
      {message}
    </div>
  );
}

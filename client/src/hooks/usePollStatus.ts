import { useState, useEffect, useRef, useCallback } from 'react';

interface PollResult<T> {
  data: T | null;
  isPolling: boolean;
  error: string | null;
  stop: () => void;
}

export function usePollStatus<T>(
  pollFn: () => Promise<{ done: boolean; data: T }>,
  intervalMs: number,
  enabled: boolean
): PollResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPolling(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }

    stoppedRef.current = false;
    setIsPolling(true);
    setError(null);

    const poll = async () => {
      if (stoppedRef.current) return;
      try {
        const result = await pollFn();
        if (stoppedRef.current) return;
        setData(result.data);
        if (result.done) {
          stop();
        }
      } catch (err) {
        if (stoppedRef.current) return;
        setError(err instanceof Error ? err.message : String(err));
        stop();
      }
    };

    // Initial poll immediately
    poll();

    // Then poll on interval
    intervalRef.current = setInterval(poll, intervalMs);

    return () => {
      stop();
    };
  }, [enabled, intervalMs, pollFn, stop]);

  return { data, isPolling, error, stop };
}

export default usePollStatus;

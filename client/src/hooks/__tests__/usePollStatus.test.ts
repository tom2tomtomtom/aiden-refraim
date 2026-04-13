import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePollStatus } from '../usePollStatus';

describe('usePollStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not poll when enabled is false', () => {
    const pollFn = vi.fn();
    const { result } = renderHook(() => usePollStatus(pollFn, 1000, false));

    expect(pollFn).not.toHaveBeenCalled();
    expect(result.current.isPolling).toBe(false);
  });

  it('calls pollFn immediately when enabled', async () => {
    const pollFn = vi.fn().mockResolvedValue({ done: false, data: 'hello' });
    const { result } = renderHook(() => usePollStatus(pollFn, 1000, true));

    // The initial call happens synchronously in the effect
    expect(pollFn).toHaveBeenCalledTimes(1);

    // Flush the promise from the initial call
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.isPolling).toBe(true);
    expect(result.current.data).toBe('hello');
  });

  it('stops polling when pollFn returns done: true', async () => {
    const pollFn = vi.fn().mockResolvedValue({ done: true, data: 'finished' });
    const { result } = renderHook(() => usePollStatus(pollFn, 1000, true));

    // Flush the immediate poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.data).toBe('finished');
    expect(result.current.isPolling).toBe(false);

    // Advance time and confirm no more calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    // Only the initial call should have been made (interval may fire but stoppedRef prevents execution)
    expect(pollFn).toHaveBeenCalledTimes(1);
  });

  it('sets error when pollFn throws', async () => {
    const pollFn = vi.fn().mockRejectedValue(new Error('network failure'));
    const { result } = renderHook(() => usePollStatus(pollFn, 1000, true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toBe('network failure');
    expect(result.current.isPolling).toBe(false);
  });

  it('cleans up interval on unmount', async () => {
    const pollFn = vi.fn().mockResolvedValue({ done: false, data: 'working' });
    const { unmount } = renderHook(() => usePollStatus(pollFn, 1000, true));

    // Flush the immediate poll
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callCountBeforeUnmount = pollFn.mock.calls.length;
    unmount();

    // Advance time after unmount
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(pollFn.mock.calls.length).toBe(callCountBeforeUnmount);
  });
});

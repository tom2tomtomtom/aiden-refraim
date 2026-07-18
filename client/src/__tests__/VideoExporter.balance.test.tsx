import { act, fireEvent, render, screen } from '@testing-library/react';
import VideoExporter from '../components/video/VideoExporter';

const mocks = vi.hoisted(() => ({
  api: {
    getCurrentPlan: vi.fn(),
    getVideo: vi.fn(),
    processVideo: vi.fn(),
    getProcessingStatus: vi.fn(),
    createCheckout: vi.fn(),
    createPortalSession: vi.fn(),
    getOutputDownloadUrl: vi.fn(),
  },
}));

vi.mock('../contexts/VideoContext', () => ({
  useVideo: () => ({ videoId: 'video-1' }),
}));

vi.mock('../contexts/FocusPointsContext', () => ({
  useFocusPoints: () => ({ focusPoints: [] }),
}));

vi.mock('../contexts/ApiContext', () => ({
  useApi: () => ({ api: mocks.api }),
}));

describe('VideoExporter balance refresh event', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.api.getCurrentPlan.mockResolvedValue({
      plan: 'free',
      exports_this_month: 3,
      exports_limit: 3,
      exports_remaining: 0,
      next_export: { path: 'gateway_tokens', token_cost: 2 },
    });
    mocks.api.getVideo.mockResolvedValue({ platform_outputs: null });
    mocks.api.processVideo.mockResolvedValue({ id: 'job-1' });
    mocks.api.getProcessingStatus.mockResolvedValue({
      status: 'uploaded',
      progress: 0,
      platforms: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes a balance refresh only after a successful output reaches terminal state', async () => {
    const onBalanceRefresh = vi.fn();
    window.addEventListener('aiden:balance-refresh', onBalanceRefresh);
    mocks.api.getProcessingStatus.mockResolvedValue({
      status: 'completed',
      platforms: {
        'instagram-story': {
          status: 'complete',
          progress: 100,
          url: 'https://signed.example/story.mp4',
        },
      },
    });

    const view = render(<VideoExporter />);
    fireEvent.click(screen.getByRole('button', { name: /Export 1 Platform/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(onBalanceRefresh).toHaveBeenCalledTimes(1);
    window.removeEventListener('aiden:balance-refresh', onBalanceRefresh);
    view.unmount();
  });

  it('does not publish a balance refresh when every output failed', async () => {
    const onBalanceRefresh = vi.fn();
    window.addEventListener('aiden:balance-refresh', onBalanceRefresh);
    mocks.api.getProcessingStatus.mockResolvedValue({
      status: 'failed',
      platforms: {
        'instagram-story': { status: 'error', progress: 100, error: 'Failed' },
      },
    });

    const view = render(<VideoExporter />);
    fireEvent.click(screen.getByRole('button', { name: /Export 1 Platform/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(onBalanceRefresh).not.toHaveBeenCalled();
    window.removeEventListener('aiden:balance-refresh', onBalanceRefresh);
    view.unmount();
  });

  it('publishes a balance refresh when failed-export compensation restores tokens', async () => {
    const onBalanceRefresh = vi.fn();
    window.addEventListener('aiden:balance-refresh', onBalanceRefresh);
    mocks.api.getProcessingStatus.mockResolvedValue({
      status: 'failed',
      progress: 100,
      platforms: {},
      jobId: 'job-1',
      balanceChanged: true,
      error: 'This export did not complete. You were not charged. Please retry.',
    });

    const view = render(<VideoExporter />);
    fireEvent.click(screen.getByRole('button', { name: /Export 1 Platform/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(onBalanceRefresh).toHaveBeenCalledTimes(1);
    window.removeEventListener('aiden:balance-refresh', onBalanceRefresh);
    view.unmount();
  });

  it('resumes polling an active job after reload without starting a second export', async () => {
    mocks.api.getProcessingStatus
      .mockResolvedValueOnce({
        status: 'processing',
        progress: 40,
        platforms: {},
        jobId: 'job-1',
      })
      .mockResolvedValue({
        status: 'processing',
        progress: 50,
        platforms: {},
        jobId: 'job-1',
      });

    const view = render(<VideoExporter />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: 'Exporting...' })).toBeDisabled();
    expect(mocks.api.processVideo).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mocks.api.getProcessingStatus).toHaveBeenCalledTimes(2);
    view.unmount();
  });

  it('surfaces the current run failure returned during reload recovery', async () => {
    mocks.api.getProcessingStatus.mockResolvedValue({
      status: 'failed',
      progress: 100,
      platforms: {},
      jobId: 'job-1',
      error: 'This export did not complete. You were not charged. Please retry.',
    });

    const view = render(<VideoExporter />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/You were not charged/i)).toBeInTheDocument();
    expect(mocks.api.processVideo).not.toHaveBeenCalled();
    view.unmount();
  });
});

import { act, render, screen } from '@testing-library/react';
import AppNav from '../components/AppNav';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

describe('AppNav balance convergence', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('refreshes after a paid action event and when the user returns to the tab', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 20 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 18 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 16 }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppNav appName=".refrAIm" currentApp="refrAIm" />);
    expect(await screen.findByText('20 tokens')).toBeInTheDocument();

    window.dispatchEvent(new Event('aiden:balance-refresh'));
    expect(await screen.findByText('18 tokens')).toBeInTheDocument();

    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('16 tokens')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('ignores an older balance response that arrives after a newer refresh', async () => {
    let resolveOlder: ((value: unknown) => void) | undefined;
    const older = new Promise((resolve) => { resolveOlder = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 20 }) })
      .mockReturnValueOnce(older)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ balance: 16 }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AppNav appName=".refrAIm" currentApp="refrAIm" />);
    expect(await screen.findByText('20 tokens')).toBeInTheDocument();

    window.dispatchEvent(new Event('aiden:balance-refresh'));
    window.dispatchEvent(new Event('focus'));
    expect(await screen.findByText('16 tokens')).toBeInTheDocument();

    await act(async () => {
      resolveOlder?.({ ok: true, json: async () => ({ balance: 18 }) });
      await older;
    });
    expect(screen.queryByText('18 tokens')).not.toBeInTheDocument();
    expect(screen.getByText('16 tokens')).toBeInTheDocument();
  });
});

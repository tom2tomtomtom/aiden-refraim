import { useState, useCallback, useEffect, useRef } from 'react';
import { useVideo } from '../../contexts/VideoContext';
import { useFocusPoints } from '../../contexts/FocusPointsContext';
import { useApi } from '../../contexts/ApiContext';
import { OUTPUT_FORMATS, ExportQuality } from '../../types/video';
import type { ProcessingStatus } from '../../api';

interface PlanState {
  plan: string;
  exports_this_month: number;
  exports_limit: number; // -1 = unlimited
  exports_remaining: number | null; // null = unlimited
  // Which entitlement path the NEXT export uses (UXA F-010): allowance,
  // Gateway-token fallback, or blocked. Exactly one path is ever consumed.
  next_export?: {
    path: 'plan_quota' | 'gateway_tokens' | 'blocked';
    token_cost: number;
  };
}

export default function VideoExporter() {
  const { videoId } = useVideo();
  const { focusPoints } = useFocusPoints();
  const { api } = useApi();

  // Default to a single platform (Instagram Story / TikTok 9:16) rather
  // than all 8 selected. On the free tier, defaulting to all 8 would let
  // the user exhaust the monthly export quota in a single click.
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['instagram-story']);
  const [useLetterboxing, setUseLetterboxing] = useState(false);
  const [quality, setQuality] = useState<ExportQuality>('medium');
  const [isExporting, setIsExporting] = useState(false);
  const [isUpgrading, setIsUpgrading] = useState(false);
  const [exportProgress, setExportProgress] = useState<Record<string, { status: string; progress: number; url?: string; error?: string }>>({});
  const [aggregateProgress, setAggregateProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanState | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshPlan = useCallback(async () => {
    if (!api) return;
    try {
      const p = await api.getCurrentPlan() as unknown as PlanState;
      setPlan(p);
    } catch {
      // Non-fatal: counter just doesn't render. Server-side gate still enforces.
    }
  }, [api]);

  // Surface already-completed outputs (from this session or a prior export) so
  // the download links persist. The transient /status feed only exists during
  // an active export; the durable source of truth is video.platform_outputs.
  const hydrateOutputs = useCallback(async () => {
    if (!api || !videoId) return;
    try {
      const v = await api.getVideo(videoId);
      const outputs = v.platform_outputs;
      if (outputs && Object.keys(outputs).length > 0) {
        setExportProgress(prev => {
          const next = { ...prev };
          for (const [key, o] of Object.entries(outputs)) {
            // Don't overwrite a live 'complete' entry we already have.
            if (next[key]?.status !== 'complete') {
              next[key] = { status: o.status, progress: 100, url: o.url };
            }
          }
          return next;
        });
      }
    } catch {
      // Non-fatal: downloads just won't pre-populate.
    }
  }, [api, videoId]);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const applyProcessingStatus = useCallback((
    status: ProcessingStatus,
    notifyBalance = true,
  ): boolean => {
    const platforms = status.platforms || {};
    setExportProgress(prev => ({ ...prev, ...platforms }));
    setAggregateProgress(status.progress || 0);
    if (status.error) setError(status.error);

    const entries = Object.values(platforms);
    const allDone = entries.length > 0 && entries.every(
      p => p.status === 'complete' || p.status === 'error'
    );
    const normalizedStatus = status.status.toLowerCase();
    const terminal = allDone
      || normalizedStatus === 'completed'
      || normalizedStatus === 'complete'
      || normalizedStatus === 'failed'
      || normalizedStatus === 'error';
    if (!terminal) return false;

    stopPolling();
    setIsExporting(false);
    if (
      notifyBalance
      && (status.balanceChanged || entries.some(p => p.status === 'complete'))
    ) {
      window.dispatchEvent(new Event('aiden:balance-refresh'));
    }
    refreshPlan();
    hydrateOutputs();
    return true;
  }, [hydrateOutputs, refreshPlan, stopPolling]);

  const pollStatus = useCallback(async () => {
    if (!api || !videoId) return;
    try {
      const status = await api.getProcessingStatus(videoId);
      applyProcessingStatus(status);
    } catch {
      stopPolling();
      setIsExporting(false);
      setError('Failed to check processing status');
    }
  }, [api, videoId, applyProcessingStatus, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollIntervalRef.current = setInterval(() => {
      void pollStatus();
    }, 3000);
  }, [pollStatus, stopPolling]);

  useEffect(() => {
    refreshPlan();
    hydrateOutputs();
    let cancelled = false;

    const recoverActiveExport = async () => {
      if (!api || !videoId) return;
      try {
        const status = await api.getProcessingStatus(videoId);
        if (cancelled) return;
        applyProcessingStatus(status, false);
        if (status.status.toLowerCase() === 'processing') {
          setIsExporting(true);
          startPolling();
        }
      } catch {
        // Non-fatal when there is no current job. A new export still works.
      }
    };
    void recoverActiveExport();

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [api, videoId, refreshPlan, hydrateOutputs, applyProcessingStatus, startPolling, stopPolling]);

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platform) ? prev.filter(p => p !== platform) : [...prev, platform]
    );
  };

  const handleExport = useCallback(async () => {
    if (!api || !videoId || selectedPlatforms.length === 0) return;
    setIsExporting(true);
    setError(null);
    setExportProgress({});
    setAggregateProgress(0);

    try {
      await api.processVideo(videoId, {
        platforms: selectedPlatforms,
        letterbox: useLetterboxing,
        quality,
      });

      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
      setIsExporting(false);
      // Even on a 402 the server may have rolled back the reservation, or
      // may have charged it. Refresh either way so the banner reflects
      // the real remaining quota.
      refreshPlan();
    }
  }, [api, videoId, selectedPlatforms, useLetterboxing, quality, refreshPlan, startPolling]);

  const handleUpgrade = useCallback(async () => {
    if (!api || !plan) return;
    setIsUpgrading(true);
    setError(null);

    try {
      const { url } = plan.plan === 'free'
        ? await api.createCheckout('starter')
        : await api.createPortalSession();
      window.location.href = url;
    } catch {
      setError('Could not open billing. Please try again.');
      setIsUpgrading(false);
    }
  }, [api, plan]);

  const handleDownload = useCallback(async (platform: string) => {
    if (!api || !videoId) return;
    try {
      const { url } = await api.getOutputDownloadUrl(videoId, platform);
      window.open(url, '_blank');
    } catch {
      setError(`Failed to get download URL for ${platform}`);
    }
  }, [api, videoId]);

  const overallProgress = Object.values(exportProgress).length > 0
    ? Math.round(Object.values(exportProgress).reduce((sum, p) => sum + (p.progress || 0), 0) / Object.values(exportProgress).length)
    : aggregateProgress;

  const allowanceExhausted = plan != null && plan.exports_limit !== -1 && plan.exports_remaining !== null && plan.exports_remaining <= 0;
  // Tokens are a legitimate billing path once the allowance is used —
  // exporting is only blocked when NO path remains (UXA F-010).
  const tokenFallback = allowanceExhausted && plan?.next_export?.path === 'gateway_tokens';
  const quotaExhausted = allowanceExhausted && !tokenFallback;
  const tokenCostPerExport = plan?.next_export?.token_cost ?? 2;

  return (
    <div className="bg-black-card p-6 border-2 border-border-subtle">
      <h2 className="text-xl font-bold text-red-hot uppercase mb-4">Export Options</h2>

      {plan && (
        <div className={`mb-4 p-3 border-2 ${quotaExhausted ? 'border-red-hot bg-black-deep' : 'border-border-subtle bg-black-deep'}`}>
          <p className="text-xs font-bold uppercase tracking-wide text-white-muted">
            Plan: <span className="text-orange-accent">{plan.plan}</span>
          </p>
          {plan.exports_limit === -1 ? (
            <p className="text-xs text-white-dim mt-1">Unlimited exports this month.</p>
          ) : (
            <p className="text-xs text-white-dim mt-1">
              <span className={quotaExhausted ? 'text-red-hot font-bold' : 'text-white-full font-bold'}>
                {plan.exports_remaining ?? Math.max(0, plan.exports_limit - plan.exports_this_month)}
              </span>{' '}
              of {plan.exports_limit} free exports left this month
              {!allowanceExhausted && (
                <span className="text-white-dim"> — this export uses 1, no tokens.</span>
              )}
              {tokenFallback && (
                <span className="text-orange-accent">
                  {' '}Free exports used — each export now costs {tokenCostPerExport} Gateway tokens.
                </span>
              )}
              {quotaExhausted && (
                <span className="text-red-hot"> Upgrade to export more.</span>
              )}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-black-card border-2 border-red-hot">
          <p className="text-red-hot text-xs font-bold uppercase">Error</p>
          <p className="text-white-muted text-xs mt-1">{error}</p>
        </div>
      )}

      {/* Platform selection */}
      <div className="mb-4">
        <label className="block text-xs font-bold text-white-muted uppercase tracking-wide mb-2">
          Select Platforms
        </label>
        <div className="space-y-2">
          {Object.entries(OUTPUT_FORMATS).map(([key, format]) => {
            const progress = exportProgress[key];
            return (
              <div key={key} className="flex items-center">
                <input
                  type="checkbox"
                  id={`platform-${key}`}
                  checked={selectedPlatforms.includes(key)}
                  onChange={() => togglePlatform(key)}
                  disabled={isExporting}
                  className="h-4 w-4 accent-red-hot cursor-pointer"
                />
                <label htmlFor={`platform-${key}`} className="ml-2 text-sm text-white-muted flex-1 cursor-pointer">
                  {format.name} <span className="text-white-dim">({format.aspectRatio})</span>
                </label>

                {progress && progress.progress > 0 && progress.status !== 'complete' && (
                  <div className="ml-4 w-24">
                    <div className="w-full h-2 bg-black-deep">
                      <div className="h-full bg-red-hot" style={{ width: `${progress.progress}%` }} />
                    </div>
                  </div>
                )}

                {progress?.status === 'complete' && (
                  <button
                    onClick={() => handleDownload(key)}
                    className="ml-4 text-xs text-orange-accent font-bold uppercase hover:text-red-hot transition-colors"
                  >
                    Download
                  </button>
                )}

                {progress?.status === 'error' && (
                  <span className="ml-4 text-xs text-red-hot">Failed</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Export style */}
      <div className="mb-4">
        <label className="block text-xs font-bold text-white-muted uppercase tracking-wide mb-2">
          Export Style
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div
            className={`border-2 p-3 cursor-pointer ${!useLetterboxing ? 'border-red-hot bg-black-deep' : 'border-border-subtle bg-black-card'}`}
            onClick={() => setUseLetterboxing(false)}
          >
            <p className="text-sm font-bold text-white-muted">Cropped</p>
            <p className="text-xs text-white-dim">Focus-point-aware crop, no black bars.</p>
            <p className="text-xs text-orange-accent mt-1">Recommended for social media</p>
          </div>
          <div
            className={`border-2 p-3 cursor-pointer ${useLetterboxing ? 'border-red-hot bg-black-deep' : 'border-border-subtle bg-black-card'}`}
            onClick={() => setUseLetterboxing(true)}
          >
            <p className="text-sm font-bold text-white-muted">Letterboxed</p>
            <p className="text-xs text-white-dim">Maintains focus area, adds black bars.</p>
            <p className="text-xs text-orange-accent mt-1">Preserves full frame</p>
          </div>
        </div>
      </div>

      {/* Quality */}
      <div className="mb-4">
        <label className="block text-xs font-bold text-white-muted uppercase tracking-wide mb-2">
          Quality
        </label>
        <div className="flex gap-2">
          {(['low', 'medium', 'high'] as ExportQuality[]).map(q => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-all ${
                quality === q
                  ? 'bg-red-hot text-white border-2 border-red-hot'
                  : 'bg-black-card text-white-muted border-2 border-border-subtle hover:border-red-hot'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Focus points info */}
      {focusPoints.length > 0 && (
        <p className="text-xs text-white-dim mb-4">
          Using {focusPoints.length} focus point{focusPoints.length !== 1 ? 's' : ''} for dynamic cropping
        </p>
      )}

      {/* Export status summary */}
      {!isExporting && Object.keys(exportProgress).length > 0 && (
        <div className="mb-4 p-3 bg-black-deep border border-border-subtle">
          {Object.values(exportProgress).every(p => p.status === 'complete') ? (
            <p className="text-xs text-green-500 font-bold uppercase">All exports complete. Use the download links above.</p>
          ) : Object.values(exportProgress).some(p => p.status === 'error') ? (
            <p className="text-xs text-red-hot font-bold uppercase">Some exports failed. Check individual status above.</p>
          ) : null}
        </div>
      )}

      {/* Export button */}
      {isExporting ? (
        <div>
          <div className="mb-2">
            <div className="w-full h-4 bg-black-deep">
              <div className="h-full bg-red-hot transition-all" style={{ width: `${overallProgress}%` }} />
            </div>
          </div>
          <p className="text-center text-sm text-white-muted mb-3">Exporting... {overallProgress}%</p>
          <button disabled className="w-full bg-red-hot/50 text-white px-6 py-3 text-sm font-bold uppercase tracking-wide border-2 border-red-hot/50 cursor-not-allowed">
            Exporting...
          </button>
        </div>
      ) : (
        <button
          onClick={quotaExhausted ? handleUpgrade : handleExport}
          disabled={selectedPlatforms.length === 0 || isUpgrading}
          className="w-full bg-red-hot text-white px-6 py-3 text-sm font-bold uppercase tracking-wide border-2 border-red-hot hover:bg-red-dim transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          title={quotaExhausted ? 'Monthly export limit reached. Upgrade your plan to keep exporting.' : undefined}
        >
          {isUpgrading
            ? 'Opening billing...'
            : quotaExhausted
            ? 'Upgrade to export more'
            : tokenFallback
            ? `Export ${selectedPlatforms.length} Platform${selectedPlatforms.length !== 1 ? 's' : ''} — ${tokenCostPerExport} tokens`
            : `Export ${selectedPlatforms.length} Platform${selectedPlatforms.length !== 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}

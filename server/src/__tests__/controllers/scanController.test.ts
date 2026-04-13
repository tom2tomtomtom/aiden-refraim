import { Request, Response } from 'express';
import { startScan, getScanStatus } from '../../controllers/scanController';

// Mock scanService
jest.mock('../../services/scanService', () => ({
  runScan: jest.fn().mockResolvedValue(undefined),
}));

// Chainable query builder
function createChainableMock(resolvedValue: { data: any; error: any }) {
  const chain: any = {};
  const methods = ['from', 'select', 'insert', 'update', 'delete', 'eq', 'order', 'single'];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest.fn().mockResolvedValue(resolvedValue);
  return chain;
}

let fromCallCount: number;
let fromMockImpl: (table: string) => any;

jest.mock('../../config/supabase', () => ({
  supabase: {
    from: jest.fn((...args: any[]) => fromMockImpl(args[0])),
  },
}));

function mockReq(overrides: any = {}): Request {
  const { user, ...rest } = overrides;
  return {
    params: {},
    body: {},
    user: user || { id: 'user-1' },
    ...rest,
  } as any;
}

function mockRes(): Response {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('scanController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fromCallCount = 0;
  });

  describe('startScan', () => {
    it('returns 404 for non-existent video', async () => {
      fromMockImpl = () => createChainableMock({ data: null, error: { message: 'not found' } });

      const req = mockReq({ params: { videoId: 'no-video' } });
      const res = mockRes();

      await startScan(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Video not found' });
    });

    it('returns 409 if scan already active', async () => {
      const videoChain = createChainableMock({ data: { id: 'vid-1', original_url: 'http://example.com/v.mp4' }, error: null });
      const activeScanChain = createChainableMock({ data: { id: 'scan-existing' }, error: null });

      fromMockImpl = () => {
        fromCallCount++;
        if (fromCallCount === 1) return videoChain;
        return activeScanChain;
      };

      const req = mockReq({ params: { videoId: 'vid-1' } });
      const res = mockRes();

      await startScan(req, res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'A scan is already in progress for this video' })
      );
    });

    it('returns 202 with scan_id on success', async () => {
      const videoChain = createChainableMock({ data: { id: 'vid-1', original_url: 'http://example.com/v.mp4' }, error: null });
      const noActiveScanChain = createChainableMock({ data: null, error: { code: 'PGRST116', message: 'no rows' } });
      const insertChain = createChainableMock({ data: { id: 'scan-new' }, error: null });

      fromMockImpl = () => {
        fromCallCount++;
        if (fromCallCount === 1) return videoChain;
        if (fromCallCount === 2) return noActiveScanChain;
        return insertChain;
      };

      const req = mockReq({
        params: { videoId: 'vid-1' },
        body: { interval: 2 },
      });
      const res = mockRes();

      await startScan(req, res);

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith({ scan_id: 'scan-new', status: 'scanning' });
    });

    it('clamps interval to valid range', async () => {
      const videoChain = createChainableMock({ data: { id: 'vid-1', original_url: 'http://example.com/v.mp4' }, error: null });
      const noActiveScanChain = createChainableMock({ data: null, error: { code: 'PGRST116', message: 'no rows' } });

      // Capture what gets inserted
      let insertedData: any = null;
      const insertChain: any = {};
      const chainMethods = ['select', 'eq', 'single'];
      for (const m of chainMethods) {
        insertChain[m] = jest.fn().mockReturnValue(insertChain);
      }
      insertChain.insert = jest.fn((data: any) => {
        insertedData = data;
        return insertChain;
      });
      insertChain.single = jest.fn().mockResolvedValue({ data: { id: 'scan-new' }, error: null });

      fromMockImpl = () => {
        fromCallCount++;
        if (fromCallCount === 1) return videoChain;
        if (fromCallCount === 2) return noActiveScanChain;
        return insertChain;
      };

      const req = mockReq({
        params: { videoId: 'vid-1' },
        body: { interval: 999 },  // should be clamped to 60
      });
      const res = mockRes();

      await startScan(req, res);

      expect(insertedData).toBeTruthy();
      expect(insertedData.scan_options.interval).toBe(60);
    });
  });

  describe('getScanStatus', () => {
    it('returns progress for active scan', async () => {
      const videoChain = createChainableMock({ data: { id: 'vid-1' }, error: null });
      const scanChain = createChainableMock({
        data: { id: 'scan-1', status: 'scanning', progress: 45, detected_subjects: null, error: null },
        error: null,
      });

      fromMockImpl = () => {
        fromCallCount++;
        if (fromCallCount === 1) return videoChain;
        return scanChain;
      };

      const req = mockReq({ params: { videoId: 'vid-1', scanId: 'scan-1' } });
      const res = mockRes();

      await getScanStatus(req, res);

      expect(res.json).toHaveBeenCalledWith({ status: 'scanning', progress: 45 });
    });

    it('returns subjects when completed', async () => {
      const subjects = [{ label: 'person', bbox: [10, 20, 30, 40] }];
      const videoChain = createChainableMock({ data: { id: 'vid-1' }, error: null });
      const scanChain = createChainableMock({
        data: { id: 'scan-1', status: 'completed', progress: 100, detected_subjects: subjects, error: null },
        error: null,
      });

      fromMockImpl = () => {
        fromCallCount++;
        if (fromCallCount === 1) return videoChain;
        return scanChain;
      };

      const req = mockReq({ params: { videoId: 'vid-1', scanId: 'scan-1' } });
      const res = mockRes();

      await getScanStatus(req, res);

      expect(res.json).toHaveBeenCalledWith({
        status: 'completed',
        progress: 100,
        subjects,
      });
    });
  });
});

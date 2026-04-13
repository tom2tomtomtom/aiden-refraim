import { Request, Response } from 'express';
import { listFocusPoints, createFocusPoints, updateFocusPoint, deleteFocusPoint, deleteAllFocusPoints } from '../../controllers/focusPointController';

// Chainable query builder mock
function createChainableMock(resolvedValue: { data: any; error: any }) {
  const chain: any = {};
  const methods = ['from', 'select', 'insert', 'update', 'delete', 'eq', 'order', 'single'];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  // The last call in any chain should resolve
  chain.single = jest.fn().mockResolvedValue(resolvedValue);
  chain.order = jest.fn().mockResolvedValue(resolvedValue);
  chain.select = jest.fn().mockReturnValue(chain);
  chain.eq = jest.fn().mockReturnValue(chain);
  chain.insert = jest.fn().mockReturnValue(chain);
  chain.update = jest.fn().mockReturnValue(chain);
  chain.delete = jest.fn().mockReturnValue(chain);
  return chain;
}

let mockChain: any;

jest.mock('../../config/supabase', () => ({
  supabase: {
    from: jest.fn(() => mockChain),
  },
}));

function mockReq(overrides: Partial<Request> & { user?: { id: string } } = {}): Request {
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

describe('focusPointController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('listFocusPoints', () => {
    it('returns 404 for non-existent video', async () => {
      mockChain = createChainableMock({ data: null, error: { message: 'not found' } });
      const req = mockReq({ params: { videoId: 'no-such-video' } as any });
      const res = mockRes();

      await listFocusPoints(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Video not found' });
    });
  });

  describe('createFocusPoints', () => {
    it('rejects empty array', async () => {
      const req = mockReq({
        params: { videoId: 'vid-1' } as any,
        body: { focus_points: [] },
      });
      const res = mockRes();

      await createFocusPoints(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'focus_points array is required and must not be empty',
      });
    });

    it('rejects more than 100 items', async () => {
      const items = Array.from({ length: 101 }, () => ({}));
      const req = mockReq({
        params: { videoId: 'vid-1' } as any,
        body: { focus_points: items },
      });
      const res = mockRes();

      await createFocusPoints(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: 'Maximum 100 focus points per request' });
    });

    it('validates required fields (time_start must be number >= 0)', async () => {
      // Pass video ownership check
      mockChain = createChainableMock({ data: { id: 'vid-1' }, error: null });

      const req = mockReq({
        params: { videoId: 'vid-1' } as any,
        body: {
          focus_points: [
            { time_start: -1, time_end: 5, x: 10, y: 10, width: 20, height: 20, source: 'manual', description: 'test' },
          ],
        },
      });
      const res = mockRes();

      await createFocusPoints(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'focus_points[0].time_start must be a number >= 0',
      });
    });

    it('validates coordinate bounds (x + width <= 100)', async () => {
      mockChain = createChainableMock({ data: { id: 'vid-1' }, error: null });

      const req = mockReq({
        params: { videoId: 'vid-1' } as any,
        body: {
          focus_points: [
            { time_start: 0, time_end: 5, x: 80, y: 10, width: 30, height: 20, source: 'manual', description: 'test' },
          ],
        },
      });
      const res = mockRes();

      await createFocusPoints(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'focus_points[0]: x + width must be <= 100',
      });
    });

    it('validates time_end > time_start', async () => {
      mockChain = createChainableMock({ data: { id: 'vid-1' }, error: null });

      const req = mockReq({
        params: { videoId: 'vid-1' } as any,
        body: {
          focus_points: [
            { time_start: 10, time_end: 5, x: 10, y: 10, width: 20, height: 20, source: 'manual', description: 'test' },
          ],
        },
      });
      const res = mockRes();

      await createFocusPoints(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: 'focus_points[0].time_end must be a number greater than time_start',
      });
    });

    it('validates source is manual or ai_detection', async () => {
      mockChain = createChainableMock({ data: { id: 'vid-1' }, error: null });

      const req = mockReq({
        params: { videoId: 'vid-1' } as any,
        body: {
          focus_points: [
            { time_start: 0, time_end: 5, x: 10, y: 10, width: 20, height: 20, source: 'invalid', description: 'test' },
          ],
        },
      });
      const res = mockRes();

      await createFocusPoints(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        error: "focus_points[0].source must be 'manual' or 'ai_detection'",
      });
    });
  });

  describe('updateFocusPoint', () => {
    it('returns 404 for non-existent focus point', async () => {
      // First call: verifyVideoOwnership succeeds
      // Second call: update returns PGRST116
      let callCount = 0;
      const ownershipChain = createChainableMock({ data: { id: 'vid-1' }, error: null });
      const updateChain = createChainableMock({ data: null, error: { code: 'PGRST116', message: 'not found' } });

      const { supabase } = require('../../config/supabase');
      supabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return ownershipChain;
        return updateChain;
      });

      const req = mockReq({
        params: { videoId: 'vid-1', fpId: 'no-such-fp' } as any,
        body: { x: 50 },
      });
      const res = mockRes();

      await updateFocusPoint(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({ error: 'Focus point not found' });
    });
  });

  describe('deleteFocusPoint', () => {
    it('returns success with deleted id', async () => {
      let callCount = 0;
      const ownershipChain = createChainableMock({ data: { id: 'vid-1' }, error: null });
      const deleteChain = createChainableMock({ data: { id: 'fp-1' }, error: null });

      const { supabase } = require('../../config/supabase');
      supabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return ownershipChain;
        return deleteChain;
      });

      const req = mockReq({
        params: { videoId: 'vid-1', fpId: 'fp-1' } as any,
      });
      const res = mockRes();

      await deleteFocusPoint(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'Focus point deleted', id: 'fp-1' });
    });
  });

  describe('deleteAllFocusPoints', () => {
    it('returns count of deleted focus points', async () => {
      let callCount = 0;
      const ownershipChain = createChainableMock({ data: { id: 'vid-1' }, error: null });
      // deleteAll chain ends with .select() not .single(), so we resolve from select
      const deleteChain: any = {};
      const methods = ['from', 'delete', 'eq', 'select'];
      for (const m of methods) {
        deleteChain[m] = jest.fn().mockReturnValue(deleteChain);
      }
      deleteChain.select = jest.fn().mockResolvedValue({ data: [{ id: 'fp-1' }, { id: 'fp-2' }, { id: 'fp-3' }], error: null });

      const { supabase } = require('../../config/supabase');
      supabase.from.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return ownershipChain;
        return deleteChain;
      });

      const req = mockReq({
        params: { videoId: 'vid-1' } as any,
      });
      const res = mockRes();

      await deleteAllFocusPoints(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'All focus points deleted', count: 3 });
    });
  });
});

# Quick Wins

Fixes under 30 minutes that improve the health score.

## Immediate (< 5 min)

1. **npm audit fix** (+1 point)
   ```bash
   cd ~/refraim/server && npm audit fix
   cd ~/refraim/client && npm audit fix
   ```

2. **Remove unused progress variables** (+1 point)
   - server/src/services/videoProcessingService.ts lines 158, 167, 340, 349
   - These variables are computed but never used

3. **Validate CLIENT_URL on startup** (+1 point)
   - server/src/server.ts: add `if (!process.env.CLIENT_URL && process.env.NODE_ENV === 'production') throw new Error('CLIENT_URL required')`

## Short (< 30 min)

4. **Use AuthenticatedRequest in all controllers** (+2 points)
   - Replace remaining `(req as any).user` with `(req as AuthenticatedRequest).user` in:
     - server/src/controllers/focusPointController.ts (5 occurrences)
     - server/src/controllers/scanController.ts (2 occurrences)
     - server/src/routes/billingRoutes.ts (5 occurrences)
     - server/src/routes/videos.ts (2 occurrences)

5. **Install test framework** (+3 points toward testing)
   ```bash
   cd ~/refraim/server && npm install -D jest @types/jest ts-jest
   cd ~/refraim/client && npm install -D vitest @testing-library/react
   ```

6. **Make storage bucket private** (+1 security point)
   - server/src/services/storageService.ts: change `public: true` to `public: false`
   - Add signed URL generation for download endpoints

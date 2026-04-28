# refrAIm — Agent Guide

## 1. What this tool is

refrAIm (`refraim.aiden.services`) is a video aspect-ratio reformatting platform. Users upload a video once, and the server delivers optimised outputs in multiple social formats (9:16 Stories, 1:1 Square, 16:9 Landscape, 4:5 Portrait). Server-backed FFmpeg handles intelligent crop/scale/pan decisions. Client is browser-based upload + preview. Built for creators drowning in manual reformatting.

## 2. Ambition + soul

refrAIm is the quiet efficient post assistant who cuts what you need without asking twice. Its ambition is to free creatives from aspect-ratio hell, the endless manual reformatting that eats days of a campaign launch. Its soul is craft through reduction: doing one annoying thing so well that nobody thinks about it.

## 3. What makes it different

- vs Adobe Premiere / After Effects: refrAIm is a single-job tool. No timeline, no layers, no learning curve.
- vs browser-based JS reformatters: server-backed FFmpeg on Railway for real video quality.
- vs general video tools: laser-focused on aspect-ratio reformatting with AI-driven focus point detection + smart composition rules per platform (Instagram safe zones, TikTok framing, YouTube aspect locks).

## 4. Where it lives

- Domain: `refraim.aiden.services`
- Repo: `tom2tomtomtom/aiden-refraim`
- Local: `/Users/tommyhyde/aiden-refraim`
- Split: Express server (Node + FFmpeg) on Railway; React client (Vite + Supabase) on Netlify
- **Deploy server**: `railway up --detach` from `/Users/tommyhyde/aiden-refraim/`. **This is one of the few apps where `railway up` is correct.** Other hub apps use `git push`.
- **Deploy client**: Netlify auto-deploys on git push.

## 5. Tech stack

**Server:**
- Node.js 22 (LTS) + Express + TypeScript
- FFmpeg for video processing (installed in Dockerfile)
- Supabase Postgres (auth + storage)
- Stripe for standalone billing
- Anthropic Claude SDK (AI editor service)

**Client:**
- React 19 + Vite + TypeScript
- TailwindCSS + Radix UI + shadcn/ui
- React Query
- TensorFlow COCO-SSD for client-side object detection

**Database:** Supabase Postgres (unified AIDEN-Platform `bktujlufguenjytbdndn`). RLS on all tables. Custom `refraim` schema.

**Billing:** Stripe (standalone). Plans: free (3 exports/mo), starter ($29, 50/mo), pro ($79, unlimited), agency ($199, unlimited). NOT yet fully wired to Gateway tokens.

## 6. Auth: Gateway integration

**Current state (matches code as of 2026-04-28):** refrAIm uses Gateway SSO. Both server and client trust the Gateway-signed `aiden-gw` JWT cookie:

- **Client (`client/src/contexts/AuthContext.tsx`):** Calls `/api/me` on mount with `credentials: 'include'`; the cookie is HttpOnly so JS can't read it directly. Logged-out users are bounced to `${GATEWAY_URL}/login?next=…`. There is no Supabase login form anymore.
- **Server (`server/src/middleware/auth.ts`):** `requireAuth` extracts the `aiden-gw` cookie (or `Authorization: Bearer <jwt>` for programmatic clients) and verifies via `verifyGatewayJWT()`. No Supabase Auth call. JWT signing uses the shared HS256 `JWT_SECRET` across all hub apps.

(The earlier docs in this file claimed Supabase-direct auth — that referred to commit `b03620e` scaffolding which has since been completed. Code is now Gateway-SSO end to end.)

## 7. Token billing — DUAL BILLING SURFACE (RFM-A-009)

refrAIm currently has **two independent billing paths active in code** at `server/src/controllers/videoController.ts:processVideo`:

1. **Standalone Stripe plan quota** (always on): `reserveExport(user.id)` decrements the monthly Stripe-plan export count. Free = 3/mo, Starter $29 = 50/mo, Pro $79 + Agency $199 = unlimited.
2. **Gateway token deduction** (on iff `AIDEN_SERVICE_KEY` is set): `checkTokens()` + `deductTokens('refraim', 'video_export')` deducts 2 Gateway tokens per export.

**The dual-billing risk:** in any environment where `AIDEN_SERVICE_KEY` is set on the refrAIm Railway service, a user with an active Stripe subscription is charged BOTH ways for every export — once via their monthly Stripe plan, once via their Gateway token balance. There is no plan-aware short-circuit between the two.

**Required architecture decision (not yet made):**
- (a) **Stripe-only:** Unset `AIDEN_SERVICE_KEY` in refrAIm production env and remove the Gateway deduction code path. refrAIm stays on standalone billing.
- (b) **Gateway-only:** Replace the standalone Stripe plans with Gateway-token top-ups. Remove `reserveExport`/`refundExport` and the standalone-Stripe checkout routes.
- (c) **Plan-aware:** Free / Starter users charge via Gateway tokens; Pro / Agency subscribers skip the Gateway deduction entirely.
- (d) **Status-quo with explicit guard:** Document that the current production env intentionally leaves `AIDEN_SERVICE_KEY` unset on refrAIm; add a startup assertion that fails the deploy if both `AIDEN_SERVICE_KEY` and any Stripe plan are configured.

A safety guard is in place at `videoController.ts` (search for `RFM-A-009 GUARD`) that logs a loud warning when both billing paths would charge the same user, so the leak is at least observable until the decision is made.

`refraim.video_export = 2` is registered in Gateway's `TOKEN_COSTS` (`aiden-gateway/lib/tokens.ts`). The local Gateway client lives at `server/src/lib/gateway-tokens.ts`.

## 8. Critical files

**Server:**
- `server/src/server.ts` — entry point
- `server/src/app.ts` — Express app, routes, middleware
- `server/src/config/supabase.ts` — Supabase clients (auth + admin)
- `server/src/config/stripe.ts` — Stripe config + plan defs
- `server/src/services/ffmpegService.ts` — FFmpeg wrapping
- `server/src/services/videoProcessingService.ts` — main pipeline
- `server/src/services/aiEditorService.ts` — Claude API calls for AI editor
- `server/src/lib/gateway-tokens.ts` — Gateway token API client
- `server/src/controllers/videoController.ts` — upload + token checks
- `server/src/routes/videos.ts` — video CRUD
- `server/src/routes/billingRoutes.ts` — Stripe checkout + plans

**Client:**
- `client/src/App.tsx` — root router + auth gate
- `client/src/contexts/AuthContext.tsx` — Supabase session
- `client/src/components/VideoUpload.tsx` — drag-drop + multipart form
- `client/src/components/video/VideoExporter.tsx` — multi-format export UI
- `client/src/api.ts` — axios client, auth header wiring

## 9. Environment variables

**Server (Railway env):**
- `SUPABASE_URL` — Postgres project URL
- `SUPABASE_ANON_KEY` — public JWT key
- `SUPABASE_SERVICE_ROLE_KEY` — admin key (Railway only, not in `.env`)
- `SUPABASE_POSTGRES_URL` — raw pg:// connection string
- `PORT` — 3000 default
- `NODE_ENV` — production / development
- `STRIPE_SECRET_KEY` — `sk_live_*`
- `STRIPE_PRICE_ID_STARTER`, `STRIPE_PRICE_ID_PRO`, `STRIPE_PRICE_ID_AGENCY`
- `STRIPE_WEBHOOK_SECRET`
- `ANTHROPIC_API_KEY` — AI editor
- `AIDEN_SERVICE_KEY` — optional; enables Gateway token deductions alongside Stripe (see §7)
- `GATEWAY_URL` — default `https://www.aiden.services`
- `CLIENT_URL` — used for Stripe checkout redirects
- `SENTRY_DSN`

**Client (Vite build `.env.production`):**
- `VITE_API_URL` — `/api` (Netlify reverse-proxied)
- `VITE_SUPABASE_URL` — matches server
- `VITE_SUPABASE_ANON_KEY` — matches server

## 10. Deployment

**Server:** Railway
- Config: `railway.json` (builder: DOCKERFILE, healthcheckPath: `/api/health`)
- Dockerfile installs ffmpeg, builds client (Vite), builds server (tsc), runs `node server/dist/server.js`
- Deploy: `cd /Users/tommyhyde/aiden-refraim && railway up --detach`

**Client:** Netlify
- Auto-deploy on push to `main`
- Build: `npm run build` (tsc -b + vite build from `/client`)
- API reverse proxy: `/_netlify/functions/api` → `https://refraim.railway.app/api` (check `netlify.toml` or Netlify Functions UI)

**Netlify → Railway proxy:** configured via `netlify.toml` redirect `/_netlify/functions/api/* → https://refraim.railway.app/api/:splat`. If this breaks, exports fail silently on the client with no network error — check `netlify.toml` first.

## 11. Known gotchas + incidents

- **FFmpeg is CPU-heavy.** Large videos (>500MB) may time out. Small Railway dyno will be slow. Monitor `processing_jobs` table in Supabase.
- **Supabase auth flow hangs if keys wrong.** Client calls `supabase.auth.signIn()`, which redirects to Supabase-hosted login. If `SUPABASE_ANON_KEY` is wrong, auth hangs. Verify against Supabase dashboard.
- **Partial Gateway SSO bootstrap exists (commit b03620e)** but client still routes to Supabase login. Clarify with Tom if intentional or WIP.
- **`AIDEN_SERVICE_KEY` silent fallback:** if unset, token deductions silently succeed without reducing balance. Users may over-export. Consider warning log or graceful error.
- **Stripe webhook must be signed with `STRIPE_WEBHOOK_SECRET`.** If signature fails, events drop silently. Test via `stripe listen --forward-to localhost:3000/api/webhooks/stripe`.
- **RLS policies** require `auth.uid() = user_id`. Invalid session → empty video list (not an error). Check Supabase logs if exports disappear.

## 12. Testing

```bash
npm test       # server: jest, runs __tests__/ in server/src
npm test       # client: vitest, runs .test.ts[x] in client/src
```

No E2E tests wired. Playwright or Cypress suggested for upload + export flow.

## 13. DO NOT

- Don't set `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` in `.env` or version control. Railway only.
- Don't assume Gateway token deductions work without `AIDEN_SERVICE_KEY`. Add logging or error messages if critical.
- Don't merge client/server build outputs into a single bundle. Dockerfile does this for Railway, but dev scripts must keep them separate for HMR.
- Don't manually reset RLS policies without verifying `auth.uid()` matches logged-in user. Easy to lock yourself out.
- **Until Gateway migration is complete**: don't set `JWT_SECRET` differently from Gateway. Verify keys match before any migration work.

## 14. Related

- Vault: `~/Tom-Brain/AIDEN/AIDEN Hub.md`
- Memory: `reference-refraim-credentials.md`
- Gateway API: `/api/tokens/check` + `/api/tokens/deduct` (see `server/src/lib/gateway-tokens.ts`)

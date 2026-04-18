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
- Repo: `tom2tomtomtom/refraim`
- Local: `/Users/tommyhyde/refraim`
- Split: Express server (Node + FFmpeg) on Railway; React client (Vite + Supabase) on Netlify
- **Deploy server**: `railway up --detach` from `/Users/tommyhyde/refraim/`. **This is one of the few apps where `railway up` is correct.** Other hub apps use `git push`.
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

**Current status (2026-04-18):** refrAIm uses Supabase auth directly, NOT Gateway SSO. Client login routes to Supabase login page (`client/src/App.tsx`). Server validates JWT via Supabase authClient.

**Billing is standalone Stripe, NOT deducted from Gateway token balance** — by design for now, may change later.

Partial work: commit b03620e "Add Gateway SSO bootstrap for .aiden.services domain" (~2 months old) landed some scaffolding but the client still routes to Supabase. **[TODO: confirm with Tom whether full Gateway migration is planned.]**

## 7. Token billing

[TODO: verify] `refraim.video_export = 2` exists in Gateway's TOKEN_COSTS. The server (`server/src/lib/gateway-tokens.ts`) does call `checkTokens()` + `deductTokens()` from `videoController.ts`, BUT requires `AIDEN_SERVICE_KEY` to be set.

**Gotcha:** if `AIDEN_SERVICE_KEY` is missing, deduction silently succeeds (`{ success: true, remaining: 0 }`). This is a soft dependency: refrAIm works without it but tokens aren't deducted. **Clarify with Tom whether refrAIm should be billed via Gateway tokens or remain on standalone Stripe.**

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
- `AIDEN_SERVICE_KEY` — [TODO: verify] for Gateway token deductions
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
- Deploy: `cd /Users/tommyhyde/refraim && railway up --detach`

**Client:** Netlify
- Auto-deploy on push to `main`
- Build: `npm run build` (tsc -b + vite build from `/client`)
- API reverse proxy: `/_netlify/functions/api` → `https://refraim.railway.app/api` (check `netlify.toml` or Netlify Functions UI)

**[TODO: verify Netlify to Railway routing.]** If proxy breaks, exports fail silently.

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

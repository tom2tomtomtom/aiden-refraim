# Gateway operations required before deploying F-53

`POST /api/videos/:videoId/ai-focus-strategy` and `POST /api/videos/:videoId/review-crops`
call Claude Sonnet directly and were previously unmetered — no check, no deduction, no
cost event. F-53 puts both behind `checkTokens` / `deductTokens`.

**These two operations must exist in Gateway's `lib/tokens.ts` before this code reaches
production.** Gateway's client fail-closes on an unknown operation, so deploying refrAIm
first turns both features off rather than leaving them free. They cannot be added from
this repo.

| Product | Operation | Proposed tokens |
|---|---|---|
| `refraim` | `ai_focus_strategy` | 10 |
| `refraim` | `crop_review` | 8 |

## How those numbers were derived

Both prices are worst-case anchored against the caps the client can actually force, then
run through Gateway's own floor: `minimumTokensForProviderCost(usd)`, i.e.
`ceil(usd / (MIN_NET_USD_PER_TOKEN * (1 - 0.55)))` = `ceil(usd / 0.0225799)`.

Model is `claude-sonnet-4-6` at US$3/M input and US$15/M output. Anthropic resizes images
to roughly 1568px on the long edge, which is about 1,850 input tokens per frame.

**`ai_focus_strategy`** makes up to two calls: a text call (`max_tokens: 3000`) and, when
the client sends key frames, a vision call (`max_tokens: 1500`) carrying up to
`MAX_KEY_FRAMES = 24` images.

- text: ~3K in (US$0.009) + 3K out (US$0.045) = US$0.054
- vision: 24 x 1,850 = 44.4K in (US$0.133) + 1.5K out (US$0.023) = US$0.156
- total US$0.210 → 9.30 → **10 tokens**

**`crop_review`** makes one vision call (`max_tokens: 2000`) carrying up to
`MAX_CROPS = 24` images.

- 24 x 1,850 = 44.4K in (US$0.133) + ~1K text in (US$0.003) + 2K out (US$0.030) = US$0.166
- 7.35 → **8 tokens**

Both are `assumed`, not `measured` — no run of either has been costed in production. Add
them to `PROVIDER_COSTS` as `assumed` so `npm run check:cost-drift` can catch them, and
re-derive from `gateway.cost_events` once there is traffic. The estate's documented
failure here is `ads/video_fast`, which shipped against an assumed cost that was 9.4x
stale and lost US$2.87 a render.

## Known weakness: these are flat prices for a variable operation

A caller sending 2 key frames pays the same as one sending 24, and the 24-frame case is
what sets the price. This is the same shape as `colleague/ad_stills_render`, which was
priced for one image while the operation rendered twelve.

The fix is the one the estate already uses for `ads.ad_motion_second` and
`creative_pipeline.video_fast_second`: charge per image and have the caller send
`quantity`. That is deliberately **not** done here, because refrAIm's `deductTokens`
helper has no `quantity` parameter today and adding one is a wider change than F-53.
If per-image pricing is preferred, the derived unit is:

- per frame: US$0.00555 → **1 token per image**, plus a base charge for the text call

Pick one before either operation carries real volume.

## Behaviour this repo implements

Three states, in `server/src/lib/ai-metering.ts`:

| `ANTHROPIC_API_KEY` | `AIDEN_SERVICE_KEY` | Result |
|---|---|---|
| absent | any | Free rule-based fallback. Nothing paid runs, nothing is charged. |
| present | absent | Free rule-based fallback, with a warning. Spending provider credit that cannot be billed back is the outcome the gate exists to prevent. |
| present | present | `checkTokens` → provider call → `deductTokens` with a per-request UUID. |

A 402 is returned before the provider is called when the balance is short, and again if
the deduction cannot be settled after a successful call — the result is withheld rather
than served free. Settlement carries a `requestId`, so a replayed settlement deducts once.

Unlike exports, these are charged to Stripe subscribers as well as free users: the plan
quota counts exports per month and has no notion of AI suggestions. If AI suggestions
should be included in paid plans, that gate belongs alongside the existing
`billingPath === 'gateway_tokens'` branch in `videoController.processVideo`.

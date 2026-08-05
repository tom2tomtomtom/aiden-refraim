# refrAIm Audit Release Benchmark

Approved: 5 August 2026

## Required real receipts

1. The owner-approved source-duration cap is explicitly set and tested against
   existing assets above and below the boundary.
2. Unsupported or unreadable media is rejected before storage and database
   writes with safe user copy.
3. Export failure releases its active slot, persists failure, and cannot appear
   complete.
4. Paid AI work creates the correct Gateway transaction and matching provider
   cost event.
5. Existing library content affected by the cap is enumerated or recorded as
   `COULD NOT VERIFY` before merge.

## Receipt format

Record the production SHA, action, visible result, export rows, Gateway
transaction and request IDs, provider cost event, Railway or Sentry result, and
an evidence artifact. Mark `COULD NOT VERIFY` when unavailable.

The current highest-evidence reference is
`/Users/tommyhyde/aiden-diagnosis/reports/phase3-authenticated-tests.md`.

## Stop conditions

- Existing approved media unexpectedly becomes unexportable.
- A failed export retains a permanent active slot or appears complete.
- Paid provider work has no matching ledger or cost lineage.

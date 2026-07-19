# refrAIm quota migration rollout

The migration must be applied before the application commit is deployed. The
currently deployed worker updates jobs by `video_id`, so it is not safe to let
an old worker overlap recovery performed by the new application.

## 1. Run the disposable PostgreSQL smoke test

Point `REFRAIM_PG_TEST_URL` at a disposable PostgreSQL database. The test drops
and recreates its `refraim` schema.

```sh
cd server
REFRAIM_PG_TEST_URL=postgresql://localhost:55432/postgres \
  npm test -- --runInBand src/__tests__/integration/refraimQuotaMigration.postgres.test.ts
```

The smoke test applies the checked-in migration and verifies:

- both RPCs are schema-local `SECURITY INVOKER` functions;
- `anon` and `authenticated` cannot execute them while `service_role` can;
- two concurrent stale-period reservations persist counters `1` and `2`;
- the reservation receipt, rather than job creation time, selects the refund period;
- recovery replay does not refund twice.

## 2. Quiesce and drain the old worker

Block new `POST /api/videos/:id/process` requests at ingress while leaving the
current service running so existing FFmpeg work can finish. Do not use an app
environment flag that the old deployment does not understand.

Run this read-only gate against the unified Supabase database until both counts
are zero:

```sql
SELECT count(*) AS nonterminal_jobs
FROM refraim.processing_jobs
WHERE lower(status) NOT IN (
  'completed',
  'complete',
  'failed',
  'error',
  'failed_compensated',
  'failed_allowance_refunded'
);

SELECT count(*) AS active_video_claims
FROM refraim.videos
WHERE lower(status) = 'processing'
   OR processing_metadata ? 'active_job_id';
```

Stop the rollout if either count is nonzero. Investigate or let the old worker
finish. Do not run recovery while an old worker can still publish.

## 3. Verify CLI discovery, then apply only this migration

```sh
cd server
supabase link --project-ref bktujlufguenjytbdndn
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list only:

```text
20260718130500_crash_safe_refraim_quota.sql
```

Do not use `--include-all`. Stop if any historical migration is listed. Once
the dry run is exact:

```sh
supabase db push --linked
```

Verify privileges immediately:

```sql
SELECT
  has_function_privilege(
    'anon',
    'refraim.reserve_refraim_export(uuid,uuid,integer)',
    'EXECUTE'
  ) AS anon_reserve,
  has_function_privilege(
    'authenticated',
    'refraim.reserve_refraim_export(uuid,uuid,integer)',
    'EXECUTE'
  ) AS authenticated_reserve,
  has_function_privilege(
    'service_role',
    'refraim.reserve_refraim_export(uuid,uuid,integer)',
    'EXECUTE'
  ) AS service_reserve,
  has_function_privilege(
    'anon',
    'refraim.recover_refraim_plan_quota_export(uuid,uuid,uuid,boolean)',
    'EXECUTE'
  ) AS anon_recover,
  has_function_privilege(
    'authenticated',
    'refraim.recover_refraim_plan_quota_export(uuid,uuid,uuid,boolean)',
    'EXECUTE'
  ) AS authenticated_recover,
  has_function_privilege(
    'service_role',
    'refraim.recover_refraim_plan_quota_export(uuid,uuid,uuid,boolean)',
    'EXECUTE'
  ) AS service_recover;
```

Expected values are `false, false, true, false, false, true`.

## 4. Deploy, prove the old worker is gone, then canary

Deploy the application only after the migration and privilege checks pass:

```sh
railway status --json
railway up --detach
railway deployment list --limit 5 --json
```

Confirm the new deployment is healthy and no prior deployment remains active.
Keep ingress quiesced. Run one allowlisted canary export and verify all of the
following before reopening traffic:

- exactly one allowance reservation or one Gateway deduction;
- a successful output is visible before the job becomes terminal;
- a forced recovery restores the matching reservation at most once;
- the header balance converges after focus or visible return;
- the two drain queries still return zero after the canary finishes.

Resume normal ingress only after the canary and ledger reconciliation pass.

# refrAIm export concurrency rollout

`20260805150000_refraim_active_export_count.sql` **depends on
`20260805090000_refraim_export_leases.sql`** — it reads
`processing_jobs.lease_expires_at`. Apply the lease migration first.

Unlike the other wave-two migrations, the application side of this one is safe
to deploy against an unmigrated database: `checkExportConcurrency` fails open,
so a missing function logs and allows the export rather than blocking it. Apply
the migration first anyway; deploying the code first simply means the cap does
nothing until you do.

## 1. Apply only this migration

```sh
cd server
supabase link --project-ref bktujlufguenjytbdndn
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list only:

```text
20260805150000_refraim_active_export_count.sql
```

Do not use `--include-all`. Stop if any historical migration is listed.

```sh
supabase db push --linked
```

## 2. Verify privileges

```sql
SELECT
  has_function_privilege(
    'anon', 'refraim.count_active_refraim_exports(uuid,integer)', 'EXECUTE'
  ) AS anon_count,
  has_function_privilege(
    'authenticated', 'refraim.count_active_refraim_exports(uuid,integer)', 'EXECUTE'
  ) AS auth_count,
  has_function_privilege(
    'service_role', 'refraim.count_active_refraim_exports(uuid,integer)', 'EXECUTE'
  ) AS service_count;
```

Expected values are `false, false, true`.

## Settings

| Variable | Default | Effect |
|---|---|---|
| `REFRAIM_MAX_CONCURRENT_EXPORTS_PER_USER` | `2` | exports one account may have in flight |

## Why the count is lease-aware

The function applies the same staleness rule as
`list_stale_refraim_exports`. Counting every non-terminal job instead would
mean a job abandoned by a dead worker holds a concurrency slot permanently —
which is precisely the failure the F-052 reaper exists to clear. As written, a
stuck run costs its owner a slot only until the next sweep.

## Why it fails open

This bounds contention between users, not cost. Every export still passes the
plan-quota or Gateway-token gate, the duration and resolution caps, and the
output-count cap. Denying a paid export because one count query failed is a
worse outcome than briefly exceeding the cap.

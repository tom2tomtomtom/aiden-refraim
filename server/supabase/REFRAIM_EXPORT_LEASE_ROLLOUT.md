# refrAIm export lease rollout

`20260805090000_refraim_export_leases.sql` **must be applied before the
application commit is deployed.** `POST /api/videos/:id/process` now writes
`lease_expires_at` on the job it creates, so against an unmigrated database
every export would fail at the insert with `column "lease_expires_at" does not
exist`. There is no read path to soften: the column is written on the very
first durable write of an export.

The reverse order is safe. The migration only adds a nullable column, an index
and two functions, so the currently deployed application keeps working
unchanged after it is applied and before the new code ships.

## 1. Apply only this migration

```sh
cd server
supabase link --project-ref bktujlufguenjytbdndn
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list only:

```text
20260805090000_refraim_export_leases.sql
```

Do not use `--include-all`. Stop if any historical migration is listed.

```sh
supabase db push --linked
```

## 2. Verify privileges

```sql
SELECT
  has_function_privilege(
    'anon', 'refraim.heartbeat_refraim_export(uuid,uuid,integer)', 'EXECUTE'
  ) AS anon_heartbeat,
  has_function_privilege(
    'authenticated', 'refraim.heartbeat_refraim_export(uuid,uuid,integer)', 'EXECUTE'
  ) AS authenticated_heartbeat,
  has_function_privilege(
    'service_role', 'refraim.heartbeat_refraim_export(uuid,uuid,integer)', 'EXECUTE'
  ) AS service_heartbeat,
  has_function_privilege(
    'anon', 'refraim.list_stale_refraim_exports(integer,integer)', 'EXECUTE'
  ) AS anon_sweep,
  has_function_privilege(
    'authenticated', 'refraim.list_stale_refraim_exports(integer,integer)', 'EXECUTE'
  ) AS authenticated_sweep,
  has_function_privilege(
    'service_role', 'refraim.list_stale_refraim_exports(integer,integer)', 'EXECUTE'
  ) AS service_sweep;
```

Expected values are `false, false, true, false, false, true`.

## 3. Deploy, then watch the first sweep

The reaper starts itself at boot and needs no Railway variable. Within one
sweep interval of the first deploy the log should show:

```text
[export-reaper] Sweeping every 60s
```

Any jobs left non-terminal by earlier incidents have no lease, so they are
judged by the previous 30-minute rule and converge on the first sweep. Expect a
one-off `[export-reaper] Converged N stale export(s)` line sized to that
backlog, then near-silence.

## Settings

| Variable | Default | Effect |
|---|---|---|
| `REFRAIM_ENABLE_EXPORT_REAPER` | on | set to `false` to disable the sweep entirely |
| `REFRAIM_REAPER_INTERVAL_MS` | `60000` | how often each replica sweeps |
| `REFRAIM_REAPER_BATCH` | `25` | candidates examined per sweep |
| `REFRAIM_EXPORT_LEASE_SECONDS` | `120` | how long a render's lease survives without renewal |
| `REFRAIM_EXPORT_HEARTBEAT_MS` | lease / 4 | renewal cadence; three renewals fit in one lease |

Running the sweep on every replica is intended. It takes no ownership, and
recovery already serialises concurrent recoverers on the conditional job
transition and the publication fence.

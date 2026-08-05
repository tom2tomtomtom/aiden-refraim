# refrAIm storage quota rollout

`20260805140000_refraim_storage_quota.sql` **must be applied before the
application commit is deployed.** Upload now writes `videos.source_bytes` and
reads usage through `refraim.user_storage_bytes`. Against an unmigrated
database every upload fails, first at the RPC and then at the insert.

The reverse order is safe: the migration adds a nullable column, an index and
one read-only function.

## 1. Apply only this migration

```sh
cd server
supabase link --project-ref bktujlufguenjytbdndn
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list only:

```text
20260805140000_refraim_storage_quota.sql
```

Do not use `--include-all`. Stop if any historical migration is listed.

```sh
supabase db push --linked
```

## 2. Verify privileges

```sql
SELECT
  has_function_privilege('anon', 'refraim.user_storage_bytes(uuid)', 'EXECUTE') AS anon_read,
  has_function_privilege('authenticated', 'refraim.user_storage_bytes(uuid)', 'EXECUTE') AS auth_read,
  has_function_privilege('service_role', 'refraim.user_storage_bytes(uuid)', 'EXECUTE') AS service_read;
```

Expected values are `false, false, true`.

## Backfill

Existing rows have `source_bytes = NULL` and are counted as zero, so every
current account starts from an understated usage figure and nobody is locked
out by the rollout. Usage becomes accurate as old videos are deleted and new
ones are uploaded.

If an accurate figure is needed sooner, sizes can be read from
`storage.objects.metadata->>'size'` and joined back to `refraim.videos` on the
object path in `original_url`. That backfill is deliberately not part of this
migration: it touches the storage schema and should be run deliberately, with
the numbers checked, rather than as a side effect of a deploy.

## Settings

| Variable | Default | Effect |
|---|---|---|
| `REFRAIM_MAX_STORAGE_BYTES_PER_USER` | `5368709120` (5 GB) | per-account cap on stored source bytes |

Only source bytes count. Renders are already gated by tokens and plan quota,
and are bounded per export by `REFRAIM_MAX_OUTPUTS_PER_EXPORT`; upload was the
one unbounded, unpriced way into the bucket.

A quota that cannot be read denies the upload. An unreadable quota is not
evidence of free space, and silent growth is the failure this prevents.

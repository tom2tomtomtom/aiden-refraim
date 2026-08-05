# refrAIm Stripe webhook idempotency rollout

`20260805120000_refraim_stripe_webhook_events.sql` **must be applied before the
application commit is deployed.** The webhook now claims a row in
`refraim.stripe_webhook_events` before handling anything, and treats a failed
claim as "no replay protection available". Against an unmigrated database every
Stripe event would return 500 and Stripe would retry until it gave up.

The reverse order is safe: the migration only adds a table and a prune function
that nothing yet reads.

## 1. Apply only this migration

```sh
cd server
supabase link --project-ref bktujlufguenjytbdndn
supabase migration list --linked
supabase db push --linked --dry-run
```

The dry run must list only:

```text
20260805120000_refraim_stripe_webhook_events.sql
```

Do not use `--include-all`. Stop if any historical migration is listed.

```sh
supabase db push --linked
```

## 2. Verify privileges

```sql
SELECT
  has_table_privilege('anon', 'refraim.stripe_webhook_events', 'SELECT') AS anon_read,
  has_table_privilege('authenticated', 'refraim.stripe_webhook_events', 'INSERT') AS auth_write,
  has_table_privilege('service_role', 'refraim.stripe_webhook_events', 'INSERT') AS service_write;
```

Expected values are `false, false, true`.

## 3. Verify after deploy

Resend any past event from the Stripe dashboard (Developers → Events → Resend).
The first delivery returns `{"received": true}`; the resend returns
`{"received": true, "duplicate": true}` and touches no billing row.

Before this change, resending a `checkout.session.completed` set
`exports_this_month` back to `0`, handing the user another month of exports for
one payment.

## Retention

Rows are kept indefinitely unless pruned. Stripe retries a failing endpoint for
about 3 days; 30 days covers manual replays comfortably.

```sql
SELECT refraim.prune_stripe_webhook_events(30);
```

Nothing calls this automatically. At current volume the table grows slowly
enough that a periodic manual run, or a Supabase scheduled job, is sufficient.

## Known gap this does not close

Idempotency is not ordering. Stripe does not guarantee delivery order, so a
`customer.subscription.updated` carrying a stale status can still arrive after
a newer one and overwrite it. Fixing that needs a monotonic comparison against
the event's `created` timestamp per subscription, which is a separate change.

# Budgetly notification backend

Server-side pieces that make notifications work even when the app is closed, plus
Web Push and email digests.

| Function | Purpose | Schedule |
| --- | --- | --- |
| `generate-notifications` | Creates notification rows for every user (recurring, budgets, goals, investments, net worth, reports). Fans out to `send-push`. | hourly |
| `send-push` | Delivers unread, un-pushed rows as Web Push, honoring channel/quiet-hours/priority. | triggered by generate (or every 15 min) |
| `email-digest` | Daily/weekly email digest via Resend. | daily |

## 1. Apply the migration

Run `supabase/add_notifications_advanced.sql` (and the base `add_notifications.sql` if
you haven't) against your project — SQL editor or `supabase db push`.

## 2. Generate VAPID keys (for Web Push)

```bash
npx web-push generate-vapid-keys
```

- Frontend env (Netlify): `VITE_VAPID_PUBLIC_KEY = <public key>`
- Edge secrets (below): `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`

## 3. Set Edge Function secrets

```bash
supabase secrets set \
  VAPID_PUBLIC_KEY=xxx \
  VAPID_PRIVATE_KEY=yyy \
  VAPID_SUBJECT="mailto:you@yourdomain.com" \
  RESEND_API_KEY=re_xxx \
  DIGEST_FROM="Budgetly <alerts@yourdomain.com>"
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

### Optional: lock down the functions with a shared secret

These functions are deployed `--no-verify-jwt`, so by default anyone who knows the
URL can invoke them. Set a `CRON_SECRET` to require proof on every call:

```bash
supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
```

- **Not set** → functions stay open (unchanged behavior).
- **Set** → callers must present it via the `x-cron-secret` header or
  `Authorization: Bearer <CRON_SECRET>`. Callers already sending the service
  role key as a bearer (pg_cron below, and the internal generate → send-push
  fan-out) keep working with no change.

## 4. Deploy

```bash
supabase functions deploy generate-notifications --no-verify-jwt
supabase functions deploy send-push --no-verify-jwt
supabase functions deploy email-digest --no-verify-jwt
```

## 5. Schedule

Either uncomment the `pg_cron` block at the bottom of
`add_notifications_advanced.sql`, or add schedules in the Supabase dashboard
(Edge Functions › Schedules):

- `generate-notifications` → `0 * * * *`
- `email-digest` → `0 13 * * *`
- `cleanup_expired_notifications()` → `0 3 * * *`

## Testing manually

```bash
# generate for one user
curl -X POST https://<ref>.functions.supabase.co/generate-notifications \
  -H "Authorization: Bearer <service_role_key>" -H "Content-Type: application/json" \
  -d '{"user_id":"<uuid>"}'

# push + digest
curl -X POST https://<ref>.functions.supabase.co/send-push   -H "Authorization: Bearer <service_role_key>"
curl -X POST https://<ref>.functions.supabase.co/email-digest -H "Authorization: Bearer <service_role_key>"
```

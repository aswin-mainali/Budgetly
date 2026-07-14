// Shared request guard for the scheduled / service-invoked edge functions
// (generate-notifications, send-push, email-digest). These are deployed with
// --no-verify-jwt so Supabase does not authenticate the caller for us.
//
// Opt-in and fully backward compatible:
//   * If CRON_SECRET is NOT set, every request is allowed exactly as before.
//   * If CRON_SECRET IS set, callers must prove it via either
//       - the `x-cron-secret` header, or
//       - `Authorization: Bearer <CRON_SECRET>`.
//     Existing service-role callers are also accepted (pg_cron sending the
//     service role key, and the generate-notifications -> send-push fan-out),
//     so turning the guard on does not require changing the cron SQL.
//
// Returns a 401 Response to reject the request, or null to allow it.

// Constant-time comparison so we never leak secret contents through timing.
const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length === 0 || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const guardServiceRequest = (
  req: Request,
  cors: Record<string, string>,
): Response | null => {
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret) return null // guard disabled -> preserve existing open behavior

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const provided = req.headers.get('x-cron-secret') || ''
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')

  const ok =
    timingSafeEqual(provided, secret) ||
    timingSafeEqual(bearer, secret) ||
    (serviceKey !== '' && timingSafeEqual(bearer, serviceKey))

  if (ok) return null
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

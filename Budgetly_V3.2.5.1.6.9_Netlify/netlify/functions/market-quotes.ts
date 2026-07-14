import type { Handler } from '@netlify/functions'

type QuoteResult = {
  symbol: string
  providerSymbol: string
  price: number
  previousClose: number | null
  currency: 'CAD' | 'USD'
  change: number | null
  changePercent: number | null
  timestamp: string
}

const TSX_MAP: Record<string, string> = {
  'RY.TO': 'RY:TSX',
  'TD.TO': 'TD:TSX',
  'BNS.TO': 'BNS:TSX',
  'SHOP.TO': 'SHOP:TSX',
  'VFV.TO': 'VFV:TSX',
  'XEQT.TO': 'XEQT:TSX',
}

const normalizeSymbol = (symbol: string) => TSX_MAP[symbol] || symbol

// ---------------------------------------------------------------------------
// Configurable thresholds — nothing is hardcoded, every limit is env-overridable
// so it can be tuned per environment without a code change.
// ---------------------------------------------------------------------------
const int = (value: string | undefined, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

// This is an unauthenticated public endpoint that proxies to a metered upstream
// API using our key, so it gets a moderate per-IP limit (looser than auth routes,
// stricter than a fully open endpoint).
const RATE_LIMIT_MAX = int(process.env.MARKET_QUOTES_RATE_LIMIT_MAX, 30)
const RATE_LIMIT_WINDOW_MS = int(process.env.MARKET_QUOTES_RATE_LIMIT_WINDOW_MS, 60_000)
const MAX_SYMBOLS_PER_REQUEST = int(process.env.MARKET_QUOTES_MAX_SYMBOLS, 25)
const MAX_SYMBOL_LENGTH = int(process.env.MARKET_QUOTES_MAX_SYMBOL_LENGTH, 12)

// Strict input schema for a ticker: starts alphanumeric, then letters/digits plus
// the dot/hyphen used by exchange suffixes (e.g. BRK.B, SHOP.TO). Anything else is
// rejected outright rather than sanitized.
const SYMBOL_RE = new RegExp(`^[A-Z0-9][A-Z0-9.\\-]{0,${MAX_SYMBOL_LENGTH - 1}}$`)

// Best-effort in-memory sliding-window limiter. Serverless instances are ephemeral
// and not shared across the fleet, so this throttles abusive bursts against a warm
// instance rather than giving a global guarantee — pair with an edge/CDN limit if a
// hard global cap is required.
const hits = new Map<string, number[]>()
const checkRateLimit = (key: string): { limited: boolean; retryAfter: number } => {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart)
  recent.push(now)
  hits.set(key, recent)

  // Opportunistic cleanup so the map cannot grow without bound.
  if (hits.size > 5000) {
    for (const [k, times] of hits) {
      if (!times.some((t) => t > windowStart)) hits.delete(k)
    }
  }

  if (recent.length > RATE_LIMIT_MAX) {
    const retryAfter = Math.max(1, Math.ceil((recent[0] + RATE_LIMIT_WINDOW_MS - now) / 1000))
    return { limited: true, retryAfter }
  }
  return { limited: false, retryAfter: 0 }
}

const clientIp = (event: Parameters<Handler>[0]): string => {
  const headers = event.headers || {}
  return (
    headers['x-nf-client-connection-ip'] ||
    (headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    'unknown'
  )
}

export const handler: Handler = async (event) => {
  const json = (statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}) => ({
    statusCode,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  })

  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return json(405, { error: 'method_not_allowed' })
  }

  // ---- Rate limiting (per client IP) ----
  const rate = checkRateLimit(clientIp(event))
  if (rate.limited) {
    return json(429, { error: 'rate_limited' }, { 'retry-after': String(rate.retryAfter) })
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY || process.env.VITE_TWELVE_DATA_API_KEY
  if (!apiKey) {
    // Log server-side; return a generic, non-revealing status the client understands.
    console.error('market-quotes: upstream API key is not configured')
    return json(503, { error: 'service_unavailable' })
  }

  // ---- Parse + validate input against a strict schema ----
  let bodySymbols: unknown[] = []
  if (event.httpMethod === 'POST') {
    try {
      const parsed = JSON.parse(event.body || '{}')
      if (parsed && Array.isArray(parsed.symbols)) bodySymbols = parsed.symbols
    } catch {
      return json(400, { error: 'invalid_json' })
    }
  }
  const querySymbol = event.httpMethod === 'GET' ? event.queryStringParameters?.symbol : undefined

  const symbols = [...new Set(
    [...bodySymbols, ...(querySymbol ? [querySymbol] : [])]
      .map((s) => String(s ?? '').trim().toUpperCase())
      .filter(Boolean),
  )]

  if (!symbols.length) return json(400, { error: 'symbols_required' })
  if (symbols.length > MAX_SYMBOLS_PER_REQUEST) {
    return json(400, { error: 'too_many_symbols', max: MAX_SYMBOLS_PER_REQUEST })
  }
  const invalid = symbols.filter((s) => !SYMBOL_RE.test(s))
  if (invalid.length) return json(400, { error: 'invalid_symbols', invalid })

  const quotes: QuoteResult[] = []
  const failed: string[] = []

  for (const symbol of symbols) {
    const providerSymbol = normalizeSymbol(symbol)
    try {
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(providerSymbol)}&apikey=${encodeURIComponent(apiKey)}`
      const response = await fetch(url)
      const raw = await response.json() as Record<string, unknown>

      if (!response.ok || raw?.status === 'error') {
        // Keep the upstream detail in server logs only; never echo it to the client.
        console.error('market-quotes: upstream error', symbol, response.status, raw?.message)
        failed.push(symbol)
        continue
      }

      const price = Number(raw.close)
      if (!Number.isFinite(price) || price <= 0) {
        failed.push(symbol)
        continue
      }

      const previousCloseNum = Number(raw.previous_close)
      const previousClose = Number.isFinite(previousCloseNum) ? previousCloseNum : null
      const currency = String(raw.currency || (symbol.endsWith('.TO') ? 'CAD' : 'USD')).toUpperCase() === 'CAD' ? 'CAD' : 'USD'
      const changeNum = Number(raw.change)
      const changePercentNum = Number(raw.percent_change)

      quotes.push({
        symbol,
        providerSymbol,
        price,
        previousClose,
        currency,
        change: Number.isFinite(changeNum) ? changeNum : null,
        changePercent: Number.isFinite(changePercentNum) ? changePercentNum : null,
        timestamp: new Date(String(raw.datetime || Date.now())).toISOString(),
      })
    } catch (error) {
      // Full detail to server logs; generic failure to the client.
      console.error('market-quotes: request failed', symbol, error instanceof Error ? error.message : error)
      failed.push(symbol)
    }
  }

  return json(200, { quotes, failed })
}

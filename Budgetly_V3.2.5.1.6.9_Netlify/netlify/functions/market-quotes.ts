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

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY || process.env.VITE_TWELVE_DATA_API_KEY
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Twelve Data API key is not configured.' }) }
  }

  const bodySymbols = event.httpMethod === 'POST'
    ? ((JSON.parse(event.body || '{}').symbols || []) as string[])
    : []
  const querySymbol = event.httpMethod === 'GET' ? event.queryStringParameters?.symbol : undefined
  const symbols = [...new Set([...(bodySymbols || []), ...(querySymbol ? [querySymbol] : [])]
    .map((s) => String(s || '').trim().toUpperCase())
    .filter(Boolean))]

  if (!symbols.length) return { statusCode: 400, body: JSON.stringify({ error: 'symbols_required' }) }

  const quotes: QuoteResult[] = []
  const failed: Array<{ symbol: string; error: string }> = []

  for (const symbol of symbols) {
    const providerSymbol = normalizeSymbol(symbol)
    try {
      const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(providerSymbol)}&apikey=${encodeURIComponent(apiKey)}`
      const response = await fetch(url)
      const raw = await response.json() as Record<string, unknown>

      if (!response.ok || raw?.status === 'error') {
        failed.push({ symbol, error: String((raw?.message as string) || `HTTP ${response.status}`) })
        continue
      }

      const price = Number(raw.close)
      if (!Number.isFinite(price) || price <= 0) {
        failed.push({ symbol, error: 'No valid quote returned' })
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
      failed.push({ symbol, error: error instanceof Error ? error.message : 'request_failed' })
    }
  }

  return { statusCode: 200, body: JSON.stringify({ quotes, failed }) }
}

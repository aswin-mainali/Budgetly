import type { Handler } from '@netlify/functions'

export const handler: Handler = async (event) => {
  const apiKey = process.env.VITE_TWELVE_DATA_API_KEY || process.env.TWELVE_DATA_API_KEY
  if (!apiKey) return { statusCode: 503, body: JSON.stringify({ error: 'not_configured' }) }
  const symbols = event.httpMethod === 'GET' ? [event.queryStringParameters?.symbol].filter(Boolean) as string[] : (JSON.parse(event.body || '{}').symbols || []) as string[]
  if (!symbols.length) return { statusCode: 400, body: JSON.stringify({ error: 'symbols_required' }) }
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols.join(','))}&apikey=${apiKey}`
    const response = await fetch(url)
    if (response.status === 429) return { statusCode: 429, body: JSON.stringify({ error: 'rate_limited' }) }
    const data = await response.json() as Record<string, any>
    const records = symbols.map((symbol) => {
      const raw = data[symbol] || data
      return { symbol, price: Number(raw.close || raw.price || 0), previousClose: Number(raw.previous_close || 0) || null, currency: (raw.currency || (symbol.endsWith('.TO') ? 'CAD' : 'USD')), timestamp: new Date().toISOString() }
    }).filter((r) => r.price > 0)
    return { statusCode: 200, body: JSON.stringify({ quotes: records, failed: symbols.filter((s) => !records.find((r) => r.symbol === s)) }) }
  } catch { return { statusCode: 500, body: JSON.stringify({ error: 'request_failed' }) } }
}

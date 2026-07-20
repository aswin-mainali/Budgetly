import type { Handler } from '@netlify/functions'

// ---------------------------------------------------------------------------
// AI Receipt Capture — vision extraction endpoint.
//
// Takes a photo of a receipt (base64/JPEG) plus the user's expense-category
// names, sends it to the Claude Messages API with a strict JSON schema, and
// returns structured fields the client uses to pre-fill a transaction.
//
// This proxies to the Anthropic API using our server-side key, so it is rate
// limited per client IP like the other public function in this project. Nothing
// about the upstream error detail is ever echoed back to the browser.
// ---------------------------------------------------------------------------

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const MODEL = process.env.RECEIPT_SCAN_MODEL || 'claude-opus-4-8'
const RATE_LIMIT_MAX = int(process.env.RECEIPT_SCAN_RATE_LIMIT_MAX, 12)
const RATE_LIMIT_WINDOW_MS = int(process.env.RECEIPT_SCAN_RATE_LIMIT_WINDOW_MS, 60_000)
// Base64 of the image. ~6MB of base64 ≈ ~4.5MB binary, comfortably under the
// per-image limit while the client already compresses aggressively.
const MAX_IMAGE_B64 = int(process.env.RECEIPT_SCAN_MAX_IMAGE_B64, 6_000_000)
const MAX_CATEGORIES = int(process.env.RECEIPT_SCAN_MAX_CATEGORIES, 60)

const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

// Best-effort per-instance sliding-window limiter (same approach as market-quotes).
const hits = new Map<string, number[]>()
const checkRateLimit = (key: string): { limited: boolean; retryAfter: number } => {
  const now = Date.now()
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart)
  recent.push(now)
  hits.set(key, recent)
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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const RECEIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    merchant: { type: 'string', description: 'The store or merchant name, cleaned up (e.g. "Starbucks", not "STARBUCKS #4021").' },
    amount: { type: 'number', description: 'The final grand total actually paid, including tax and tip. A positive number.' },
    date: { type: 'string', description: 'Transaction date as YYYY-MM-DD. If the receipt has no year, infer it from the provided today date.' },
    type: { type: 'string', enum: ['expense', 'income'], description: 'Almost always "expense" for a purchase receipt.' },
    category: { type: 'string', description: 'The single best-matching category name from the provided list, copied verbatim. Use "Uncategorized" only if none fits.' },
    note: { type: 'string', description: 'A short human note, e.g. a couple of the main items purchased. May be empty.' },
    currency: { type: 'string', description: 'ISO 4217 currency code detected on the receipt (e.g. USD, CAD, EUR), else the provided default.' },
    line_items: {
      type: 'array',
      description: 'Individual purchased items, if legible. May be empty.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
        },
        required: ['name', 'price'],
      },
    },
    confidence: { type: 'number', description: 'Your overall confidence from 0 to 1 that the extraction is correct.' },
  },
  required: ['merchant', 'amount', 'date', 'type', 'category', 'note', 'currency', 'line_items', 'confidence'],
}

export const handler: Handler = async (event) => {
  const json = (statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}) => ({
    statusCode,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body),
  })

  if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' })

  const rate = checkRateLimit(clientIp(event))
  if (rate.limited) return json(429, { error: 'rate_limited' }, { 'retry-after': String(rate.retryAfter) })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('receipt-scan: ANTHROPIC_API_KEY is not configured')
    return json(503, { error: 'service_unavailable' })
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // ---- Validate the image ----
  let image = String(parsed.image ?? '').trim()
  let mediaType = String(parsed.mediaType ?? 'image/jpeg').toLowerCase()
  // Accept either a bare base64 string or a full data URL.
  const dataUrlMatch = image.match(/^data:(image\/[a-z+]+);base64,(.*)$/i)
  if (dataUrlMatch) {
    mediaType = dataUrlMatch[1].toLowerCase()
    image = dataUrlMatch[2]
  }
  if (!image) return json(400, { error: 'image_required' })
  if (!ALLOWED_MEDIA.has(mediaType)) return json(400, { error: 'unsupported_media_type' })
  if (image.length > MAX_IMAGE_B64) return json(413, { error: 'image_too_large' })

  // ---- Validate the context (category names + currency + today) ----
  const categories = Array.isArray(parsed.categories)
    ? parsed.categories.map((c) => String(c ?? '').trim()).filter(Boolean).slice(0, MAX_CATEGORIES)
    : []
  const currency = /^[A-Za-z]{3}$/.test(String(parsed.currency ?? '')) ? String(parsed.currency).toUpperCase() : 'USD'
  const today = ISO_DATE.test(String(parsed.today ?? '')) ? String(parsed.today) : new Date().toISOString().slice(0, 10)

  const categoryList = categories.length ? categories.join(', ') : '(none provided)'

  const systemPrompt = [
    'You are an expert receipt-scanning assistant for a personal budgeting app.',
    'You are given a photo of a purchase receipt. Extract the transaction details accurately.',
    'Rules:',
    `- "amount" is the final grand total paid (after tax and tip), as a positive number in the receipt's currency.`,
    `- "date" must be YYYY-MM-DD. If the year is missing on the receipt, use the year from today (${today}). If no date is legible, use ${today}.`,
    `- "category" must be copied verbatim from this list of the user's expense categories, choosing the single best fit: [${categoryList}]. If nothing fits, use "Uncategorized".`,
    `- "currency" is the ISO code shown on the receipt; if none is visible, use ${currency}.`,
    '- "type" is "expense" for a normal purchase. Only use "income" for a refund/return receipt.',
    '- Keep "merchant" clean and human-readable. Keep "note" short (a few main items).',
    '- If the image is not a receipt or is unreadable, still return the schema with your best guess and a low confidence.',
  ].join('\n')

  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    output_config: { format: { type: 'json_schema', schema: RECEIPT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: 'Extract the details from this receipt and return them in the required JSON format.' },
        ],
      },
    ],
  }

  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    })

    const raw = await response.json() as Record<string, unknown>

    if (!response.ok) {
      console.error('receipt-scan: upstream error', response.status, (raw?.error as Record<string, unknown>)?.message)
      if (response.status === 429) return json(429, { error: 'rate_limited' }, { 'retry-after': '20' })
      return json(502, { error: 'extraction_failed' })
    }

    if (raw.stop_reason === 'refusal') {
      return json(422, { error: 'could_not_read_receipt' })
    }

    const content = Array.isArray(raw.content) ? raw.content as Array<Record<string, unknown>> : []
    const textBlock = content.find((b) => b.type === 'text')
    const text = typeof textBlock?.text === 'string' ? textBlock.text : ''
    if (!text) return json(502, { error: 'extraction_failed' })

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(text)
    } catch {
      console.error('receipt-scan: model returned non-JSON')
      return json(502, { error: 'extraction_failed' })
    }

    // ---- Normalize / sanity-check the fields before returning ----
    const amount = Number(extracted.amount)
    const rawDate = String(extracted.date ?? '')
    const date = ISO_DATE.test(rawDate) ? rawDate : today
    const type = extracted.type === 'income' ? 'income' : 'expense'
    const lineItems = Array.isArray(extracted.line_items)
      ? (extracted.line_items as Array<Record<string, unknown>>)
          .map((li) => ({ name: String(li?.name ?? '').slice(0, 80), price: Number(li?.price) }))
          .filter((li) => li.name && Number.isFinite(li.price))
          .slice(0, 40)
      : []

    return json(200, {
      ok: true,
      data: {
        merchant: String(extracted.merchant ?? '').slice(0, 80),
        amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
        date,
        type,
        category: String(extracted.category ?? '').slice(0, 80),
        note: String(extracted.note ?? '').slice(0, 200),
        currency: /^[A-Za-z]{3}$/.test(String(extracted.currency ?? '')) ? String(extracted.currency).toUpperCase() : currency,
        lineItems,
        confidence: Number.isFinite(Number(extracted.confidence)) ? Math.max(0, Math.min(1, Number(extracted.confidence))) : null,
      },
    })
  } catch (error) {
    console.error('receipt-scan: request failed', error instanceof Error ? error.message : error)
    return json(502, { error: 'extraction_failed' })
  }
}

import type { Handler } from '@netlify/functions'

// ---------------------------------------------------------------------------
// Document Vault — AI extraction endpoint.
//
// Takes an uploaded document (PDF or image, base64) and asks the Claude
// Messages API to pull out the fields the vault tracks: a clean title, the
// document type, the issuer, the AGREEMENT (start/effective) date and the
// EXPIRATION date, a reference number, and a short summary. Returns strict
// JSON the client uses to pre-fill the "Add document" form.
//
// Same shape as receipt-scan: server-side key, per-IP rate limiting, and no
// upstream error detail is ever echoed to the browser.
// ---------------------------------------------------------------------------

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

const int = (value: string | undefined, fallback: number) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

const MODEL = process.env.DOCUMENT_EXTRACT_MODEL || 'claude-opus-4-8'
const RATE_LIMIT_MAX = int(process.env.DOCUMENT_EXTRACT_RATE_LIMIT_MAX, 12)
const RATE_LIMIT_WINDOW_MS = int(process.env.DOCUMENT_EXTRACT_RATE_LIMIT_WINDOW_MS, 60_000)
// ~9.5MB of base64 ≈ ~7MB binary. Documents can be larger than receipts.
const MAX_FILE_B64 = int(process.env.DOCUMENT_EXTRACT_MAX_FILE_B64, 9_500_000)

const IMAGE_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const PDF_MEDIA = 'application/pdf'

const DOC_TYPES = ['agreement', 'insurance', 'contract', 'warranty', 'lease', 'license', 'certificate', 'other'] as const

// Best-effort per-instance sliding-window limiter (same approach as receipt-scan).
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

const DOCUMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'A short, human-readable title for the document, e.g. "Auto Insurance Policy — Toyota Corolla" or "Apartment Lease Agreement".' },
    doc_type: { type: 'string', enum: [...DOC_TYPES], description: 'The single best-matching document type.' },
    issuer: { type: 'string', description: 'The company, institution, or counterparty that issued the document (e.g. "Geico", "State Farm", the landlord/company name). May be empty.' },
    reference_number: { type: 'string', description: 'The policy number, contract number, account number, or any primary reference identifier printed on the document. May be empty.' },
    agreement_date: { type: 'string', description: 'The start / effective / signing date of the document as YYYY-MM-DD. Empty string if none is present.' },
    expiration_date: { type: 'string', description: 'The expiry / renewal / end date as YYYY-MM-DD. Empty string if none is present.' },
    summary: { type: 'string', description: 'A concise one or two sentence plain-language summary of what this document covers.' },
    confidence: { type: 'number', description: 'Your overall confidence from 0 to 1 that the extraction (especially the dates) is correct.' },
  },
  required: ['title', 'doc_type', 'issuer', 'reference_number', 'agreement_date', 'expiration_date', 'summary', 'confidence'],
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
    console.error('document-extract: ANTHROPIC_API_KEY is not configured')
    return json(503, { error: 'service_unavailable' })
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  // ---- Validate the file (accepts bare base64 or a full data URL) ----
  let file = String(parsed.file ?? '').trim()
  let mediaType = String(parsed.mediaType ?? '').toLowerCase()
  const dataUrlMatch = file.match(/^data:([a-z0-9/+.-]+);base64,(.*)$/i)
  if (dataUrlMatch) {
    mediaType = dataUrlMatch[1].toLowerCase()
    file = dataUrlMatch[2]
  }
  if (!file) return json(400, { error: 'file_required' })

  const isPdf = mediaType === PDF_MEDIA
  const isImage = IMAGE_MEDIA.has(mediaType)
  if (!isPdf && !isImage) return json(400, { error: 'unsupported_media_type' })
  if (file.length > MAX_FILE_B64) return json(413, { error: 'file_too_large' })

  const today = ISO_DATE.test(String(parsed.today ?? '')) ? String(parsed.today) : new Date().toISOString().slice(0, 10)

  const systemPrompt = [
    'You are an expert document-analysis assistant for a secure personal document vault.',
    'You are given a single document (an agreement, insurance policy, contract, warranty, lease, licence, certificate, or similar).',
    'Extract the requested fields accurately and return them in the required JSON format.',
    'Rules:',
    `- Dates must be YYYY-MM-DD. If a date is written in words or a regional format, normalise it. Today is ${today}; use it only to resolve an ambiguous 2-digit year.`,
    '- "agreement_date" is the start / effective / signing date. "expiration_date" is the end / renewal / expiry date.',
    '- If a field genuinely is not present in the document, return an empty string for it (do not invent values).',
    '- Keep "title" and "summary" concise and free of sensitive full identifiers.',
    '- If the document is unreadable or clearly not a document of record, still return the schema with your best guess and a low confidence.',
  ].join('\n')

  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: PDF_MEDIA, data: file } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: file } }

  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: systemPrompt,
    output_config: { format: { type: 'json_schema', schema: DOCUMENT_SCHEMA } },
    messages: [
      {
        role: 'user',
        content: [
          fileBlock,
          { type: 'text', text: 'Extract the key details from this document and return them in the required JSON format.' },
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
      console.error('document-extract: upstream error', response.status, (raw?.error as Record<string, unknown>)?.message)
      if (response.status === 429) return json(429, { error: 'rate_limited' }, { 'retry-after': '20' })
      return json(502, { error: 'extraction_failed' })
    }

    if (raw.stop_reason === 'refusal') {
      return json(422, { error: 'could_not_read_document' })
    }

    const content = Array.isArray(raw.content) ? raw.content as Array<Record<string, unknown>> : []
    const textBlock = content.find((b) => b.type === 'text')
    const text = typeof textBlock?.text === 'string' ? textBlock.text : ''
    if (!text) return json(502, { error: 'extraction_failed' })

    let extracted: Record<string, unknown>
    try {
      extracted = JSON.parse(text)
    } catch {
      console.error('document-extract: model returned non-JSON')
      return json(502, { error: 'extraction_failed' })
    }

    // ---- Normalize / sanity-check the fields before returning ----
    const normDate = (value: unknown) => {
      const s = String(value ?? '').trim()
      return ISO_DATE.test(s) ? s : ''
    }
    const docType = (DOC_TYPES as readonly string[]).includes(String(extracted.doc_type))
      ? String(extracted.doc_type)
      : 'other'
    const confidence = Number(extracted.confidence)

    return json(200, {
      ok: true,
      data: {
        title: String(extracted.title ?? '').slice(0, 140),
        docType,
        issuer: String(extracted.issuer ?? '').slice(0, 120),
        referenceNumber: String(extracted.reference_number ?? '').slice(0, 80),
        agreementDate: normDate(extracted.agreement_date),
        expirationDate: normDate(extracted.expiration_date),
        summary: String(extracted.summary ?? '').slice(0, 400),
        confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
      },
    })
  } catch (error) {
    console.error('document-extract: request failed', error instanceof Error ? error.message : error)
    return json(502, { error: 'extraction_failed' })
  }
}

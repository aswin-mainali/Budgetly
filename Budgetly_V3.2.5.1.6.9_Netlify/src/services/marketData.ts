export type SecuritySuggestion = { symbol: string; companyName: string; exchange: string; currency: 'CAD' | 'USD'; fallbackPrice: number; domain?: string; logo_url?: string }
export type MarketQuote = { symbol: string; price: number; previousClose: number | null; currency: 'CAD' | 'USD'; timestamp: string; isEstimated?: boolean }

const LOGO_PROVIDER = (import.meta as any).env?.VITE_LOGO_PROVIDER || ''
const LOGO_DEV_KEY = (import.meta as any).env?.VITE_LOGO_DEV_API_KEY || ''

const buildProviderLogoUrl = (domain?: string) => {
  if (!domain || !LOGO_PROVIDER) return null
  if (LOGO_PROVIDER === 'logodev') return `https://img.logo.dev/${domain}${LOGO_DEV_KEY ? `?token=${LOGO_DEV_KEY}` : ''}`
  return null
}

export const STATIC_SECURITIES: SecuritySuggestion[] = [
  { symbol: 'AAPL', companyName: 'Apple Inc.', exchange: 'NASDAQ', currency: 'USD', fallbackPrice: 298.97, domain: 'apple.com' },
  { symbol: 'MSFT', companyName: 'Microsoft Corporation', exchange: 'NASDAQ', currency: 'USD', fallbackPrice: 421.15, domain: 'microsoft.com' },
  { symbol: 'TSLA', companyName: 'Tesla Inc.', exchange: 'NASDAQ', currency: 'USD', fallbackPrice: 181.23, domain: 'tesla.com' },
  { symbol: 'NVDA', companyName: 'NVIDIA Corporation', exchange: 'NASDAQ', currency: 'USD', fallbackPrice: 119.82, domain: 'nvidia.com' },
  { symbol: 'AMZN', companyName: 'Amazon.com Inc.', exchange: 'NASDAQ', currency: 'USD', fallbackPrice: 189.37, domain: 'amazon.com' },
  { symbol: 'GOOGL', companyName: 'Alphabet Inc.', exchange: 'NASDAQ', currency: 'USD', fallbackPrice: 173.91, domain: 'abc.xyz' },
  { symbol: 'SHOP.TO', companyName: 'Shopify Inc.', exchange: 'TSX', currency: 'CAD', fallbackPrice: 88.12, domain: 'shopify.com' },
  { symbol: 'RY.TO', companyName: 'Royal Bank of Canada', exchange: 'TSX', currency: 'CAD', fallbackPrice: 150.44, domain: 'rbc.com' },
  { symbol: 'TD.TO', companyName: 'Toronto-Dominion Bank', exchange: 'TSX', currency: 'CAD', fallbackPrice: 81.22, domain: 'td.com' },
  { symbol: 'BNS.TO', companyName: 'Bank of Nova Scotia', exchange: 'TSX', currency: 'CAD', fallbackPrice: 65.88, domain: 'scotiabank.com' },
  { symbol: 'BMO.TO', companyName: 'Bank of Montreal', exchange: 'TSX', currency: 'CAD', fallbackPrice: 124.31, domain: 'bmo.com' },
  { symbol: 'VFV.TO', companyName: 'Vanguard S&P 500 Index ETF', exchange: 'TSX', currency: 'CAD', fallbackPrice: 129.03, domain: 'vanguard.ca' },
  { symbol: 'XEQT.TO', companyName: 'iShares Core Equity ETF Portfolio', exchange: 'TSX', currency: 'CAD', fallbackPrice: 32.65, domain: 'blackrock.com' },
]

export const getHoldingLogo = ({ symbol, companyName, logo_url, domain }: { symbol: string; companyName: string; logo_url?: string | null; domain?: string | null }) => {
  if (logo_url) return logo_url
  const fromStatic = STATIC_SECURITIES.find((s) => s.symbol === symbol)
  if (fromStatic?.logo_url) return fromStatic.logo_url
  const provider = buildProviderLogoUrl(domain || fromStatic?.domain)
  if (provider) return provider
  return null
}

export const searchSecurities = async (query: string) => {
  const q = query.trim().toLowerCase(); if (!q) return []
  return STATIC_SECURITIES.filter((i) => i.symbol.toLowerCase().includes(q) || i.companyName.toLowerCase().includes(q)).slice(0, 12)
}
export const getQuote = async (symbol: string) => { const res = await getBatchQuotes([symbol]); if (!res.quotes[0]) throw new Error('Quote unavailable'); return res.quotes[0] }
export const getBatchQuotes = async (symbols: string[]) => { const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))]; if (!unique.length) return { quotes: [], failed: [] as string[] }; try { const response = await fetch('/api/market-quotes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbols: unique }) }); if (response.status === 429) return { quotes: [], failed: unique, rateLimited: true }; if (response.status === 503) return { quotes: [], failed: unique, notConfigured: true }; if (!response.ok) throw new Error('failed'); const data = await response.json() as { quotes?: MarketQuote[]; failed?: string[] }; return { quotes: data.quotes ?? [], failed: data.failed ?? [] } } catch { const map = new Map(STATIC_SECURITIES.map((i) => [i.symbol, i])); const quotes = unique.flatMap((s) => { const m = map.get(s); return m ? [{ symbol: m.symbol, price: m.fallbackPrice, previousClose: null, currency: m.currency, timestamp: new Date().toISOString(), isEstimated: true }] : [] }); return { quotes, failed: unique.filter((s) => !map.has(s)) } } }

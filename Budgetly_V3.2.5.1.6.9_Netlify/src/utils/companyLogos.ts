const SYMBOL_DOMAIN_MAP: Record<string, string> = {
  AAPL: 'apple.com',
  MSFT: 'microsoft.com',
  GOOGL: 'abc.xyz',
  GOOG: 'abc.xyz',
  TSLA: 'tesla.com',
  NVDA: 'nvidia.com',
  AMZN: 'amazon.com',
  META: 'meta.com',
  'SHOP.TO': 'shopify.com',
  'RY.TO': 'rbc.com',
  'TD.TO': 'td.com',
  'BMO.TO': 'bmo.com',
  'BNS.TO': 'scotiabank.com',
  'VFV.TO': 'vanguard.ca',
  'XEQT.TO': 'blackrock.com',
}

export function getDomainForSymbol(symbol?: string | null) {
  if (!symbol) return null
  return SYMBOL_DOMAIN_MAP[symbol.toUpperCase()] || null
}

export function getLogoDevUrl(domain?: string | null) {
  const token = import.meta.env.VITE_LOGO_DEV_TOKEN as string | undefined
  if (!domain || !token) return null
  return `https://img.logo.dev/${domain}?token=${token}&size=128&format=png`
}

export function getCompanyLogoUrl(item?: { symbol?: string | null; logo_url?: string | null; domain?: string | null }) {
  if (!item) return null
  if (item.logo_url) return item.logo_url
  const domain = item.domain || getDomainForSymbol(item.symbol)
  return getLogoDevUrl(domain)
}

export function getFallbackInitials(symbol?: string | null, companyName?: string | null) {
  const s = (symbol || '').toUpperCase()
  if (s === 'SHOP.TO') return 'SHOP'
  if (s === 'VFV.TO') return 'VFV'
  if (s === 'XEQT.TO') return 'XEQT'
  if (s.includes('.')) return s.split('.')[0]
  if (s.length <= 4) return s
  const words = (companyName || '').split(' ').filter(Boolean)
  if (words.length === 0) return 'STK'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

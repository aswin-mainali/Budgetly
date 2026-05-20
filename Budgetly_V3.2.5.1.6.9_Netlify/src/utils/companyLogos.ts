const KNOWN_LOGO_URLS: Record<string, string> = {
  AAPL: 'https://logo.clearbit.com/apple.com',
  MSFT: 'https://logo.clearbit.com/microsoft.com',
  TSLA: 'https://logo.clearbit.com/tesla.com',
  NVDA: 'https://logo.clearbit.com/nvidia.com',
  'SHOP.TO': 'https://logo.clearbit.com/shopify.com',
  'RY.TO': 'https://logo.clearbit.com/rbc.com',
  'TD.TO': 'https://logo.clearbit.com/td.com',
  'BMO.TO': 'https://logo.clearbit.com/bmo.com',
  'BNS.TO': 'https://logo.clearbit.com/scotiabank.com',
  'VFV.TO': 'https://logo.clearbit.com/vanguard.ca',
  'XEQT.TO': 'https://logo.clearbit.com/blackrock.com',
}

export function getCompanyLogoUrl(item?: { symbol?: string | null; logo_url?: string | null; domain?: string | null }) {
  if (!item) return null
  if (item.logo_url) return item.logo_url
  const symbol = item.symbol?.toUpperCase() || ''
  const token = import.meta.env.VITE_LOGO_DEV_TOKEN as string | undefined
  if (item.domain && token) return `https://img.logo.dev/${item.domain}?token=${token}`
  return KNOWN_LOGO_URLS[symbol] || null
}

export function getFallbackInitials(symbol?: string | null, companyName?: string | null) {
  const s = (symbol || '').toUpperCase()
  if (s.includes('.')) return s.split('.')[0]
  if (s.length <= 4) return s
  const words = (companyName || '').split(' ').filter(Boolean)
  if (words.length === 0) return 'STK'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

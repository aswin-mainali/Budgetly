import React, { useMemo, useState } from 'react'
import { getCompanyLogoUrl, getFallbackInitials } from '../../utils/companyLogos'

const badgeClassFor = (symbol?: string) => {
  const s = (symbol || '').toUpperCase()
  if (s === 'AAPL') return 'logoBadgeAapl'
  if (s === 'MSFT') return 'logoBadgeMsft'
  if (s === 'GOOG' || s === 'GOOGL') return 'logoBadgeGoog'
  if (s === 'TSLA') return 'logoBadgeTsla'
  if (s === 'NVDA') return 'logoBadgeNvda'
  if (s === 'SHOP.TO') return 'logoBadgeShop'
  if (s === 'RY.TO') return 'logoBadgeRy'
  if (s === 'TD.TO') return 'logoBadgeTd'
  if (s === 'VFV.TO') return 'logoBadgeVfv'
  if (s === 'XEQT.TO') return 'logoBadgeXeqt'
  return 'logoBadgeDefault'
}

export function HoldingLogo({ symbol, companyName, logoUrl, domain, size = 40 }: { symbol?: string; companyName?: string; logoUrl?: string | null; domain?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  const resolved = useMemo(() => getCompanyLogoUrl({ symbol, logo_url: logoUrl, domain }), [symbol, logoUrl, domain])
  const text = useMemo(() => getFallbackInitials(symbol, companyName), [symbol, companyName])
  const badgeClass = badgeClassFor(symbol)
  return (
    <div className={`holdingLogo ${badgeClass}`} style={{ width: size, height: size }}>
      {resolved && !failed ? <img src={resolved} alt={symbol || 'logo'} onError={() => setFailed(true)} loading='lazy' /> : <span>{text}</span>}
    </div>
  )
}

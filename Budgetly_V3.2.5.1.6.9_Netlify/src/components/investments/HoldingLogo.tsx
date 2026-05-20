import React, { useMemo, useState } from 'react'
import { getCompanyLogoUrl, getFallbackInitials } from '../../utils/companyLogos'

export function HoldingLogo({ symbol, companyName, logoUrl, domain, size = 40 }: { symbol?: string; companyName?: string; logoUrl?: string | null; domain?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false)
  const resolved = useMemo(() => getCompanyLogoUrl({ symbol, logo_url: logoUrl, domain }), [symbol, logoUrl, domain])
  const text = useMemo(() => getFallbackInitials(symbol, companyName), [symbol, companyName])
  return (
    <div className='holdingLogo' style={{ width: size, height: size }}>
      {resolved && !failed ? <img src={resolved} alt={symbol || 'logo'} onError={() => setFailed(true)} loading='lazy' /> : <span>{text}</span>}
    </div>
  )
}

import React from 'react'

/**
 * Budgetly brand wordmark: a green gradient "app icon" squircle holding a
 * white upward trend line + arrow and a dot, followed by the Budgetly
 * wordmark. The icon is self-colored (constant brand green) so it reads
 * identically on light and dark surfaces; only the wordmark text uses
 * currentColor, rendering navy on the light sidebar and white on the dark
 * sidebar. Replaces the previous cursive-script wordmark.
 */
export function BrandWordmark({ showText = true }: { showText?: boolean }) {
  return (
    <span className="brandWordmark" role="img" aria-label="Budgetly">
      <svg className="brandWordmarkIcon" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="budgetlyBrandGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2fbf78" />
            <stop offset="1" stopColor="#1f9d63" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="44" height="44" rx="14" fill="url(#budgetlyBrandGrad)" />
        <polyline points="11,31 20,21 28,27 37,15" stroke="#ffffff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="29,14 38,13.5 37.5,23" stroke="#ffffff" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="24" cy="35" r="3.2" fill="#ffffff" />
      </svg>
      {showText ? <span className="brandWordmarkText">Budgetly</span> : null}
    </span>
  )
}

export default BrandWordmark

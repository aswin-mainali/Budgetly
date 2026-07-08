import React from 'react'

/**
 * Budgetly brand wordmark: a rounded "card" mark with a green upward trend
 * line + arrow and a dot, followed by the Budgetly wordmark. The primary
 * color (card outline + text) uses currentColor so the mark adapts to the
 * theme (navy on light surfaces, white on the dark sidebar); the green accent
 * stays constant. Replaces the previous cursive-script wordmark.
 */
export function BrandWordmark({ showText = true }: { showText?: boolean }) {
  return (
    <span className="brandWordmark" role="img" aria-label="Budgetly">
      <svg className="brandWordmarkIcon" viewBox="0 0 62 46" fill="none" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
        <rect x="3" y="6" width="47" height="34" rx="11" stroke="currentColor" strokeWidth="4" />
        <polyline points="13,30 22,22 29,27 40,16" stroke="var(--brand-accent)" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points="32,15 41,14 40.5,23" stroke="var(--brand-accent)" strokeWidth="4.4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="24.5" cy="33" r="4" fill="var(--brand-accent)" />
      </svg>
      {showText ? <span className="brandWordmarkText">Budgetly</span> : null}
    </span>
  )
}

export default BrandWordmark

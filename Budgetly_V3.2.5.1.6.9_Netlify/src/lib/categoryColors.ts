// Fixed categorical palette for category colors across the app.
// Hues are assigned in a fixed order (never hashed / cycled per-render) so the
// same category keeps the same color everywhere — donut, budgets list, etc.
// Palette validated for CVD separation + lightness band via the dataviz skill's
// validate_palette.js (worst adjacent CVD ΔE 24.2 on a white surface).

export type ThemeMode = 'light' | 'dark'

const PALETTE_LIGHT = [
  '#2a78d6', // blue
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
  '#e87ba4', // magenta
  '#eb6834', // orange
] as const

const PALETTE_DARK = [
  '#3987e5', // blue
  '#199e70', // aqua
  '#c98500', // yellow
  '#008300', // green
  '#9085e9', // violet
  '#e66767', // red
  '#d55181', // magenta
  '#d95926', // orange
] as const

// Neutral swatch for the "Uncategorized" bucket so it never impersonates a hue.
const UNCATEGORIZED_LIGHT = '#94a3b8'
const UNCATEGORIZED_DARK = '#64748b'

export const UNCATEGORIZED_ID = 'uncat'

export const categoryPalette = (theme: ThemeMode = 'light') =>
  theme === 'dark' ? PALETTE_DARK : PALETTE_LIGHT

export const uncategorizedColor = (theme: ThemeMode = 'light') =>
  theme === 'dark' ? UNCATEGORIZED_DARK : UNCATEGORIZED_LIGHT

/**
 * Build a stable id -> color map from an ordered list of category ids.
 * Order should be a stable ordering (e.g. sort_order) so colors don't shuffle.
 */
export function buildCategoryColorMap(orderedIds: string[], theme: ThemeMode = 'light'): Map<string, string> {
  const palette = categoryPalette(theme)
  const map = new Map<string, string>()
  let slot = 0
  for (const id of orderedIds) {
    if (id === UNCATEGORIZED_ID) {
      map.set(id, uncategorizedColor(theme))
      continue
    }
    map.set(id, palette[slot % palette.length])
    slot += 1
  }
  map.set(UNCATEGORIZED_ID, uncategorizedColor(theme))
  return map
}

/**
 * Resolve a color for a category id against the map, with a safe fallback.
 */
export function colorForCategory(id: string | null | undefined, map: Map<string, string>, theme: ThemeMode = 'light'): string {
  if (!id) return uncategorizedColor(theme)
  return map.get(id) ?? uncategorizedColor(theme)
}

// Status colors for budget progress fills. Reserved status hues (not categorical
// slots) so a status color never impersonates a category series.
const STATUS = {
  good: '#0ca30c',
  warning: '#f0a713',
  danger: '#d03b3b',
} as const

/** ratio = spent / budget (0..∞). green < 0.8, amber 0.8–1 (incl. at budget),
 *  red only when strictly over budget (ratio > 1). */
export function budgetStatusColor(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio <= 0) return STATUS.good
  if (ratio > 1) return STATUS.danger
  if (ratio >= 0.8) return STATUS.warning
  return STATUS.good
}

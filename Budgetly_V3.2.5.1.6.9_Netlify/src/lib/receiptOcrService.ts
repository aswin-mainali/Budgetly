import { ReceiptExtraction } from '../receiptsTypes'

const mapCategory = (merchant: string) => {
  const key = merchant.toLowerCase()
  if (key.includes('walmart') || key.includes('costco')) return 'Groceries'
  if (key.includes('shell')) return 'Gas'
  if (key.includes('starbucks')) return 'Dining Out'
  return 'Miscellaneous'
}

export const extractReceiptDetails = async (file: File): Promise<ReceiptExtraction> => {
  await new Promise((r) => setTimeout(r, 900))
  const merchant = file.name.split('.')[0].replace(/[-_]/g, ' ').trim() || 'Unknown Merchant'
  const failed = merchant.toLowerCase().includes('fail')
  if (failed) {
    return { merchant: '', receipt_date: new Date().toISOString().slice(0, 10), amount: 0, category: 'Miscellaneous', notes: '', confidence: 0.22, rawText: '', failed: true }
  }
  const amount = Number((Math.random() * 120 + 8).toFixed(2))
  return {
    merchant,
    receipt_date: new Date().toISOString().slice(0, 10),
    amount,
    category: mapCategory(merchant),
    notes: `Scanned from ${file.name}`,
    confidence: Math.min(0.96, Math.max(0.58, Math.random())),
    rawText: `merchant:${merchant}; total:${amount}`,
  }
}

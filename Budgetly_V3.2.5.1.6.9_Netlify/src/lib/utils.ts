export const fmtMoney = (n: number, currency = 'CAD') =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)

export const monthKey = (isoDate: string) => {
  const dt = new Date(isoDate)
  const y = dt.getFullYear()
  const m = String(dt.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export const monthLabel = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, 1)
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
}

export const safeCsv = (value: unknown) => {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export const download = (filename: string, content: string, mime = 'text/plain') => {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const pdfEscape = (value: string) => value
  .replace(/\\/g, '\\\\')
  .replace(/\(/g, '\\(')
  .replace(/\)/g, '\\)')

const pdfAscii = (value: string) => value.replace(/[^\x20-\x7E]/g, '?')

export const downloadPdfFromLines = (filename: string, pages: string[][]) => {
  const width = 612
  const height = 792
  const fontSize = 11
  const lineHeight = 15
  const left = 48
  const top = 64

  const objects: string[] = []
  const addObject = (body: string) => {
    objects.push(body)
    return objects.length
  }

  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  const pageEntries: string[] = []

  for (const pageLines of pages) {
    const commands = ['BT', `/F1 ${fontSize} Tf`]
    let y = height - top

    for (const rawLine of pageLines) {
      const safe = pdfEscape(pdfAscii(rawLine))
      commands.push(`1 0 0 1 ${left} ${y} Tm (${safe}) Tj`)
      y -= lineHeight
    }

    commands.push('ET')
    const stream = commands.join('\n')
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    pageEntries.push(`${pageId} 0 R`)
  }

  const pagesId = addObject(`<< /Type /Pages /Count ${pageEntries.length} /Kids [${pageEntries.join(' ')}] >>`)
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`)

  for (let index = 0; index < objects.length; index += 1) {
    if (objects[index].includes('/Parent 0 0 R')) {
      objects[index] = objects[index].replace('/Parent 0 0 R', `/Parent ${pagesId} 0 R`)
    }
  }

  let pdf = '%PDF-1.4\n%âãÏÓ\n'
  const offsets: number[] = [0]

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(new TextEncoder().encode(pdf).length)
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }

  const xrefOffset = new TextEncoder().encode(pdf).length
  pdf += `xref\n0 ${objects.length + 1}\n`
  pdf += '0000000000 65535 f \n'
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  const blob = new Blob([pdf], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}



export const downloadPdfFromJpeg = (filename: string, dataUrl: string, imageWidth: number, imageHeight: number) => {
  const base64 = dataUrl.split(',')[1] ?? ''
  const binary = atob(base64)
  const imageBytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) imageBytes[index] = binary.charCodeAt(index)

  const pageWidth = 595.28
  const pageHeight = 841.89
  const margin = 0
  const targetWidth = pageWidth - margin * 2
  const targetHeight = pageHeight - margin * 2
  const scale = Math.min(targetWidth / imageWidth, targetHeight / imageHeight)
  const renderWidth = imageWidth * scale
  const renderHeight = imageHeight * scale
  const x = (pageWidth - renderWidth) / 2
  const y = (pageHeight - renderHeight) / 2

  const contentStream = `q\n${renderWidth.toFixed(2)} 0 0 ${renderHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ`
  const encoder = new TextEncoder()
  const ascii = (value: string) => encoder.encode(value)

  const imageObjectParts = [
    ascii(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`),
    imageBytes,
    ascii(`\nendstream`),
  ]

  const objects: Uint8Array[] = [new Uint8Array(), new Uint8Array(), new Uint8Array(), new Uint8Array(), new Uint8Array()]

  const concatBytes = (parts: Uint8Array[]) => {
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const output = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      output.set(part, offset)
      offset += part.length
    }
    return output
  }

  objects[0] = concatBytes(imageObjectParts)
  objects[1] = ascii(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`)
  objects[2] = ascii(`<< /Type /Page /Parent 4 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 1 0 R >> >> /Contents 2 0 R >>`)
  objects[3] = ascii(`<< /Type /Pages /Kids [3 0 R] /Count 1 >>`)
  objects[4] = ascii(`<< /Type /Catalog /Pages 4 0 R >>`)

  const header = ascii('%PDF-1.4\n')
  const objectChunks: Uint8Array[] = [header]
  const offsets: number[] = [0]
  let cursor = header.length

  objects.forEach((objectBytes, index) => {
    offsets.push(cursor)
    const objectHeader = ascii(`${index + 1} 0 obj\n`)
    const objectFooter = ascii(`\nendobj\n`)
    objectChunks.push(objectHeader, objectBytes, objectFooter)
    cursor += objectHeader.length + objectBytes.length + objectFooter.length
  })

  const xrefOffset = cursor
  const xrefEntries = ['0000000000 65535 f ']
  offsets.slice(1).forEach((offset) => xrefEntries.push(`${offset.toString().padStart(10, '0')} 00000 n `))
  const xref = ascii(`xref\n0 ${objects.length + 1}\n${xrefEntries.join('\n')}\n`)
  const trailer = ascii(`trailer\n<< /Size ${objects.length + 1} /Root 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)
  const pdfBytes = concatBytes([...objectChunks, xref, trailer])

  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}


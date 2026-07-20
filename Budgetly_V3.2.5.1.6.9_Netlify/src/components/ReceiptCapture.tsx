import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Camera, ScanLine, Sparkles, RotateCcw, Upload, Check, AlertTriangle,
  Loader2, ImageOff,
} from 'lucide-react'

/** Result shape returned by the /api/receipt-scan function (see netlify/functions/receipt-scan.ts). */
export type ReceiptScan = {
  merchant: string
  amount: number | null
  date: string
  type: 'expense' | 'income'
  category: string
  note: string
  currency: string
  lineItems: Array<{ name: string; price: number }>
  confidence: number | null
}

const MAX_DIM = 1600
const JPEG_QUALITY = 0.72

/** Draw an image element onto a downscaled canvas and export a compressed JPEG
 *  data URL. Keeping receipts small matters: the whole transactions array is
 *  re-upserted on autosave, so a multi-MB image per row would be very heavy. */
const compressToDataUrl = (source: HTMLImageElement | HTMLVideoElement, w: number, h: number): string => {
  const scale = Math.min(1, MAX_DIM / Math.max(w, h))
  const cw = Math.round(w * scale)
  const ch = Math.round(h * scale)
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(source, 0, 0, cw, ch)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const out = compressToDataUrl(img, img.naturalWidth, img.naturalHeight)
      URL.revokeObjectURL(url)
      out ? resolve(out) : reject(new Error('compress_failed'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load_failed')) }
    img.src = url
  })

type Phase = 'camera' | 'preview' | 'scanning' | 'error'

export function ReceiptCapture({
  open, currency, categoryNames, onClose, onExtracted,
}: {
  open: boolean
  currency: string
  categoryNames: string[]
  onClose: () => void
  /** Called once the user accepts. `scan` is null when the scan failed but the
   *  user chose to attach the photo and fill the form manually. */
  onExtracted: (receiptDataUrl: string, scan: ReceiptScan | null) => void
}) {
  const [phase, setPhase] = useState<Phase>('camera')
  const [image, setImage] = useState<string | null>(null)
  const [cameraError, setCameraError] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const startCamera = useCallback(async () => {
    setCameraError(false)
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError(true); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } }, audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
    } catch {
      setCameraError(true)
    }
  }, [])

  // Reset + wire up the camera whenever the modal opens.
  useEffect(() => {
    if (!open) return
    setPhase('camera')
    setImage(null)
    setErrorMsg('')
    void startCamera()
    document.body.classList.add('txp-drawer-lock')
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('txp-drawer-lock')
      stopStream()
    }
  }, [open, startCamera, stopStream, onClose])

  const capturePhoto = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const dataUrl = compressToDataUrl(video, video.videoWidth, video.videoHeight)
    if (!dataUrl) return
    stopStream()
    setImage(dataUrl)
    setPhase('preview')
  }

  const handleFile = async (file: File) => {
    try {
      const dataUrl = await fileToDataUrl(file)
      stopStream()
      setImage(dataUrl)
      setPhase('preview')
    } catch {
      setErrorMsg('That image could not be read. Try another photo.')
      setPhase('error')
    }
  }

  const retake = () => {
    setImage(null)
    setErrorMsg('')
    setPhase('camera')
    void startCamera()
  }

  const scan = async () => {
    if (!image) return
    setPhase('scanning')
    try {
      const res = await fetch('/api/receipt-scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          image,
          mediaType: 'image/jpeg',
          categories: categoryNames,
          currency,
          today: new Date().toISOString().slice(0, 10),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const code = (body as { error?: string }).error
        setErrorMsg(
          res.status === 429 ? 'Too many scans right now — wait a moment and try again.'
            : code === 'service_unavailable' ? 'Receipt scanning isn’t configured on this server yet.'
            : code === 'could_not_read_receipt' ? 'Couldn’t read that as a receipt. Retake or enter it manually.'
            : 'The scan failed. You can retake the photo or fill it in manually.',
        )
        setPhase('error')
        return
      }
      const body = await res.json() as { ok?: boolean; data?: ReceiptScan }
      if (!body.ok || !body.data) { setErrorMsg('The scan failed. Try again or enter it manually.'); setPhase('error'); return }
      onExtracted(image, body.data)
    } catch {
      setErrorMsg('Network error while scanning. Check your connection and try again.')
      setPhase('error')
    }
  }

  // "Use anyway": attach the photo but let the user fill the form manually.
  const useWithoutScan = () => { if (image) onExtracted(image, null) }

  if (!open) return null

  return createPortal(
    <div className="rc-root" role="dialog" aria-modal="true" aria-label="Scan a receipt">
      <div className="rc-backdrop" onClick={onClose} aria-hidden="true" />
      <div className="rc-panel">
        <header className="rc-head">
          <div className="rc-head-title">
            <span className="rc-head-icon"><ScanLine size={18} aria-hidden="true" /></span>
            <div>
              <h2>Scan a receipt</h2>
              <p>Snap a photo and we’ll fill in the details for you.</p>
            </div>
          </div>
          <button type="button" className="rc-close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); if (fileInputRef.current) fileInputRef.current.value = '' }}
        />

        <div className="rc-stage">
          {phase === 'camera' ? (
            cameraError ? (
              <div className="rc-fallback">
                <div className="rc-fallback-icon"><ImageOff size={30} aria-hidden="true" /></div>
                <h3>Camera unavailable</h3>
                <p>We couldn’t open a camera here. Upload a photo of your receipt instead.</p>
                <button type="button" className="rc-btn rc-btn-primary" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={16} aria-hidden="true" /> <span>Upload a photo</span>
                </button>
              </div>
            ) : (
              <>
                <div className="rc-viewport">
                  <video ref={videoRef} className="rc-video" playsInline muted aria-label="Camera preview" />
                  <div className="rc-guide" aria-hidden="true">
                    <span className="rc-corner tl" /><span className="rc-corner tr" />
                    <span className="rc-corner bl" /><span className="rc-corner br" />
                  </div>
                </div>
                <div className="rc-controls">
                  <button type="button" className="rc-icon-btn" onClick={() => fileInputRef.current?.click()} aria-label="Upload a photo instead">
                    <Upload size={20} aria-hidden="true" />
                  </button>
                  <button type="button" className="rc-shutter" onClick={capturePhoto} aria-label="Take photo">
                    <span className="rc-shutter-ring"><Camera size={22} aria-hidden="true" /></span>
                  </button>
                  <span className="rc-controls-spacer" aria-hidden="true" />
                </div>
              </>
            )
          ) : null}

          {(phase === 'preview' || phase === 'scanning') && image ? (
            <>
              <div className={`rc-viewport ${phase === 'scanning' ? 'scanning' : ''}`}>
                <img src={image} className="rc-shot" alt="Captured receipt" />
                {phase === 'scanning' ? (
                  <>
                    <span className="rc-scanline" aria-hidden="true" />
                    <div className="rc-scan-overlay">
                      <span className="rc-scan-badge"><Sparkles size={15} aria-hidden="true" /> Reading receipt…</span>
                    </div>
                  </>
                ) : null}
              </div>
              {phase === 'preview' ? (
                <div className="rc-actions">
                  <button type="button" className="rc-btn rc-btn-ghost" onClick={retake}>
                    <RotateCcw size={16} aria-hidden="true" /> <span>Retake</span>
                  </button>
                  <button type="button" className="rc-btn rc-btn-primary" onClick={scan}>
                    <Sparkles size={16} aria-hidden="true" /> <span>Scan receipt</span>
                  </button>
                </div>
              ) : (
                <div className="rc-scan-steps" aria-live="polite">
                  <span className="rc-step"><Loader2 size={14} className="rc-spin" aria-hidden="true" /> Detecting merchant, total &amp; date…</span>
                </div>
              )}
            </>
          ) : null}

          {phase === 'error' ? (
            <div className="rc-fallback">
              <div className="rc-fallback-icon warn"><AlertTriangle size={30} aria-hidden="true" /></div>
              <h3>Scan didn’t work</h3>
              <p>{errorMsg}</p>
              <div className="rc-actions">
                <button type="button" className="rc-btn rc-btn-ghost" onClick={retake}>
                  <RotateCcw size={16} aria-hidden="true" /> <span>Retake</span>
                </button>
                {image ? (
                  <button type="button" className="rc-btn rc-btn-primary" onClick={useWithoutScan}>
                    <Check size={16} aria-hidden="true" /> <span>Enter manually</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Full-screen viewer for a stored receipt image. */
export function ReceiptViewer({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('txp-drawer-lock')
    return () => { document.removeEventListener('keydown', onKey); document.body.classList.remove('txp-drawer-lock') }
  }, [onClose])

  return createPortal(
    <div className="rc-viewer-root" role="dialog" aria-modal="true" aria-label="Receipt image" onClick={onClose}>
      <button type="button" className="rc-viewer-close" onClick={onClose} aria-label="Close">
        <X size={20} aria-hidden="true" />
      </button>
      <img src={src} className="rc-viewer-img" alt="Receipt" onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  )
}

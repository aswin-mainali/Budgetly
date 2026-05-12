import React, { useEffect, useMemo, useState } from 'react'

type Step = { title: string; description: string; selector: string }

export default function WelcomeTour({ open, steps, onClose, onStepChange }: { open: boolean; steps: Step[]; onClose: (completed: boolean) => void; onStepChange: (index: number) => void }) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  const step = steps[index]

  useEffect(() => { if (open) setIndex(0) }, [open])
  useEffect(() => { onStepChange(index) }, [index, onStepChange])

  useEffect(() => {
    if (!open) return
    const run = () => {
      const el = document.querySelector(step.selector) as HTMLElement | null
      if (!el) return
      setRect(el.getBoundingClientRect())
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
    const t = window.setTimeout(run, 180)
    window.addEventListener('resize', run)
    return () => { window.clearTimeout(t); window.removeEventListener('resize', run) }
  }, [open, step])

  const cardStyle = useMemo(() => {
    if (!rect) return { top: 120, left: 220 }
    const width = 340
    const placeRight = rect.right + width + 40 < window.innerWidth
    return { top: Math.max(20, rect.top), left: placeRight ? rect.right + 18 : Math.max(16, rect.left - width - 18) }
  }, [rect])

  if (!open || !rect) return null

  return <>
    <div className="tourOverlay" />
    <div className="tourHighlight" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}>
      <span className="tourBadge">{index + 1}</span>
    </div>
    <div className="tourCard" style={cardStyle}>
      <span className="tourStepPill">Step {index + 1} of {steps.length}</span>
      <h3>{step.title}</h3>
      <p>{step.description}</p>
      <div className="tourProgress"><span style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
      <div className="tourActions">
        <button className="btn ghost" onClick={() => onClose(false)}>Skip</button>
        <div>
          {index > 0 ? <button className="btn" onClick={() => setIndex((v) => v - 1)}>Back</button> : null}
          {index < steps.length - 1 ? <button className="btn primary" onClick={() => setIndex((v) => v + 1)}>Next</button> : <button className="btn primary" onClick={() => onClose(true)}>Finish</button>}
        </div>
      </div>
    </div>
  </>
}

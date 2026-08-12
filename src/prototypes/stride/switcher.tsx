/**
 * PROTOTYPE — throwaway. The floating bar: cycle the fixture projects with the arrows or ← / →.
 * The selection lives in the URL, so a state is shareable and survives reload. Never rendered in
 * a production build.
 */

import { useEffect } from 'react'

interface SwitcherProps {
  labels: string[]
  current: number
  onSelect: (index: number) => void
}

export function ProjectSwitcher({ labels, current, onSelect }: SwitcherProps) {
  const step = (delta: number) => {
    onSelect((current + delta + labels.length) % labels.length)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLElement) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      }
      if (event.key === 'ArrowLeft') step(-1)
      if (event.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (import.meta.env.PROD) return null

  return (
    <div className="proto-switch">
      <button type="button" onClick={() => step(-1)} aria-label="Previous project">
        ←
      </button>
      <span className="label">the flagline — {labels[current]}</span>
      <button type="button" onClick={() => step(1)} aria-label="Next project">
        →
      </button>
    </div>
  )
}

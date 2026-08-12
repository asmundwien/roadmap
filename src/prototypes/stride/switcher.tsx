/**
 * PROTOTYPE — throwaway. The floating bar: cycle variants with the arrows or ← / →, and jump the
 * screen pane between fixture projects. Both live in the URL, so a take is shareable and survives
 * reload. Never rendered in a production build.
 */

import { useEffect } from 'react'

interface SwitcherProps {
  variants: string[]
  current: string
  name: string
  projectLabel: string
  onVariant: (variant: string) => void
  onNextProject: () => void
}

export function PrototypeSwitcher({
  variants,
  current,
  name,
  projectLabel,
  onVariant,
  onNextProject,
}: SwitcherProps) {
  const step = (delta: number) => {
    const at = variants.indexOf(current)
    const next = variants[(at + delta + variants.length) % variants.length]
    if (next) onVariant(next)
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
      <button type="button" onClick={() => step(-1)} aria-label="Previous variant">
        ←
      </button>
      <span className="label">
        {current} — {name}
      </span>
      <button type="button" onClick={() => step(1)} aria-label="Next variant">
        →
      </button>
      <span className="sep" />
      <button type="button" onClick={onNextProject}>
        {projectLabel}
      </button>
    </div>
  )
}

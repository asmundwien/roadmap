import { useEffect, useSyncExternalStore } from 'react'
import './prototype-map.css'

/**
 * PROTOTYPE — throwaway. The floating variant bar for the single-map representation rework:
 * `?variant=` (alongside the hash route) picks a rendering, arrows and ←/→ cycle it, and the
 * bare URL stays the production rendering. Dev-only; a stray merge renders nothing in prod.
 */

export type PrototypeVariant = 'current' | 'C'

const VARIANTS: PrototypeVariant[] = ['current', 'C']

const LABELS: Record<PrototypeVariant, string> = {
  current: 'Current — asides in the road',
  C: 'C — titles only · drawer details',
}

const CHANGE_EVENT = 'prototype-variant'

/**
 * The one URL writer: every piece of prototype state lives in the URL — no useState mirrors.
 * Mutate query and/or hash in one replaceState, then wake both subscription worlds: the hash
 * router's `useRoute` and the query-param hooks below.
 */
export function writePrototypeUrl(mutate: (url: URL) => void): void {
  const url = new URL(window.location.href)
  mutate(url)
  window.history.replaceState(null, '', url)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

/** A live view of one query param — the URL is the store, this is the subscription. */
export function usePrototypeParam(name: string): string | null {
  return useSyncExternalStore(subscribe, () =>
    new URLSearchParams(window.location.search).get(name),
  )
}

function readVariant(): PrototypeVariant {
  const raw = new URLSearchParams(window.location.search).get('variant')
  return raw === 'C' ? raw : 'current'
}

function setVariant(variant: PrototypeVariant): void {
  writePrototypeUrl((url) => {
    if (variant === 'current') url.searchParams.delete('variant')
    else url.searchParams.set('variant', variant)
  })
}

function cycle(delta: number): void {
  const at = VARIANTS.indexOf(readVariant())
  const next = VARIANTS[(at + delta + VARIANTS.length) % VARIANTS.length]
  if (next !== undefined) setVariant(next)
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('popstate', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('popstate', onChange)
  }
}

export function usePrototypeVariant(): PrototypeVariant {
  const variant = useSyncExternalStore(subscribe, readVariant)
  return import.meta.env.DEV ? variant : 'current'
}

export function PrototypeSwitcher() {
  const variant = usePrototypeVariant()

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      // Cycle only when nothing has focus — arrows inside the page belong to the page's own
      // navigation (the docked panel's navbar unit), never to this dev bar.
      if (event.target !== document.body) return
      cycle(event.key === 'ArrowRight' ? 1 : -1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!import.meta.env.DEV) return null

  return (
    <div className="pfl-switcher">
      <button type="button" aria-label="previous variant" onClick={() => cycle(-1)}>
        ←
      </button>
      <span className="pfl-switcher-label">{LABELS[variant]}</span>
      <button type="button" aria-label="next variant" onClick={() => cycle(1)}>
        →
      </button>
    </div>
  )
}

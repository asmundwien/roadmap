/**
 * PROTOTYPE — throwaway. Three variants of the map view on one route, switchable via `?variant=`.
 *
 * Answers issue #3: what should the map view look like? The three disagree about what space is for —
 * A spends it on dependency order, B on how much is known, C refuses to spend it at all. Runs off
 * fixtures, not the live store, so it needs no token.
 */

import { useEffect, useState } from 'react'
import { FIXTURE_MAPS } from './fixture.ts'
import { PrototypeSwitcher } from './switcher.tsx'
import { NAME as NAME_A, VariantA } from './variant-a-subway.tsx'
import { NAME as NAME_B, VariantB } from './variant-b-terrain.tsx'
import { NAME as NAME_C, VariantC } from './variant-c-briefing.tsx'
import './prototype.css'

const VARIANTS = {
  A: { name: NAME_A, render: VariantA },
  B: { name: NAME_B, render: VariantB },
  C: { name: NAME_C, render: VariantC },
} as const

type VariantKey = keyof typeof VARIANTS
const KEYS = Object.keys(VARIANTS) as VariantKey[]

function readParams() {
  const params = new URLSearchParams(window.location.search)
  const variant = params.get('variant')?.toUpperCase() ?? ''
  const mapIndex = Number(params.get('map') ?? 0)
  return {
    variant: KEYS.find((k) => k === variant) ?? 'A',
    mapIndex: Number.isInteger(mapIndex) && FIXTURE_MAPS[mapIndex] ? mapIndex : 0,
  }
}

/** True when the URL asks for the prototype at all — `?variant=` is the switch. */
export function isPrototypeRequested(): boolean {
  return new URLSearchParams(window.location.search).has('variant')
}

export function MapViewPrototype() {
  const [{ variant, mapIndex }, setParams] = useState(readParams)

  useEffect(() => {
    const onPop = () => setParams(readParams())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = (next: { variant: VariantKey; mapIndex: number }) => {
    const params = new URLSearchParams(window.location.search)
    params.set('variant', next.variant)
    params.set('map', String(next.mapIndex))
    window.history.replaceState(null, '', `?${params.toString()}`)
    setParams(next)
  }

  const map = FIXTURE_MAPS[mapIndex] ?? FIXTURE_MAPS[0]
  if (!map) return <p>No fixture maps.</p>
  const Render = VARIANTS[variant].render

  return (
    <div className="proto">
      <Render map={map} />
      <PrototypeSwitcher
        variants={KEYS}
        current={variant}
        name={VARIANTS[variant].name}
        mapLabel={`${map.repo} · ${map.tickets.length} tickets`}
        onVariant={(next) => {
          const key = KEYS.find((k) => k === next)
          if (key) navigate({ variant: key, mapIndex })
        }}
        onNextMap={() => navigate({ variant, mapIndex: (mapIndex + 1) % FIXTURE_MAPS.length })}
      />
    </div>
  )
}

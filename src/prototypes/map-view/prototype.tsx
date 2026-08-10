/**
 * PROTOTYPE — throwaway. Round two of the map view on one route, switchable via `?variant=`.
 *
 * Answers issue #3: what should the map view look like? Round one (A subway / B terrain / C
 * briefing) was vetoed whole — each read as an adjacent genre — and lives in git history as the
 * evidence. Round two is one take per journey grammar the research shortlisted: D the ascent
 * (campaign-route composite), E the scroll (itinerary strip map), F the country (fog of war as the
 * frame). All three are judged against the success criteria in issue #10 before any reaction. Runs
 * off fixtures, not the live store, so it needs no token.
 */

import { useEffect, useState } from 'react'
import { FIXTURE_MAPS } from './fixture.ts'
import { PrototypeSwitcher } from './switcher.tsx'
import { NAME as NAME_D, VariantD } from './variant-d-ascent.tsx'
import { NAME as NAME_E, VariantE } from './variant-e-scroll.tsx'
import { NAME as NAME_F, VariantF } from './variant-f-country.tsx'
import './prototype.css'

const VARIANTS = {
  D: { name: NAME_D, render: VariantD },
  E: { name: NAME_E, render: VariantE },
  F: { name: NAME_F, render: VariantF },
} as const

type VariantKey = keyof typeof VARIANTS
const KEYS = Object.keys(VARIANTS) as VariantKey[]

function readParams() {
  const params = new URLSearchParams(window.location.search)
  const variant = params.get('variant')?.toUpperCase() ?? ''
  const mapIndex = Number(params.get('map') ?? 0)
  return {
    variant: KEYS.find((k) => k === variant) ?? 'D',
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

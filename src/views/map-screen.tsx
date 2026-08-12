import { useEffect, useState } from 'react'
import type { Route } from '../router.ts'
import { useRoadmap } from '../store/roadmap-provider.tsx'
import type { WayfinderMap } from '../wayfinder/types.ts'
import { stripInlineMarkdown } from './gist.ts'
import { MapLedger } from './map/ledger.tsx'
import { LEGEND_ORDER, STATE_META } from './map/state-meta.ts'
import './views.css'

/**
 * The map screen: the story of the road, not a work-picker. The ledger carries the journey —
 * destination, fog, the charted braid, ground covered — so this shell only adds what lives around
 * it: the header with the live "updated" pulse and legend, honesty about partial data, and the
 * map body's Notes and Out of scope a click away.
 */
export function MapScreen({ route }: { route: Extract<Route, { screen: 'map' }> }) {
  const { status, projects, error, lastUpdatedAt } = useRoadmap()

  const map = projects
    .flatMap((project) => [...project.openMaps, ...project.closedMaps])
    .find(
      (candidate) =>
        candidate.owner === route.owner &&
        candidate.repo === route.repo &&
        candidate.number === route.number,
    )

  return (
    <main className="shell map-shell">
      <p>
        <a href="#/">← All projects</a>
      </p>

      {error !== null && (
        <p className="banner" role="alert">
          {error}
          {map && ' — showing the last good snapshot.'}
        </p>
      )}

      {!map && (
        <p className="muted">
          {status === 'ready'
            ? `No map at ${route.owner}/${route.repo}#${route.number}.`
            : 'Loading…'}
        </p>
      )}

      {map && (
        <>
          <MapHead map={map} lastUpdatedAt={lastUpdatedAt} />
          <MapLedger map={map} />
          <MapAsides map={map} />
        </>
      )}
    </main>
  )
}

function MapHead({ map, lastUpdatedAt }: { map: WayfinderMap; lastUpdatedAt: number | null }) {
  const partial = map.ticketsTruncated || map.tickets.some((ticket) => ticket.blockersTruncated)

  return (
    <header className="map-head">
      <p className="muted small map-eyebrow">
        {map.nameWithOwner} · #{map.number}
        {!map.isOpen && ' · closed'}
      </p>
      <h1>
        <a href={map.url}>{map.title}</a>
      </h1>
      <div className="map-meta muted small">
        <UpdatedPulse at={lastUpdatedAt} />
        {LEGEND_ORDER.map((state) => (
          <span key={state} className="legend-item">
            <i aria-hidden="true" style={{ color: STATE_META[state].color }}>
              {STATE_META[state].glyph}
            </i>{' '}
            {STATE_META[state].word} ·{' '}
            {map.tickets.filter((ticket) => ticket.state === state).length}
          </span>
        ))}
      </div>
      {partial && (
        <p className="muted small">
          Partial view — GitHub returned only the first page of{' '}
          {map.ticketsTruncated ? 'tickets' : 'some tickets’ blockers'}.
        </p>
      )}
    </header>
  )
}

function UpdatedPulse({ at }: { at: number | null }) {
  const now = useNow(10_000)
  if (at === null) return null
  return (
    <span>
      <i key={at} className="pulse-dot" aria-hidden="true" /> {freshness(at, now)}
    </span>
  )
}

function freshness(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 15) return 'updated just now'
  if (seconds < 90) return `updated ${seconds}s ago`
  return `updated ${Math.round(seconds / 60)}m ago`
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}

/** The click-away tier: Notes and Out of scope, plus the drift signal if the body has one. */
function MapAsides({ map }: { map: WayfinderMap }) {
  return (
    <footer>
      {map.body.notes.length > 0 && (
        <details className="map-aside">
          <summary>Notes</summary>
          <ul>
            {map.body.notes.map((note) => (
              <li key={note}>{stripInlineMarkdown(note)}</li>
            ))}
          </ul>
        </details>
      )}
      {map.body.outOfScope.length > 0 && (
        <details className="map-aside">
          <summary>Out of scope</summary>
          <ul>
            {map.body.outOfScope.map((item) => (
              <li key={item}>{stripInlineMarkdown(item)}</li>
            ))}
          </ul>
        </details>
      )}
      {map.body.missingSections.length > 0 && (
        <p className="muted small">
          Map body is missing sections: {map.body.missingSections.join(', ')}.
        </p>
      )}
    </footer>
  )
}

/**
 * PROTOTYPE — throwaway. The collapsed stride and the project card (issue #12), on one page,
 * switchable via `?variant=`.
 *
 * Two questions, judged together: what does a collapsed map render as in the project screen's
 * accordion, and is the front-page card the same component at a second density or its own shape?
 * The page shows both surfaces at once — the front page above, the project screen below — so a
 * variant's answer to "miniature or not" is visible in one scroll. Clicking a card points the
 * screen pane at that project; the switcher also cycles projects. Runs off fixtures, not the live
 * store, so it needs no token.
 */

import { useEffect, useState } from 'react'
import { FIXTURE_PROJECTS } from './fixture.ts'
import { PrototypeSwitcher } from './switcher.tsx'
import { CardA, NAME as NAME_A, ScreenA } from './variant-a-milestones.tsx'
import { CardB, NAME as NAME_B, ScreenB } from './variant-b-chronicle.tsx'
import { CardC, NAME as NAME_C, ScreenC } from './variant-c-strata.tsx'
import type { Variant } from './variants.ts'
import './prototype.css'

const VARIANTS: Record<string, Variant> = {
  A: { name: NAME_A, Screen: ScreenA, Card: CardA },
  B: { name: NAME_B, Screen: ScreenB, Card: CardB },
  C: { name: NAME_C, Screen: ScreenC, Card: CardC },
}
const KEYS = Object.keys(VARIANTS)

function readParams() {
  const params = new URLSearchParams(window.location.search)
  const variant = params.get('variant')?.toUpperCase() ?? ''
  const projectIndex = Number(params.get('project') ?? 0)
  return {
    variant: KEYS.find((k) => k === variant) ?? 'A',
    projectIndex:
      Number.isInteger(projectIndex) && FIXTURE_PROJECTS[projectIndex] ? projectIndex : 0,
  }
}

/** True when the URL asks for the prototype at all — `?variant=` is the switch. */
export function isPrototypeRequested(): boolean {
  return new URLSearchParams(window.location.search).has('variant')
}

export function StridePrototype() {
  const [{ variant, projectIndex }, setParams] = useState(readParams)
  const [openMap, setOpenMap] = useState<number | null>(null)

  useEffect(() => {
    const onPop = () => setParams(readParams())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const project = FIXTURE_PROJECTS[projectIndex] ?? FIXTURE_PROJECTS[0]
  if (!project) return <p>No fixture projects.</p>

  // The single-open accordion default: the active map open, a resting project fully collapsed.
  const effectiveOpen = openMap ?? project.active?.number ?? null

  const navigate = (next: { variant: string; projectIndex: number }) => {
    const params = new URLSearchParams(window.location.search)
    params.set('variant', next.variant)
    params.set('project', String(next.projectIndex))
    window.history.replaceState(null, '', `?${params.toString()}`)
    setParams(next)
    if (next.projectIndex !== projectIndex) setOpenMap(null)
  }

  const spec = VARIANTS[variant] ?? VARIANTS.A
  if (!spec) return null

  return (
    <div className="proto">
      <main className="shell proto-shell">
        <p className="muted small proto-note">
          Prototype — issue #12. Above: the front page as this variant draws it. Below: the project
          screen for <strong>{project.repo}</strong>. Click a card to point the screen at it; click
          a stride to open it.
        </p>

        <section className="proto-front">
          <h1 className="proto-h">front page</h1>
          <div className="proto-cards">
            {FIXTURE_PROJECTS.map((p, i) => (
              <spec.Card
                key={p.nameWithOwner}
                project={p}
                onOpen={() => {
                  navigate({ variant, projectIndex: i })
                  document.querySelector('.proto-screen')?.scrollIntoView({ behavior: 'smooth' })
                }}
              />
            ))}
          </div>
        </section>

        <section className="proto-screen">
          <h1 className="proto-h">
            project screen — {project.repo}{' '}
            <span className="muted proto-scenario">({project.scenario})</span>
          </h1>
          <spec.Screen
            project={project}
            openMap={effectiveOpen}
            // -1 = explicitly nothing open (folding the default), and never a real map number
            onToggle={(n) => setOpenMap(effectiveOpen === n ? -1 : n)}
          />
        </section>
      </main>

      <PrototypeSwitcher
        variants={KEYS}
        current={variant}
        name={spec.name}
        projectLabel={`${project.repo} · ${project.scenario}`}
        onVariant={(next) => navigate({ variant: next, projectIndex })}
        onNextProject={() =>
          navigate({ variant, projectIndex: (projectIndex + 1) % FIXTURE_PROJECTS.length })
        }
      />
    </div>
  )
}

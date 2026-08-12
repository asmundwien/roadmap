/**
 * PROTOTYPE — throwaway. The collapsed stride and the project card (issue #12), round three:
 * one design — THE FLAGLINE — after the round-two reaction picked A's rail and the research
 * picked destination-as-header. The switcher now cycles the four fixture projects; `?variant=`
 * stays as the URL gate so existing links keep working.
 */

import { useEffect, useState } from 'react'
import { FIXTURE_PROJECTS } from './fixture.ts'
import { FlaglineCard, FlaglineScreen } from './flagline.tsx'
import { ProjectSwitcher } from './switcher.tsx'
import './prototype.css'

function readProjectIndex(): number {
  const params = new URLSearchParams(window.location.search)
  const index = Number(params.get('project') ?? 0)
  return Number.isInteger(index) && FIXTURE_PROJECTS[index] ? index : 0
}

/** True when the URL asks for the prototype at all — `?variant=` is the switch. */
export function isPrototypeRequested(): boolean {
  return new URLSearchParams(window.location.search).has('variant')
}

export function StridePrototype() {
  const [projectIndex, setProjectIndex] = useState(readProjectIndex)
  const [openMap, setOpenMap] = useState<number | null>(null)

  useEffect(() => {
    const onPop = () => setProjectIndex(readProjectIndex())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const project = FIXTURE_PROJECTS[projectIndex] ?? FIXTURE_PROJECTS[0]
  if (!project) return <p>No fixture projects.</p>

  // The single-open default: the active map's graph unfolded, a resting project fully collapsed.
  const effectiveOpen = openMap ?? project.active?.number ?? null

  const selectProject = (index: number) => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('variant')) params.set('variant', 'A')
    params.set('project', String(index))
    window.history.replaceState(null, '', `?${params.toString()}`)
    setProjectIndex(index)
    if (index !== projectIndex) setOpenMap(null)
  }

  return (
    <div className="proto">
      <main className="shell proto-shell">
        <p className="muted small proto-note">
          Prototype — issue #12, round three: the flagline. Above: the front page. Below: the
          project screen for <strong>{project.repo}</strong>, newest map first, each map led by its
          destination flag — click a flag block to unfold its graph; click a card to point the
          screen at that project.
        </p>

        <section className="proto-front">
          <h1 className="proto-h">front page</h1>
          <div className="proto-cards">
            {FIXTURE_PROJECTS.map((p, i) => (
              <FlaglineCard
                key={p.nameWithOwner}
                project={p}
                onOpen={() => {
                  selectProject(i)
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
          <FlaglineScreen
            project={project}
            openMap={effectiveOpen}
            // -1 = explicitly nothing open (folding the default), and never a real map number
            onToggle={(n) => setOpenMap(effectiveOpen === n ? -1 : n)}
          />
        </section>
      </main>

      <ProjectSwitcher
        labels={FIXTURE_PROJECTS.map((p) => `${p.repo} · ${p.scenario}`)}
        current={projectIndex}
        onSelect={selectProject}
      />
    </div>
  )
}

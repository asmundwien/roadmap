import type { WayfinderMap } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { resolveProseLink } from './link-targets.ts'

const ROOT = '/Users/asmund.wien/source/hdir/platform/microsoft-risiko'

function makeMap(): WayfinderMap {
  return {
    project: { integration: 'local', id: 'microsoft-risiko' },
    id: '.wayfinder/map.md',
    title: 'Microsoft Risiko',
    isOpen: true,
    updatedAt: 0,
    body: {
      raw: '',
      destination: '',
      notes: [],
      decisions: [],
      notYetSpecified: [],
      notYetSpecifiedNote: '',
      outOfScope: [],
      sections: [],
      missingSections: [],
    },
    tickets: [
      {
        id: '2',
        displayId: '2',
        title: 'Scroll story',
        body: '',
        typeEvidence: { kind: 'recognized', value: 'research', labels: ['research'] },
        state: 'closed',
        isClaimed: false,
        isBlocked: false,
        assignees: [],
        blockedBy: [],
        blockersComplete: true,
        warnings: [],
        sourcePath: `${ROOT}/.wayfinder/tickets/02-re-story-for-scroll.md`,
      },
      {
        id: '16',
        displayId: '16',
        title: 'Landing orientation',
        body: '',
        typeEvidence: { kind: 'recognized', value: 'task', labels: ['task'] },
        state: 'frontier',
        isClaimed: false,
        isBlocked: false,
        assignees: [],
        blockedBy: [],
        blockersComplete: true,
        warnings: [],
        sourcePath: `${ROOT}/.wayfinder/tickets/16-landing-orientation.md`,
      },
    ],
    frontier: [],
    progress: { total: 2, completed: 1 },
    ticketsComplete: true,
    warnings: [],
    sourcePath: `${ROOT}/.wayfinder/map.md`,
  }
}

describe('resolveProseLink', () => {
  it('turns a map decision link into an on-map ticket selection', () => {
    expect(
      resolveProseLink(makeMap(), `${ROOT}/.wayfinder/map.md`, 'tickets/02-re-story-for-scroll.md'),
    ).toEqual({
      kind: 'selection',
      selection: { kind: 'ticket', id: '2' },
    })
  })

  it('turns a sibling ticket link into an on-map ticket selection', () => {
    expect(
      resolveProseLink(
        makeMap(),
        `${ROOT}/.wayfinder/tickets/16-landing-orientation.md`,
        '02-re-story-for-scroll.md',
      ),
    ).toEqual({ kind: 'selection', selection: { kind: 'ticket', id: '2' } })
  })

  it('turns a link back to the map file into a map selection', () => {
    expect(
      resolveProseLink(
        makeMap(),
        `${ROOT}/.wayfinder/tickets/16-landing-orientation.md`,
        '../map.md',
      ),
    ).toEqual({
      kind: 'selection',
      selection: { kind: 'map' },
    })
  })

  it('keeps unsupported local document links visibly inert', () => {
    expect(
      resolveProseLink(
        makeMap(),
        `${ROOT}/.wayfinder/tickets/02-re-story-for-scroll.md`,
        '../../docs/page-list.md',
      ),
    ).toEqual({
      kind: 'disabled',
      reason:
        'Local file links stay inside Roadmap only when they point at this map or one of its tickets.',
    })
  })

  it('leaves absolute web links alone', () => {
    expect(resolveProseLink(makeMap(), `${ROOT}/.wayfinder/map.md`, 'https://example.com')).toEqual(
      {
        kind: 'href',
        href: 'https://example.com',
      },
    )
  })
})

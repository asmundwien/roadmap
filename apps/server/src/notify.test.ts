import { describe, expect, it, vi } from 'vitest'
import type { ChangeEvent, EventTicket } from './change-feed.ts'
import { createNotifier, NOTIFY_ICON } from './notify.ts'

function eventTicket(
  id: string,
  url: string | undefined = `https://github.com/a/roadmap/issues/${id}`,
): EventTicket {
  return {
    project: { integration: 'github', id: 'a/roadmap' },
    projectName: 'a/roadmap',
    mapId: '1',
    mapDisplayId: '#1',
    mapTitle: 'Map 1',
    id,
    displayId: `#${id}`,
    title: `Ticket ${id}`,
    url,
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createNotifier', () => {
  it('banners a claim and a completion, grouped by ticket', () => {
    const calls: string[][] = []
    const notify = createNotifier(async (args) => {
      calls.push(args)
    })
    const events: ChangeEvent[] = [
      { type: 'ticket-claimed', ticket: eventTicket('2') },
      { type: 'ticket-closed', ticket: eventTicket('3') },
    ]
    notify(events)
    expect(calls).toEqual([
      [
        '-title',
        'Roadmap',
        '-subtitle',
        'Map 1',
        '-message',
        'Claimed: Ticket 2',
        '-open',
        'https://github.com/a/roadmap/issues/2',
        '-group',
        'https://github.com/a/roadmap/issues/2',
        '-contentImage',
        NOTIFY_ICON,
      ],
      [
        '-title',
        'Roadmap',
        '-subtitle',
        'Map 1',
        '-message',
        'Completed: Ticket 3',
        '-open',
        'https://github.com/a/roadmap/issues/3',
        '-group',
        'https://github.com/a/roadmap/issues/3',
        '-contentImage',
        NOTIFY_ICON,
      ],
    ])
  })

  it('falls back to a non-linking banner when the ticket has no url', () => {
    const calls: string[][] = []
    const notify = createNotifier(async (args) => {
      calls.push(args)
    })

    notify([{ type: 'ticket-claimed', ticket: { ...eventTicket('2'), url: undefined } }])

    expect(calls).toEqual([
      [
        '-title',
        'Roadmap',
        '-subtitle',
        'Map 1',
        '-message',
        'Claimed: Ticket 2',
        '-group',
        'Map 1#2',
        '-contentImage',
        NOTIFY_ICON,
      ],
    ])
  })

  it('stays silent for the rest of the feed', () => {
    const calls: string[][] = []
    const notify = createNotifier(async (args) => {
      calls.push(args)
    })
    const map = {
      project: { integration: 'github' as const, id: 'a/roadmap' },
      projectName: 'a/roadmap',
      id: '1',
      title: 'Map 1',
      url: 'https://x',
    }
    notify([
      { type: 'map-appeared', map },
      { type: 'frontier-changed', map, entered: [eventTicket('2')], left: [] },
    ])
    expect(calls).toEqual([])
  })

  it('warns once, and never throws, when the notifier binary fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notify = createNotifier(() => Promise.reject(new Error('ENOENT')))
    notify([{ type: 'ticket-claimed', ticket: eventTicket('2') }])
    notify([{ type: 'ticket-closed', ticket: eventTicket('2') }])
    await settle()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

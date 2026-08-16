import { describe, expect, it, vi } from 'vitest'
import type { ChangeEvent, EventTicket } from './change-feed.ts'
import { createNotifier, NOTIFY_ICON } from './notify.ts'

function eventTicket(number: number): EventTicket {
  return {
    number,
    title: `Ticket ${number}`,
    url: `https://github.com/a/roadmap/issues/${number}`,
    mapTitle: 'Map 1',
    nameWithOwner: 'a/roadmap',
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
      { type: 'ticket-claimed', ticket: eventTicket(2) },
      { type: 'ticket-closed', ticket: eventTicket(3) },
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

  it('stays silent for the rest of the feed', () => {
    const calls: string[][] = []
    const notify = createNotifier(async (args) => {
      calls.push(args)
    })
    const map = { nameWithOwner: 'a/roadmap', number: 1, title: 'Map 1', url: 'https://x' }
    notify([
      { type: 'map-appeared', map },
      { type: 'frontier-changed', map, entered: [eventTicket(2)], left: [] },
    ])
    expect(calls).toEqual([])
  })

  it('warns once, and never throws, when the notifier binary fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const notify = createNotifier(() => Promise.reject(new Error('ENOENT')))
    notify([{ type: 'ticket-claimed', ticket: eventTicket(2) }])
    notify([{ type: 'ticket-closed', ticket: eventTicket(2) }])
    await settle()
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

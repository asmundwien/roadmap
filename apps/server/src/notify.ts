import { execFile } from 'node:child_process'
import type { ChangeEvent, EventTicket } from './change-feed.ts'

/** Runs terminal-notifier with the given arguments; rejects if it cannot. */
export type NotifyRunner = (args: string[]) => Promise<void>

/**
 * The change feed's first subscriber: a macOS banner (terminal-notifier) for the actions agent
 * sessions take — a takeable ticket claimed, a claimed ticket completed. Everything else on the
 * feed stays silent here. Grouped per ticket, so the completion banner replaces the claim banner.
 */
export function createNotifier(
  run: NotifyRunner = runTerminalNotifier,
): (events: ChangeEvent[]) => void {
  let warned = false
  return (events) => {
    for (const event of events) {
      if (event.type !== 'ticket-claimed' && event.type !== 'ticket-closed') continue
      const verb = event.type === 'ticket-claimed' ? 'Claimed' : 'Completed'
      void run(bannerArgs(verb, event.ticket)).catch((error: unknown) => {
        // Notifications are best-effort: a missing binary (or any failure) must never take the
        // server down, and one warning is enough for the whole session.
        if (warned) return
        warned = true
        console.warn('notification failed (is terminal-notifier installed?)', error)
      })
    }
  }
}

function bannerArgs(verb: string, ticket: EventTicket): string[] {
  return [
    '-title',
    'Roadmap',
    '-subtitle',
    ticket.mapTitle,
    '-message',
    `${verb}: ${ticket.title}`,
    '-open',
    ticket.url,
    '-group',
    ticket.url,
  ]
}

function runTerminalNotifier(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('terminal-notifier', args, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

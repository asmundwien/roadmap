import type { AutomationEvidence } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { automationTags } from './automation-presentation.ts'

const target: AutomationEvidence['target'] = {
  project: { integration: 'github', id: 'owner/repo' },
  mapId: 'map',
  ticketId: 'ticket',
}

describe('automationTags', () => {
  it('keeps finished Classification and Wayfinder facts in their fixed independent slots', () => {
    const evidence: AutomationEvidence = {
      target,
      classification: {
        status: 'completed',
        admission: 'override',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'afk', reason: 'Safe for autonomous work.' },
      },
      wayfinder: {
        status: 'finished',
        admission: 'automatic',
        processResult: { status: 'signaled', signal: 'SIGTERM' },
        report: {
          status: 'received',
          report: { outcome: 'stopped', reason: 'Stopped at the session boundary.' },
        },
      },
    }

    expect(automationTags(evidence)).toEqual([
      {
        slot: 'classification',
        stage: 'classification',
        glyph: 'A',
        label: 'Classification verdict: AFK · override admission',
        word: 'AFK',
      },
      {
        slot: 'classification-process',
        stage: 'classification',
        glyph: '✓',
        label: 'Classification process exited 0',
        word: 'exited',
      },
      {
        slot: 'wayfinder',
        stage: 'wayfinder',
        glyph: '◆',
        label: 'Wayfinder finished · automatic admission',
        word: 'finished',
      },
      {
        slot: 'wayfinder-process',
        stage: 'wayfinder',
        glyph: '!',
        label: 'Wayfinder process ended by SIGTERM',
        word: 'signaled',
      },
      {
        slot: 'report',
        stage: 'wayfinder',
        glyph: '■',
        label: 'Session report: stopped',
        word: 'stopped',
      },
    ])
  })

  it('does not invent process or Session facts for an unfinished attempt', () => {
    const evidence: AutomationEvidence = {
      target,
      classification: { status: 'running', admission: 'automatic' },
    }

    expect(automationTags(evidence)).toEqual([
      {
        slot: 'classification',
        stage: 'classification',
        glyph: '…',
        label: 'Classification running · automatic admission',
        word: 'running',
      },
    ])
  })

  it('shows queued admission and acknowledged interruption evidence', () => {
    const classification: AutomationEvidence['classification'] = {
      status: 'completed',
      admission: 'automatic',
      processResult: { status: 'exited', code: 0 },
      verdict: { value: 'afk', reason: 'Safe for autonomous work.' },
    }

    expect(
      automationTags({ target, classification, wayfinder: { status: 'queued' } }).map(
        (tag) => tag.label,
      ),
    ).toEqual([
      'Classification verdict: AFK · automatic admission',
      'Classification process exited 0',
      'Wayfinder queued · admission pending',
    ])

    expect(
      automationTags({
        target,
        classification,
        wayfinder: {
          status: 'outcome-unknown',
          admission: 'override',
          reason: 'Roadmap restarted.',
          acknowledged: true,
        },
      })[2]?.label,
    ).toBe('Wayfinder outcome unknown · override admission · acknowledged')
  })

  it('keeps an invalid Session report independent from a successful process exit', () => {
    const evidence: AutomationEvidence = {
      target,
      classification: {
        status: 'completed',
        admission: 'automatic',
        processResult: { status: 'exited', code: 0 },
        verdict: { value: 'afk', reason: 'Safe for autonomous work.' },
      },
      wayfinder: {
        status: 'finished',
        admission: 'override',
        processResult: { status: 'exited', code: 0 },
        report: { status: 'invalid', reason: 'Malformed report.' },
      },
    }

    const tags = automationTags(evidence)
    expect(tags.map((tag) => tag.slot)).toEqual([
      'classification',
      'classification-process',
      'wayfinder',
      'wayfinder-process',
      'report',
    ])
    expect(tags[3]?.label).toBe('Wayfinder process exited 0')
    expect(tags[4]?.label).toBe('Session report invalid')
  })
})

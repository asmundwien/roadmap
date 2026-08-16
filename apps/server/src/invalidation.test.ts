import type { MapRef } from '@roadmap/contracts'
import { describe, expect, it } from 'vitest'
import { classifyDelivery } from './invalidation.ts'

const KNOWN: MapRef[] = [
  { owner: 'a', repo: 'roadmap', nameWithOwner: 'a/roadmap', number: 16 },
  { owner: 'a', repo: 'other', nameWithOwner: 'a/other', number: 3 },
]

const repo = (full_name: string) => ({ full_name })

describe('issues events', () => {
  it('is precise when the touched issue is itself a map', () => {
    const result = classifyDelivery(
      'issues',
      {
        action: 'edited',
        issue: { number: 16, labels: [{ name: 'wayfinder:map' }] },
        repository: repo('a/roadmap'),
      },
      KNOWN,
    )
    expect(result).toEqual({
      kind: 'maps',
      refs: [{ owner: 'a', repo: 'roadmap', nameWithOwner: 'a/roadmap', number: 16 }],
    })
  })

  it('registers a brand-new map the moment the label lands, even in an unknown repo', () => {
    const result = classifyDelivery(
      'issues',
      {
        action: 'labeled',
        issue: { number: 1, labels: [] },
        label: { name: 'wayfinder:map' },
        repository: repo('a/fresh'),
      },
      KNOWN,
    )
    expect(result).toEqual({
      kind: 'maps',
      refs: [{ owner: 'a', repo: 'fresh', nameWithOwner: 'a/fresh', number: 1 }],
    })
  })

  it('falls back to repo-coarse for a ticket event, since payloads carry no parent pointer', () => {
    const result = classifyDelivery(
      'issues',
      { action: 'closed', issue: { number: 20, labels: [] }, repository: repo('a/roadmap') },
      KNOWN,
    )
    expect(result).toEqual({ kind: 'repos', repos: ['a/roadmap'] })
  })

  it('ignores issue events in repos with no known maps', () => {
    const result = classifyDelivery(
      'issues',
      { action: 'closed', issue: { number: 7, labels: [] }, repository: repo('a/unrelated') },
      KNOWN,
    )
    expect(result.kind).toBe('ignore')
  })

  it('drops the noise actions on arrival', () => {
    for (const action of ['pinned', 'locked', 'milestoned', 'field_added']) {
      const result = classifyDelivery(
        'issues',
        { action, issue: { number: 20 }, repository: repo('a/roadmap') },
        KNOWN,
      )
      expect(result.kind).toBe('ignore')
    }
  })
})

describe('sub_issues events', () => {
  it('is precise when the parent is a known map', () => {
    const result = classifyDelivery(
      'sub_issues',
      { action: 'sub_issue_added', parent_issue: { number: 16 }, repository: repo('a/roadmap') },
      KNOWN,
    )
    expect(result).toEqual({
      kind: 'maps',
      refs: [{ owner: 'a', repo: 'roadmap', nameWithOwner: 'a/roadmap', number: 16 }],
    })
  })

  it('trusts the wayfinder label when the parent is not yet known', () => {
    const result = classifyDelivery(
      'sub_issues',
      {
        action: 'sub_issue_added',
        parent_issue: { number: 2, labels: [{ name: 'wayfinder:map' }] },
        repository: repo('a/fresh'),
      },
      KNOWN,
    )
    expect(result.kind).toBe('maps')
  })

  it('reads the parent repo from parent_issue_repo on parent_issue_* actions', () => {
    const result = classifyDelivery(
      'sub_issues',
      {
        action: 'parent_issue_added',
        parent_issue: { number: 16 },
        parent_issue_repo: repo('a/roadmap'),
        repository: repo('a/other'),
      },
      KNOWN,
    )
    expect(result).toEqual({
      kind: 'maps',
      refs: [{ owner: 'a', repo: 'roadmap', nameWithOwner: 'a/roadmap', number: 16 }],
    })
  })
})

describe('issue_dependencies events', () => {
  it('goes repo-coarse across both sides of a cross-repo edge', () => {
    const result = classifyDelivery(
      'issue_dependencies',
      {
        action: 'blocked_by_added',
        repository: repo('a/roadmap'),
        blocking_issue_repo: repo('a/other'),
      },
      KNOWN,
    )
    expect(result).toEqual({ kind: 'repos', repos: ['a/roadmap', 'a/other'] })
  })
})

describe('label and repository events', () => {
  it('reruns discovery when the wayfinder label is renamed away', () => {
    const result = classifyDelivery(
      'label',
      {
        action: 'edited',
        label: { name: 'way:map' },
        changes: { name: { from: 'wayfinder:map' } },
      },
      KNOWN,
    )
    expect(result).toEqual({ kind: 'discovery' })
  })

  it('ignores unrelated label churn', () => {
    const result = classifyDelivery('label', { action: 'created', label: { name: 'bug' } }, KNOWN)
    expect(result.kind).toBe('ignore')
  })

  it('reruns discovery when a repo is renamed, and ignores cosmetic repo edits', () => {
    expect(classifyDelivery('repository', { action: 'renamed' }, KNOWN)).toEqual({
      kind: 'discovery',
    })
    expect(classifyDelivery('repository', { action: 'publicized' }, KNOWN).kind).toBe('ignore')
  })
})

it('ignores events it has no rule for', () => {
  expect(classifyDelivery('ping', {}, KNOWN).kind).toBe('ignore')
})

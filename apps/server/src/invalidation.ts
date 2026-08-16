import type { MapRef } from '@roadmap/contracts'

/**
 * What a webhook delivery asks the store to do. A delivery is only ever an invalidation signal —
 * "this was touched, refetch it" — never data to apply; see docs/research/webhook-path.md §2.
 *
 * - `maps` — the payload named the map itself: refetch exactly those maps. The refs may be new
 *   (a just-labelled `wayfinder:map` issue); the store registers them on refetch.
 * - `repos` — something issue-shaped moved in a repo with known maps, but the payload carries no
 *   parent pointer: refetch every known map in those repos.
 * - `discovery` — map identity itself may have changed (label renamed, repo renamed/deleted…):
 *   rerun the full discovery sweep.
 * - `ignore` — noise; costs nothing.
 */
export type Invalidation =
  | { kind: 'maps'; refs: MapRef[] }
  | { kind: 'repos'; repos: string[] }
  | { kind: 'discovery' }
  | { kind: 'ignore'; reason: string }

/** The slice of any delivery payload the classifier looks at. Parsed leniently — every field may
 * be absent, because five different events share this shape. */
export interface DeliveryPayload {
  action?: string
  issue?: PayloadIssue
  label?: { name?: string }
  changes?: { name?: { from?: string } }
  repository?: PayloadRepository
  parent_issue?: PayloadIssue
  parent_issue_repo?: PayloadRepository
  sub_issue_repo?: PayloadRepository
  blocking_issue_repo?: PayloadRepository
  blocked_issue_repo?: PayloadRepository
}

interface PayloadIssue {
  number?: number
  labels?: { name?: string }[]
}

interface PayloadRepository {
  full_name?: string
}

const MAP_LABEL = 'wayfinder:map'

/** `issues` actions that can never move anything a view renders. Everything else is signal —
 * misclassifying noise as signal only costs one rate-limited refetch, so the list stays short. */
const NOISE_ISSUE_ACTIONS = new Set([
  'pinned',
  'unpinned',
  'locked',
  'unlocked',
  'milestoned',
  'demilestoned',
  'field_added',
  'field_removed',
])

const DISCOVERY_REPOSITORY_ACTIONS = new Set([
  'renamed',
  'deleted',
  'transferred',
  'archived',
  'privatized',
])

/**
 * Maps a delivery to the refetch it deserves. The central constraint (research §2): only
 * `sub_issues` payloads name the parent, so precision is the exception and repo-coarse the rule.
 */
export function classifyDelivery(
  event: string,
  payload: DeliveryPayload,
  knownMaps: readonly MapRef[],
): Invalidation {
  switch (event) {
    case 'issues':
      return classifyIssues(payload, knownMaps)
    case 'sub_issues':
      return classifySubIssues(payload, knownMaps)
    case 'issue_dependencies':
      return coarse(
        [payload.repository, payload.blocking_issue_repo, payload.blocked_issue_repo],
        knownMaps,
      )
    case 'label':
      return classifyLabel(payload)
    case 'repository':
      return DISCOVERY_REPOSITORY_ACTIONS.has(payload.action ?? '')
        ? { kind: 'discovery' }
        : { kind: 'ignore', reason: `repository.${payload.action}` }
    default:
      return { kind: 'ignore', reason: `unhandled event ${event}` }
  }
}

function classifyIssues(payload: DeliveryPayload, knownMaps: readonly MapRef[]): Invalidation {
  const action = payload.action ?? ''
  if (NOISE_ISSUE_ACTIONS.has(action)) return { kind: 'ignore', reason: `issues.${action}` }

  const repo = payload.repository?.full_name
  const number = payload.issue?.number
  if (!repo || number === undefined) return { kind: 'ignore', reason: 'payload named no issue' }

  // The one precise case: the touched issue is itself a map — by its labels, or because the
  // wayfinder label is the thing being added or removed right now.
  const carriesMapLabel = (payload.issue?.labels ?? []).some((label) => label.name === MAP_LABEL)
  if (carriesMapLabel || payload.label?.name === MAP_LABEL) {
    return { kind: 'maps', refs: [toRef(repo, number)] }
  }

  return coarse([payload.repository], knownMaps)
}

function classifySubIssues(payload: DeliveryPayload, knownMaps: readonly MapRef[]): Invalidation {
  // `sub_issue_added/removed` put the parent's repo at top level; `parent_issue_added/removed`
  // name it in `parent_issue_repo`. Either way the parent is the map candidate.
  const parentRepo = payload.parent_issue_repo?.full_name ?? payload.repository?.full_name
  const parentNumber = payload.parent_issue?.number

  if (parentRepo && parentNumber !== undefined) {
    const ref = toRef(parentRepo, parentNumber)
    const isKnownMap = knownMaps.some(
      (map) => map.nameWithOwner === ref.nameWithOwner && map.number === ref.number,
    )
    const labelled = (payload.parent_issue?.labels ?? []).some((label) => label.name === MAP_LABEL)
    if (isKnownMap || labelled) return { kind: 'maps', refs: [ref] }
  }

  // Parent isn't a map we recognise (deep nesting, foreign hierarchy) — fall back to coarse
  // across every repo the payload mentions.
  return coarse([payload.repository, payload.parent_issue_repo, payload.sub_issue_repo], knownMaps)
}

function classifyLabel(payload: DeliveryPayload): Invalidation {
  const action = payload.action ?? ''
  const touchesMapLabel =
    payload.label?.name === MAP_LABEL || payload.changes?.name?.from === MAP_LABEL
  if ((action === 'edited' || action === 'deleted') && touchesMapLabel) {
    return { kind: 'discovery' }
  }
  return { kind: 'ignore', reason: `label.${action}` }
}

/** Repo-coarse invalidation, filtered to repos that actually hold known maps. */
function coarse(
  repositories: (PayloadRepository | undefined)[],
  knownMaps: readonly MapRef[],
): Invalidation {
  const named = new Set<string>()
  for (const repository of repositories) {
    if (repository?.full_name) named.add(repository.full_name)
  }
  const repos = [...named].filter((repo) => knownMaps.some((map) => map.nameWithOwner === repo))
  if (repos.length === 0) return { kind: 'ignore', reason: 'no known maps in payload repos' }
  return { kind: 'repos', repos }
}

function toRef(nameWithOwner: string, number: number): MapRef {
  const [owner = '', repo = ''] = nameWithOwner.split('/')
  return { owner, repo, nameWithOwner, number }
}

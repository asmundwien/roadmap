import type {
  MapResource,
  MapResourceResult,
  Project,
  ProjectResourceResult,
  TicketResourceResult,
} from '@roadmap/contracts/state'

type ResourceResult = ProjectResourceResult | MapResourceResult | TicketResourceResult
type ProjectObservation = Extract<
  ProjectResourceResult,
  { kind: 'current-readable' }
>['observation']
type MapObservation = Extract<MapResourceResult, { kind: 'current-readable' }>['observation']
type TicketObservation = Extract<TicketResourceResult, { kind: 'current-readable' }>['observation']

export function resourceObservation(result: ProjectResourceResult): ProjectObservation | null
export function resourceObservation(result: MapResourceResult): MapObservation | null
export function resourceObservation(result: TicketResourceResult): TicketObservation | null
export function resourceObservation(
  result: ResourceResult,
): ProjectObservation | MapObservation | TicketObservation | null
export function resourceObservation(result: ResourceResult) {
  switch (result.kind) {
    case 'current-readable':
      return result.observation
    case 'retained-unavailable':
      return result.lastSuccessful
    case 'proven-absent':
      return result.trace.kind === 'last-successful-trace' ? result.trace.lastSuccessful : null
    case 'never-observed':
      return null
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

function provenanceMessage(provenance: ProjectObservation['provenance']): string {
  return provenance.integration === 'local'
    ? `Local ${provenance.operation} at ${provenance.path}`
    : `GitHub ${provenance.stage}, Connection ${provenance.connectionId}, repository ${provenance.repositoryId}`
}

function successMessage(
  observation: ProjectObservation | MapObservation | TicketObservation,
): string {
  const completeness =
    observation.completeness.kind === 'incomplete'
      ? ` Content is incomplete (${observation.completeness.reason}).`
      : ''
  return `Source read ${new Date(observation.observedAt).toISOString()}. ${provenanceMessage(observation.provenance)}.${completeness}`
}

function unavailableMessage(
  unavailable: Extract<ResourceResult, { kind: 'retained-unavailable' }>['unavailable'],
): string {
  if (unavailable.kind === 'no-current-evidence') return unavailable.cause
  return `${unavailable.cause} ${unavailable.scope.kind} attempted ${new Date(unavailable.attemptedAt).toISOString()}. ${provenanceMessage(unavailable.provenance)}.`
}

function absenceProofMessage(
  proof: Extract<ResourceResult, { kind: 'proven-absent' }>['absence']['proof'],
): string {
  return proof.kind === 'provider-deletion'
    ? `Provider deletion proof for repository ${proof.repositoryId}.`
    : `Complete ${proof.parent.kind} established absence.`
}

export function resourceMessage(result: ResourceResult): string {
  switch (result.kind) {
    case 'current-readable':
      return `Current readable content. ${successMessage(result.observation)}`
    case 'retained-unavailable':
      return `Currently unavailable. Showing the last successful content. ${successMessage(result.lastSuccessful)} ${unavailableMessage(result.unavailable)}`
    case 'proven-absent':
      return `Proven absent from its source scope at ${new Date(result.absence.observedAt).toISOString()}. ${absenceProofMessage(result.absence.proof)} ${provenanceMessage(result.absence.provenance)}. ${result.trace.kind === 'last-successful-trace' ? `Historical trace. ${successMessage(result.trace.lastSuccessful)}` : 'No previously read content is known.'}`
    case 'never-observed':
      return `This resource has never been read. No source content is known.${result.current === null ? '' : ` ${unavailableMessage(result.current)}`}`
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

export function orderedMaps(project: Pick<Project, 'maps' | 'displayOrder'>): {
  open: MapResource[]
  closed: MapResource[]
  unplaced: MapResource[]
} {
  const byId = new Map(project.maps.map((map) => [map.ref.mapId, map]))
  const placed = new Set(
    [...project.displayOrder.open, ...project.displayOrder.closed].map((ref) => ref.mapId),
  )
  const resolve = (refs: Project['displayOrder']['open']) =>
    refs.flatMap((ref) => {
      const map = byId.get(ref.mapId)
      return map === undefined ? [] : [map]
    })
  return {
    open: resolve(project.displayOrder.open),
    closed: resolve(project.displayOrder.closed),
    unplaced: project.maps.filter((map) => !placed.has(map.ref.mapId)),
  }
}

import type { SourceTicketTypeEvidence } from '../observation/source.ts'

type RecognizedTicketType = Extract<SourceTicketTypeEvidence, { kind: 'recognized' }>['value']

const TICKET_TYPES: RecognizedTicketType[] = ['research', 'prototype', 'grilling', 'task']
const TYPE_LABEL_PREFIX = 'wayfinder:'

/** Retains every normalized `wayfinder:*` label so malformed evidence stays classifiable. */
export function ticketTypeEvidenceFromLabels(labels: readonly string[]): SourceTicketTypeEvidence {
  const typeLabels = [
    ...new Set(
      labels
        .map((label) => label.trim().toLowerCase())
        .filter((label) => label.startsWith(TYPE_LABEL_PREFIX))
        .map((label) => label.slice(TYPE_LABEL_PREFIX.length)),
    ),
  ].sort()
  if (typeLabels.length === 0) return { kind: 'missing', labels: [] }
  if (typeLabels.length > 1) return { kind: 'conflicting', labels: typeLabels }
  const value = typeLabels[0]
  const recognized = TICKET_TYPES.find((type) => type === value)
  return recognized
    ? { kind: 'recognized', value: recognized, labels: typeLabels }
    : { kind: 'unknown', labels: typeLabels }
}

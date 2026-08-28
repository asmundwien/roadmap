import type { AnySchema } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'

export const SESSION_REPORT_SCHEMA_MARKER = '{{roadmap.sessionReportSchema}}'

export const sessionReportSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    schemaVersion: { const: 1 },
    outcome: { type: 'string', enum: ['completed', 'stopped', 'failed'] },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: ['schemaVersion', 'outcome', 'reason'],
  additionalProperties: false,
} satisfies AnySchema

export interface SessionReportResult {
  schemaVersion: 1
  outcome: 'completed' | 'stopped' | 'failed'
  reason: string
}

export const sessionReportSchemaJson = JSON.stringify(sessionReportSchema, null, 2)

const validateSessionReport = new Ajv2020().compile<SessionReportResult>(sessionReportSchema)

export function decodeSessionReport(stdout: string): SessionReportResult | null {
  let input: unknown
  try {
    input = JSON.parse(stdout)
  } catch {
    return null
  }
  return validateSessionReport(input) ? input : null
}

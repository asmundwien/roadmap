import { describe, expect, it } from 'vitest'
import {
  decodeSessionReport,
  sessionReportSchema,
  sessionReportSchemaJson,
} from './session-report-contract.ts'

describe('Session report contract', () => {
  it('serializes the same JSON Schema used by the validator', () => {
    expect(JSON.parse(sessionReportSchemaJson)).toEqual(sessionReportSchema)
    expect(sessionReportSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: { schemaVersion: { const: 1 } },
      additionalProperties: false,
    })
  })

  it('accepts only reports matching the injected contract', () => {
    const valid = { schemaVersion: 1, outcome: 'completed', reason: 'Ticket resolved.' }
    expect(decodeSessionReport(JSON.stringify(valid))).toEqual(valid)

    for (const invalid of [
      { ...valid, schemaVersion: 2 },
      { ...valid, outcome: 'unknown' },
      { ...valid, reason: '' },
      { ...valid, reason: 'x'.repeat(1001) },
      { ...valid, extra: true },
    ]) {
      expect(decodeSessionReport(JSON.stringify(invalid))).toBeNull()
    }
    expect(decodeSessionReport('not json')).toBeNull()
  })
})

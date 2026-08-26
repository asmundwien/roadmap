import { describe, expect, it } from 'vitest'
import {
  classificationResultSchema,
  classificationResultSchemaJson,
  decodeClassificationResult,
} from './classification-contract.ts'

describe('Classification result contract', () => {
  it('serializes the same JSON Schema used by the validator', () => {
    expect(JSON.parse(classificationResultSchemaJson)).toEqual(classificationResultSchema)
    expect(classificationResultSchema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      properties: { schemaVersion: { const: 1 } },
      additionalProperties: false,
    })
  })

  it('accepts only results matching the injected contract', () => {
    const valid = { schemaVersion: 1, verdict: 'afk', reason: 'No human action.' }
    expect(decodeClassificationResult(JSON.stringify(valid))).toEqual(valid)

    for (const invalid of [
      { ...valid, schemaVersion: 2 },
      { ...valid, verdict: 'unknown' },
      { ...valid, reason: '' },
      { ...valid, reason: 'x'.repeat(1001) },
      { ...valid, extra: true },
    ]) {
      expect(decodeClassificationResult(JSON.stringify(invalid))).toBeNull()
    }
    expect(decodeClassificationResult('not json')).toBeNull()
  })
})

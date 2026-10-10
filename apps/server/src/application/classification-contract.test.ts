import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import {
  classificationResultSchemaJson,
  decodeClassificationResult,
} from './classification-contract.ts'

const interpretInjectedSchema = new Ajv2020().compile(JSON.parse(classificationResultSchemaJson))
const valid = { schemaVersion: 1, verdict: 'afk', reason: 'No human action.' }

describe('Classification result contract', () => {
  for (const verdict of ['afk', 'hitl', 'unable']) {
    it.each([1, 1000])('accepts %s-character reasons for ' + verdict, (length) => {
      const result = { schemaVersion: 1, verdict, reason: 'x'.repeat(length) }
      expect(interpretInjectedSchema(result)).toBe(true)
      expect(decodeClassificationResult(JSON.stringify(result))).toEqual(result)
    })
  }

  it('accepts 1000 Unicode code points without counting surrogate pairs twice', () => {
    const result = { ...valid, reason: '😀'.repeat(1000) }
    expect(interpretInjectedSchema(result)).toBe(true)
    expect(decodeClassificationResult(JSON.stringify(result))).toEqual(result)
  })

  it.each([
    ['wrong version', { ...valid, schemaVersion: 2 }],
    ['nonnumber version', { ...valid, schemaVersion: '1' }],
    ['absent version', { verdict: 'afk', reason: 'No human action.' }],
    ['wrong verdict', { ...valid, verdict: 'unknown' }],
    ['nonstring verdict', { ...valid, verdict: 1 }],
    ['absent verdict', { schemaVersion: 1, reason: 'No human action.' }],
    ['absent reason', { schemaVersion: 1, verdict: 'afk' }],
    ['nonstring reason', { ...valid, reason: 1 }],
    ['null reason', { ...valid, reason: null }],
    ['empty reason', { ...valid, reason: '' }],
    ['1001-character reason', { ...valid, reason: 'x'.repeat(1001) }],
    ['1001-code-point reason', { ...valid, reason: '😀'.repeat(1001) }],
    ['extra field', { ...valid, extra: true }],
    ['null result', null],
    ['array result', [valid]],
  ])('rejects %s in both interpreters', (_name, result) => {
    expect(interpretInjectedSchema(result)).toBe(false)
    expect(decodeClassificationResult(JSON.stringify(result))).toBeNull()
  })

  it.each(['not json', '{', JSON.stringify(valid) + '\ntrailing output'])(
    'refuses malformed output %s before schema interpretation',
    (stdout) => {
      expect(() => JSON.parse(stdout)).toThrow()
      expect(decodeClassificationResult(stdout)).toBeNull()
    },
  )
})

import { Ajv2020 } from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import { decodeSessionReport, sessionReportSchemaJson } from './session-report-contract.ts'

const interpretInjectedSchema = new Ajv2020().compile(JSON.parse(sessionReportSchemaJson))
const valid = { schemaVersion: 1, outcome: 'completed', reason: 'Ticket completed.' }

describe('Session report contract', () => {
  for (const outcome of ['completed', 'stopped', 'failed']) {
    it.each([1, 1000])('accepts %s-character reasons for ' + outcome, (length) => {
      const report = { schemaVersion: 1, outcome, reason: 'x'.repeat(length) }
      expect(interpretInjectedSchema(report)).toBe(true)
      expect(decodeSessionReport(JSON.stringify(report))).toEqual(report)
    })
  }

  it('accepts 1000 Unicode code points without counting surrogate pairs twice', () => {
    const report = { ...valid, reason: '😀'.repeat(1000) }
    expect(interpretInjectedSchema(report)).toBe(true)
    expect(decodeSessionReport(JSON.stringify(report))).toEqual(report)
  })

  it.each([
    ['wrong version', { ...valid, schemaVersion: 2 }],
    ['nonnumber version', { ...valid, schemaVersion: '1' }],
    ['absent version', { outcome: 'completed', reason: 'Ticket completed.' }],
    ['wrong outcome', { ...valid, outcome: 'unknown' }],
    ['nonstring outcome', { ...valid, outcome: 1 }],
    ['absent outcome', { schemaVersion: 1, reason: 'Ticket completed.' }],
    ['absent reason', { schemaVersion: 1, outcome: 'completed' }],
    ['nonstring reason', { ...valid, reason: 1 }],
    ['null reason', { ...valid, reason: null }],
    ['empty reason', { ...valid, reason: '' }],
    ['1001-character reason', { ...valid, reason: 'x'.repeat(1001) }],
    ['extra field', { ...valid, extra: true }],
    ['1001-code-point reason', { ...valid, reason: '😀'.repeat(1001) }],
    ['null report', null],
    ['array report', [valid]],
  ])('rejects %s in both interpreters', (_name, report) => {
    expect(interpretInjectedSchema(report)).toBe(false)
    expect(decodeSessionReport(JSON.stringify(report))).toBeNull()
  })

  it.each(['not json', '{', JSON.stringify(valid) + '\ntrailing output'])(
    'refuses malformed output %s before schema interpretation',
    (stdout) => {
      expect(() => JSON.parse(stdout)).toThrow()
      expect(decodeSessionReport(stdout)).toBeNull()
    },
  )
})

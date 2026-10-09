import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseProofOptions } from './proof-options.mjs'

test('defaults to the complete permanent proof matrix', () => {
  assert.deepEqual(parseProofOptions([]), { help: false, case: null, negativeOnly: false })
})

test('accepts an isolated compiler proof without interaction', () => {
  assert.deepEqual(
    parseProofOptions(['--case', 'session-queued-admission', '--negative-only'], true),
    { help: false, case: 'session-queued-admission', negativeOnly: true },
  )
})

test('rejects missing, duplicated and unsupported arguments with actionable help', () => {
  assert.throws(() => parseProofOptions(['--case']), /requires a fixture name.*--help/)
  assert.throws(() => parseProofOptions(['--case', '--help']), /requires a fixture name/)
  assert.throws(() => parseProofOptions(['--case', 'a', '--case', 'b']), /only once/)
  assert.throws(() => parseProofOptions(['--negative-only']), /Unknown option.*--help/)
  assert.throws(() => parseProofOptions(['--invalid']), /Unknown option.*--help/)
})

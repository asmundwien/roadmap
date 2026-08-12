import { describe, expect, it } from 'vitest'
import { formatMonth, formatRecency } from './recency.ts'

// Local-time construction throughout, matching the formatter's calendar-day arithmetic.
const noon = (y: number, m: number, d: number) => new Date(y, m, d, 12).getTime()
const now = noon(2026, 7, 13)

describe('formatRecency', () => {
  it('reads a same-day update as today', () => {
    expect(formatRecency(noon(2026, 7, 13), now)).toBe('today')
  })

  it('crosses midnight into yesterday, even minutes apart', () => {
    const lateLastNight = new Date(2026, 7, 12, 23, 59).getTime()
    const earlyToday = new Date(2026, 7, 13, 0, 1).getTime()
    expect(formatRecency(lateLastNight, earlyToday)).toBe('yesterday')
  })

  it('counts calendar days up to a month', () => {
    expect(formatRecency(noon(2026, 7, 1), now)).toBe('12 days ago')
    expect(formatRecency(noon(2026, 6, 14), now)).toBe('30 days ago')
  })

  it('falls back to the calendar past a month', () => {
    expect(formatRecency(noon(2026, 6, 13), now)).toBe('Jul 2026')
    expect(formatRecency(noon(2025, 10, 5), now)).toBe('Nov 2025')
  })

  it('never claims the future — clock skew reads as today', () => {
    expect(formatRecency(noon(2026, 7, 20), now)).toBe('today')
  })
})

describe('formatMonth', () => {
  it('stamps month and year', () => {
    expect(formatMonth(noon(2025, 10, 5))).toBe('Nov 2025')
  })
})

/**
 * The card's date tails. An open map's tail says how recently it moved — relative wording up to a
 * month, because past that recency is no longer the story and the tail falls back to the
 * calendar. A closed map's tail is always calendar: when the journey ended, not how long ago.
 * English on purpose — the whole UI is.
 */
export function formatRecency(ms: number, now: number): string {
  const days = calendarDaysBetween(ms, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days <= 30) return `${days} days ago`
  return formatMonth(ms)
}

/** A month-and-year stamp — the resolution history is read at. */
export function formatMonth(ms: number): string {
  return new Date(ms).toLocaleDateString('en', { month: 'short', year: 'numeric' })
}

/** Whole local calendar days, so 23:59 → 00:01 reads as yesterday, not today. */
function calendarDaysBetween(from: number, to: number): number {
  const a = new Date(from)
  const b = new Date(to)
  const dayOfA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const dayOfB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((dayOfB - dayOfA) / 86_400_000)
}

/** Formats known source activity relative to the current local calendar date. */
export function formatRecency(ms: number, now: number): string {
  const days = calendarDaysBetween(ms, now)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days <= 30) return `${days} days ago`
  return formatMonth(ms)
}

/** Formats known source activity as a month and year. */
export function formatMonth(ms: number): string {
  return new Date(ms).toLocaleDateString('en', { month: 'short', year: 'numeric' })
}

/** Counts local calendar days, so activity across midnight reads as yesterday. */
function calendarDaysBetween(from: number, to: number): number {
  const a = new Date(from)
  const b = new Date(to)
  const dayOfA = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
  const dayOfB = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()
  return Math.round((dayOfB - dayOfA) / 86_400_000)
}

import { z } from 'zod'

export const SESSION_REPORT_SCHEMA_MARKER = '{{roadmap.sessionReportSchema}}'

const sessionReport = z.strictObject({
  schemaVersion: z.literal(1),
  outcome: z.enum(['completed', 'stopped', 'failed']),
  reason: z.string().min(1).max(1000),
})

export type SessionReportResult = z.infer<typeof sessionReport>

const sessionReportSchema = z.toJSONSchema(sessionReport, { target: 'draft-2020-12' })
export const sessionReportSchemaJson = JSON.stringify(sessionReportSchema, null, 2)

export function decodeSessionReport(stdout: string): SessionReportResult | null {
  let input: unknown
  try {
    input = JSON.parse(stdout)
  } catch {
    return null
  }
  const result = sessionReport.safeParse(input)
  return result.success ? result.data : null
}

import { z } from 'zod'

export const CLASSIFICATION_RESULT_SCHEMA_MARKER = '{{roadmap.classificationResultSchema}}'

const classificationResult = z.strictObject({
  schemaVersion: z.literal(1),
  verdict: z.union([
    z.literal('afk').describe('An agent can complete it without live human input or action.'),
    z.literal('hitl').describe('Completion requires live human judgment, input, or action.'),
    z.literal('unable').describe('The available tracker facts do not support a confident verdict.'),
  ]),
  reason: z.string().min(1).max(1000),
})

export type ClassificationResult = z.infer<typeof classificationResult>

const classificationResultSchema = z.toJSONSchema(classificationResult, {
  target: 'draft-2020-12',
})
export const classificationResultSchemaJson = JSON.stringify(classificationResultSchema, null, 2)

export function decodeClassificationResult(stdout: string): ClassificationResult | null {
  let input: unknown
  try {
    input = JSON.parse(stdout)
  } catch {
    return null
  }
  const result = classificationResult.safeParse(input)
  return result.success ? result.data : null
}

import type { AnySchema } from 'ajv'
import { Ajv2020 } from 'ajv/dist/2020.js'

export const CLASSIFICATION_RESULT_SCHEMA_MARKER = '{{roadmap.classificationResultSchema}}'

export const classificationResultSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  properties: {
    schemaVersion: { const: 1 },
    verdict: {
      type: 'string',
      oneOf: [
        {
          const: 'afk',
          description: 'An agent can complete it without live human input or action.',
        },
        {
          const: 'hitl',
          description: 'Completion requires live human judgment, input, or action.',
        },
        {
          const: 'unable',
          description: 'The available tracker facts do not support a confident verdict.',
        },
      ],
    },
    reason: { type: 'string', minLength: 1, maxLength: 1000 },
  },
  required: ['schemaVersion', 'verdict', 'reason'],
  additionalProperties: false,
} satisfies AnySchema

export interface ClassificationResult {
  schemaVersion: 1
  verdict: 'afk' | 'hitl' | 'unable'
  reason: string
}

export const classificationResultSchemaJson = JSON.stringify(classificationResultSchema, null, 2)

const validateClassificationResult = new Ajv2020().compile<ClassificationResult>(
  classificationResultSchema,
)

export function decodeClassificationResult(stdout: string): ClassificationResult | null {
  let input: unknown
  try {
    input = JSON.parse(stdout)
  } catch {
    return null
  }
  return validateClassificationResult(input) ? input : null
}

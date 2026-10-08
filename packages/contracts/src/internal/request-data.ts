import { z } from 'zod'

function isPlainOwnData(input: unknown): boolean {
  if (typeof input !== 'object' || input === null) return false
  const prototype: unknown = Object.getPrototypeOf(input)
  if (prototype !== Object.prototype && prototype !== null) return false
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return false
  }
  return true
}

// Each object schema checks its own fields; nested schemas validate nested objects.
export const requestDataSchema = z.preprocess((input, context) => {
  if (isPlainOwnData(input)) return input
  context.addIssue({ code: 'custom', message: 'must contain plain own data' })
  return z.NEVER
}, z.unknown())

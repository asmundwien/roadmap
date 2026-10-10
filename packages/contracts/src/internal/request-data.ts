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

function isArrayOwnData(input: unknown): boolean {
  if (!Array.isArray(input)) return false
  const prototype: unknown = Object.getPrototypeOf(input)
  if (prototype !== Array.prototype && prototype !== null) return false
  const lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length')
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) return false
  const length: unknown = lengthDescriptor.value
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) return false
  const keys = Reflect.ownKeys(input)
  if (keys.length !== length + 1) return false
  for (const key of keys) {
    if (key === 'length') continue
    if (typeof key !== 'string') return false
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0 || index >= length || String(index) !== key) {
      return false
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key)
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return false
  }
  return true
}

// Request and resource object boundaries check own data before parsing fields.
// Nested object schemas apply the same guard before reading their own fields.
export const requestDataSchema = z.preprocess((input, context) => {
  if (isPlainOwnData(input)) return input
  context.addIssue({ code: 'custom', message: 'must contain plain own data' })
  return z.NEVER
}, z.unknown())

// Array boundaries check every slot descriptor before element schemas read values.
export const arrayDataSchema = z.preprocess((input, context) => {
  if (isArrayOwnData(input)) return input
  context.addIssue({ code: 'custom', message: 'must contain dense array own data' })
  return z.NEVER
}, z.unknown())

// Refuse undeclared fields before Zod can include their names in diagnostics.
export function strictDataObject<const S extends z.ZodRawShape>(shape: S) {
  const keys = new Set(Object.keys(shape))
  return requestDataSchema
    .pipe(
      z.preprocess((input, context) => {
        if (typeof input !== 'object' || input === null) return z.NEVER
        if (Reflect.ownKeys(input).some((key) => typeof key !== 'string' || !keys.has(key))) {
          context.addIssue({ code: 'custom', message: 'must contain declared own data' })
          return z.NEVER
        }
        return input
      }, z.unknown()),
    )
    .pipe(z.strictObject(shape))
}

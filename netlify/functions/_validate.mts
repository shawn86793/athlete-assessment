/** Lightweight request validation — no external dependencies. */

type StringRule = {
  type: 'string'
  required?: boolean
  minLength?: number
  maxLength?: number
  pattern?: RegExp
  email?: boolean
  trim?: boolean
}

type NumberRule = {
  type: 'number'
  required?: boolean
  integer?: boolean
  min?: number
  max?: number
}

type BooleanRule = {
  type: 'boolean'
  required?: boolean
}

type ArrayRule = {
  type: 'array'
  required?: boolean
  minItems?: number
  maxItems?: number
}

export type FieldRule = StringRule | NumberRule | BooleanRule | ArrayRule

export type Schema = Record<string, FieldRule>

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const validate = (data: Record<string, unknown>, schema: Schema): ValidationResult => {
  const errors: string[] = []

  for (const [field, rule] of Object.entries(schema)) {
    const raw = data[field]
    const missing = raw === undefined || raw === null || raw === ''

    if (rule.required && missing) {
      errors.push(`${field} is required`)
      continue
    }
    if (missing) continue

    if (rule.type === 'string') {
      if (typeof raw !== 'string') {
        errors.push(`${field} must be a string`)
        continue
      }
      const value = rule.trim !== false ? raw.trim() : raw
      if (rule.minLength !== undefined && value.length < rule.minLength)
        errors.push(`${field} must be at least ${rule.minLength} characters`)
      if (rule.maxLength !== undefined && value.length > rule.maxLength)
        errors.push(`${field} must be at most ${rule.maxLength} characters`)
      if (rule.email && !EMAIL_RE.test(value))
        errors.push(`${field} must be a valid email address`)
      if (rule.pattern && !rule.pattern.test(value))
        errors.push(`${field} format is invalid`)
    }

    if (rule.type === 'number') {
      const num = Number(raw)
      if (Number.isNaN(num)) { errors.push(`${field} must be a number`); continue }
      if (rule.integer && !Number.isInteger(num))
        errors.push(`${field} must be an integer`)
      if (rule.min !== undefined && num < rule.min)
        errors.push(`${field} must be at least ${rule.min}`)
      if (rule.max !== undefined && num > rule.max)
        errors.push(`${field} must be at most ${rule.max}`)
    }

    if (rule.type === 'boolean' && typeof raw !== 'boolean') {
      errors.push(`${field} must be a boolean`)
    }

    if (rule.type === 'array') {
      if (!Array.isArray(raw)) { errors.push(`${field} must be an array`); continue }
      if (rule.minItems !== undefined && raw.length < rule.minItems)
        errors.push(`${field} must have at least ${rule.minItems} item(s)`)
      if (rule.maxItems !== undefined && raw.length > rule.maxItems)
        errors.push(`${field} must have at most ${rule.maxItems} item(s)`)
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true }
}

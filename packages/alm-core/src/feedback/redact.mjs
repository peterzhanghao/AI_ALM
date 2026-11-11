/**
 * Redaction for feedback capture.
 *
 * Two independent concerns:
 * - secrets: a value under a secret-looking key, or a token-shaped string, must
 *   never reach disk. `redactValue` is the contract-mandated entry point and
 *   reports every field it touched;
 * - local absolute paths: the observed workspace root is stored locally for
 *   routing, but anything rendered into a requirement/proposal must not leak
 *   `D:\...` or `/home/...` paths. `redactPaths`/`redactText` handle that at
 *   render time (the envelope keeps its own root on purpose).
 */

const SECRET_KEY = /(password|passwd|secret|token|authorization|cookie|api[-_]?key|credential)/i

// Contract §1.1 token shapes, plus the usual `Bearer <token>` form where the
// scheme and the token are separated by a space.
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi
const PREFIXED_VALUE = /\b(?:sk-|ghp_|xoxb-)[A-Za-z0-9._-]{8,}/g

const ABSOLUTE_PATH_PATTERNS = [
  /\b[A-Za-z]:[\\/][^\s"'`<>|,;]*/g,
  /(?<![\w:./-])\/(?:home|Users|root|tmp|var|opt|mnt|srv|private|etc)\/[^\s"'`<>|,;]*/g,
]

const REDACTED = '[redacted]'
const MAX_REDACT_DEPTH = 6

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function redactSecretsInText(text) {
  let value = String(text)
  if (BEARER_VALUE.test(value)) {
    BEARER_VALUE.lastIndex = 0
    value = value.replace(BEARER_VALUE, REDACTED)
  }
  BEARER_VALUE.lastIndex = 0
  if (PREFIXED_VALUE.test(value)) {
    PREFIXED_VALUE.lastIndex = 0
    value = value.replace(PREFIXED_VALUE, REDACTED)
  }
  PREFIXED_VALUE.lastIndex = 0
  return value
}

function redactPathsInText(text) {
  let value = String(text)
  let changed = false
  for (const pattern of ABSOLUTE_PATH_PATTERNS) {
    pattern.lastIndex = 0
    if (!pattern.test(value)) continue
    pattern.lastIndex = 0
    value = value.replace(pattern, REDACTED)
    changed = true
  }
  return { value, changed }
}

function walk(value, { depth = 0, path = '', seen, onKey, onString }) {
  if (depth > MAX_REDACT_DEPTH) return REDACTED
  if (typeof value === 'string') return onString(value, path)
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return REDACTED
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => walk(entry, { depth: depth + 1, path: `${path}[${index}]`, seen, onKey, onString }))
    }
    const out = {}
    for (const [key, entry] of Object.entries(value)) {
      const childPath = path === '' ? key : `${path}.${key}`
      const redacted = onKey(key, childPath)
      out[key] = redacted === undefined ? walk(entry, { depth: depth + 1, path: childPath, seen, onKey, onString }) : redacted
    }
    return out
  } finally {
    seen.delete(value)
  }
}

/**
 * Deep-redact a value: secret keys are replaced wholesale, token-shaped strings
 * are replaced inside otherwise harmless values. Returns the redacted value and
 * the dotted paths it touched (deduplicated, never a raw secret).
 */
export function redactValue(value) {
  const redactions = []
  const seen = new WeakSet()
  const record = (path) => {
    const key = path === '' ? '$value' : path
    if (!redactions.includes(key)) redactions.push(key)
  }
  const redacted = walk(value, {
    seen,
    onKey: (key, path) => {
      if (SECRET_KEY.test(key)) {
        record(path)
        return REDACTED
      }
      return undefined
    },
    onString: (text, path) => {
      const next = redactSecretsInText(text)
      if (next !== text) record(path)
      return next
    },
  })
  return { value: redacted, redactions }
}

/**
 * Deep-redact local absolute paths in strings. Used when feedback text is
 * rendered into a proposal/requirement brief; the stored envelope keeps its own
 * `observedWorkspace.root` untouched.
 */
export function redactPaths(value) {
  const redactions = []
  const seen = new WeakSet()
  const redacted = walk(value, {
    seen,
    onKey: () => undefined,
    onString: (text, path) => {
      const { value: next, changed } = redactPathsInText(text)
      if (changed && !redactions.includes(path === '' ? '$value' : path)) redactions.push(path === '' ? '$value' : path)
      return next
    },
  })
  return { value: redacted, redactions }
}

/** Convenience for single strings: secret + absolute-path redaction, returns text. */
export function redactText(value) {
  const secrets = redactValue(String(value ?? ''))
  return redactPaths(secrets.value).value
}

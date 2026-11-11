const HUMAN_ID = /^human:[A-Za-z0-9._-]+$/
const AUTOMATION_ID = /^(?:test|automation|ai):/i
const TRUSTED_HUMAN_SOURCES = new Set(['host-authenticated', 'local-session'])

/**
 * Normalize a trusted subject supplied by the host boundary.
 *
 * `actor` remains an audit label and may originate in a request body. It is
 * deliberately not evidence of identity. A human decision additionally needs
 * a subject from an authenticated host session or the explicit local-session
 * compatibility boundary. Test, automation and AI identities can never be
 * promoted by claiming `kind: human`.
 */
export function trustedHumanSubject(subject, { actor = null } = {}) {
  if (!subject || typeof subject !== 'object' || Array.isArray(subject)) return null
  const id = String(subject.id ?? '').trim()
  const kind = String(subject.kind ?? '').trim().toLowerCase()
  const source = String(subject.source ?? '').trim().toLowerCase()
  if (kind !== 'human' || !TRUSTED_HUMAN_SOURCES.has(source)) return null
  if (!HUMAN_ID.test(id) || AUTOMATION_ID.test(id)) return null
  const actorId = String(actor ?? '').trim()
  if (actorId !== '' && actorId !== id) return null
  return { id, kind: 'human', source }
}

export function requireTrustedHumanSubject(subject, { actor = null, error } = {}) {
  const normalized = trustedHumanSubject(subject, { actor })
  if (normalized) return normalized
  const makeError = typeof error === 'function' ? error : (message) => new Error(message)
  throw makeError('trusted human subject is required; actor label is not identity proof')
}

export function isTrustedHumanSubject(subject, { actor = null } = {}) {
  return trustedHumanSubject(subject, { actor }) !== null
}

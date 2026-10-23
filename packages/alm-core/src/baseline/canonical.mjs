function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value === null || typeof value !== 'object') return value
  const sorted = {}
  for (const key of Object.keys(value).sort()) sorted[key] = sortValue(value[key])
  return sorted
}

/** Stable UTF-8 JSON: object keys sorted at every depth, no extra whitespace. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value))
}

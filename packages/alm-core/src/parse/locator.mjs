/** 1-based line of the first occurrence of `needle`, or 1 when absent. */
export function lineOf(text, needle) {
  if (!needle) return 1
  const index = text.indexOf(needle)
  if (index === -1) return 1
  return text.slice(0, index).split('\n').length
}

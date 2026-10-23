/** ID-001: every asset id is unique across the repository. */
export const id = 'ID-001'
export const level = 'block'

export function check({ index }) {
  return index.duplicates.flatMap(({ id: duplicateId, occurrences }) =>
    occurrences.map((asset) => ({
      assetId: duplicateId,
      file: asset.source.path,
      line: asset.source.line,
      message: `duplicate asset id ${duplicateId} (${occurrences.length} occurrences)`,
    })),
  )
}

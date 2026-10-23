import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The five contracts every ALM artifact is validated against.
 * Adding one is a contract change: bump the schema id and update the docs.
 */
export const CONTRACTS = [
  { file: 'asset.schema.json', id: 'alm.asset/v1' },
  { file: 'evidence.schema.json', id: 'alm.evidence/v1' },
  { file: 'approval.schema.json', id: 'alm.approval/v1' },
  { file: 'baseline.schema.json', id: 'alm.baseline/v1' },
  { file: 'finding.schema.json', id: 'alm.finding/v1' },
]

/**
 * Verify that every contract file exists, parses and declares the expected `$id`.
 * @param {string} dir directory holding the schema files
 */
export function verifyContracts(dir) {
  const result = { ok: true, checked: [], missing: [], invalid: [] }

  for (const contract of CONTRACTS) {
    const path = join(dir, contract.file)
    if (!existsSync(path)) {
      result.missing.push(contract)
      result.ok = false
      continue
    }

    try {
      const doc = JSON.parse(readFileSync(path, 'utf8'))
      if (doc.$id !== contract.id) {
        result.invalid.push({
          ...contract,
          message: `expected $id ${contract.id}, got ${String(doc.$id)}`,
        })
        result.ok = false
        continue
      }
      result.checked.push(contract)
    } catch (error) {
      result.invalid.push({ ...contract, message: error?.message ?? String(error) })
      result.ok = false
    }
  }

  return result
}

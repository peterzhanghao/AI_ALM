/**
 * PRJ-001: a requirement that declares PROJECT must match the repository's
 * `.alm/project.json`. Repos without a project file skip the rule so existing
 * single-project assets keep working.
 */
export const id = 'PRJ-001'
export const level = 'block'

import { readProject } from '../../project/project.mjs'

export function check({ root, assets }) {
  let project
  try {
    project = readProject(root)
  } catch (error) {
    return [
      {
        assetId: null,
        file: '.alm/project.json',
        line: 1,
        message: error.message,
      },
    ]
  }
  if (!project) {
    return { status: 'skip', findings: [], message: 'no .alm/project.json' }
  }

  const findings = []
  for (const asset of assets) {
    if (asset.type !== 'requirement') continue
    const declared = asset.extra?.project
    if (declared && declared !== project.id) {
      findings.push({
        assetId: asset.id,
        file: asset.source.path,
        line: asset.source.line,
        message: `requirement project ${declared} != repository project ${project.id}`,
      })
    }
  }
  return findings
}

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const GITHUB_MAPPING = '.alm/github.json'

export function mappingPath(root) {
  return join(resolve(root), GITHUB_MAPPING)
}

export function readMapping(root) {
  const file = mappingPath(root)
  if (!existsSync(file)) {
    return { schema: 'alm.github/v1', requirements: {}, tasks: {}, updatedAt: null }
  }
  const payload = JSON.parse(readFileSync(file, 'utf8'))
  return {
    schema: payload.schema ?? 'alm.github/v1',
    repo: payload.repo ?? null,
    requirements: payload.requirements ?? {},
    tasks: payload.tasks ?? {},
    updatedAt: payload.updatedAt ?? null,
  }
}

export function writeMapping(root, mapping) {
  const file = mappingPath(root)
  mkdirSync(join(resolve(root), '.alm'), { recursive: true })
  writeFileSync(
    file,
    `${JSON.stringify({ ...mapping, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
  return file
}

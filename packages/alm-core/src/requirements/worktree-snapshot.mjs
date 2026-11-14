import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { sha256 } from '../model/content-hash.mjs'

const MAX_FILES = 2000
const MAX_FILE_BYTES = 4 * 1024 * 1024
const EXCLUDED_PREFIXES = ['.git/', '.alm/', 'node_modules/', 'dist/', 'tmp/', 'artifacts/', 'validation/', 'requirements/architecture/']

/** Content scope deliberately excludes generated evidence, dependencies and tmp.
 * The architecture ledger is generated documentation bound by its own hash in
 * the candidate; regenerating it must not make a fresh acceptance stale. */
export function worktreeSnapshot(root, { exec = execFileSync } = {}) {
  const repo = resolve(root), reasons = [], files = []
  const git = (args) => {
    try { return exec('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
    catch { reasons.push(`git-${args[0]}-failed`); return null }
  }
  const headSha = git(['rev-parse', 'HEAD'])?.trim() || null
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (!headSha) reasons.push('head-unavailable')
  const tokens = status?.split('\0') ?? []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token) continue
    if (token.length < 4) { reasons.push('invalid-status'); continue }
    const flag = token.slice(0, 2), name = token.slice(3).replaceAll('\\', '/')
    if (/[RC]/.test(flag)) i += 1
    if (EXCLUDED_PREFIXES.some(p => name === p.slice(0, -1) || name.startsWith(p))) continue
    if (files.length >= MAX_FILES) { reasons.push('file-limit'); break }
    let hash, omitted = false
    try {
      const stat = lstatSync(join(repo, name))
      if (!stat.isFile()) { hash = 'not-a-file'; omitted = true }
      else if (stat.size > MAX_FILE_BYTES) { hash = `oversize:${stat.size}`; omitted = true }
      else hash = createHash('sha256').update(readFileSync(join(repo, name))).digest('hex')
    } catch (error) {
      if (error.code === 'ENOENT' && flag.includes('D')) hash = 'deleted'
      else { hash = 'unreadable'; omitted = true }
    }
    if (omitted) reasons.push(`unverified-file:${name}`)
    files.push({ path: name, status: flag.trim(), hash, omitted })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const complete = reasons.length === 0
  return { headSha, files, complete, reasons, treeHash: sha256({ headSha, complete, files }) }
}

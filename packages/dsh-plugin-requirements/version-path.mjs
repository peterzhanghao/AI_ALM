import { isAbsolute, relative, resolve } from 'node:path'
import { runCaptured } from '../alm-core/src/process-capture.mjs'

function git(root, args) {
  const result = runCaptured('git', ['-C', root, ...args])
  if (result.error) throw Object.assign(new Error(`git ${args[0]} failed: ${result.error.code ?? result.error.message}`), { code: result.error.code })
  if (result.status !== 0) throw Object.assign(new Error(`git ${args[0]} exited ${result.status}`), { code: 'git-failed', stderr: result.stderr })
  return String(result.stdout ?? '')
}

/** Resolve the path recorded at a file-history commit, following committed renames. */
export function versionPath(root, file, ref) {
  const top = git(root, ['rev-parse', '--show-toplevel']).trim()
  const current = relative(top, resolve(root, file)).replace(/\\/g, '/')
  if (current === '..' || current.startsWith('../') || isAbsolute(current)) throw new Error('file outside repository')
  const commit = git(top, ['rev-parse', '--verify', `${ref}^{commit}`]).trim()
  const tokens = git(top, ['log', '--follow', '--format=%H', '--name-only', '-z', '--', current]).split('\0')
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    const sha = tokens[i]
    const path = tokens[i + 1].replace(/^\n/, '')
    if (!/^[0-9a-f]{40,64}$/.test(sha) || !path) throw new Error('invalid file history')
    if (sha === commit) return { top, path }
  }
  return { top, path: current }
}

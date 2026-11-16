import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A delivery sandbox can forbid child-process pipes while still allowing an
// inherited file descriptor. Before this fallback, every `git rev-parse` there
// failed with EPERM, the caller read it as "not a git repository", and a round
// could only verify its own work through an external NODE_OPTIONS shim.
const BLOCKED_SPAWN = new Set(['EPERM', 'EACCES'])

/** Run git and return trimmed stdout; retry through a file when pipes are blocked. */
export function gitText(root, args) {
  if (process.env.ALM_GIT_FILE_STDIO === '1') return gitTextViaFile(root, args)
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch (error) {
    if (!BLOCKED_SPAWN.has(error?.code)) throw error
    return gitTextViaFile(root, args)
  }
}

/** Same call with stdout redirected to a temp file instead of a pipe. */
function gitTextViaFile(root, args) {
  const directory = mkdtempSync(join(tmpdir(), 'alm-git-'))
  const file = join(directory, 'stdout')
  let fd = null
  try {
    fd = openSync(file, 'w')
    const result = spawnSync('git', ['-C', root, ...args], { stdio: ['ignore', fd, 'ignore'] })
    closeSync(fd)
    fd = null
    if (result.error) throw Object.assign(new Error(`git ${args[0]} failed: ${result.error.code ?? result.error.message}`), { code: result.error.code })
    if (result.status !== 0) throw Object.assign(new Error(`git ${args[0]} exited ${result.status}`), { code: 'git-failed' })
    return readFileSync(file, 'utf8').trim()
  } finally {
    if (fd !== null) { try { closeSync(fd) } catch {} }
    rmSync(directory, { recursive: true, force: true })
  }
}

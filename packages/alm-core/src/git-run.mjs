import { runCaptured } from './process-capture.mjs'

// A delivery sandbox can forbid child-process pipes while still allowing an
// inherited file descriptor. `runCaptured` retries through temp files, so git
// helpers keep working instead of the caller reading EPERM as "not a git
// repository" and giving up on its own verification.
export function gitText(root, args) {
  const result = runCaptured('git', ['-C', root, ...args], { encoding: 'utf8' })
  if (result.error) {
    throw Object.assign(new Error(`git ${args[0]} failed: ${result.error.code ?? result.error.message}`), { code: result.error.code })
  }
  if (result.status !== 0) {
    throw Object.assign(new Error(`git ${args[0]} exited ${result.status}`), { code: 'git-failed', stderr: result.stderr })
  }
  return String(result.stdout ?? '').trim()
}

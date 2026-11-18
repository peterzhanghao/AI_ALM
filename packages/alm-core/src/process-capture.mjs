import { spawnSync } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A delivery sandbox can forbid piping a child's stdio while still allowing a
// file descriptor. Callers used to special-case EPERM one by one (git, tests,
// fixtures); this module is the single retry point so a capture works in both
// environments without every caller re-implementing the fallback.
export const BLOCKED_SPAWN_CODES = new Set(['EPERM', 'EACCES'])

export function isBlockedSpawnError(error) {
  return BLOCKED_SPAWN_CODES.has(error?.code)
}

/**
 * Run a process and capture stdout/stderr. Pipes are attempted first because
 * they are the normal, fast path; a blocked pipe falls back to temporary files
 * so the same call keeps working inside a confined delivery sandbox.
 */
export function runCaptured(command, args = [], {
  cwd,
  input,
  timeout,
  env,
  encoding = 'utf8',
  maxBuffer = 20 * 1024 * 1024,
  forceFile = process.env.ALM_FILE_STDIO === '1',
} = {}) {
  if (!forceFile) {
    const result = spawnSync(command, args, {
      cwd,
      input,
      timeout,
      env,
      encoding,
      maxBuffer,
      windowsHide: true,
    })
    if (!isBlockedSpawnError(result.error)) return result
  }
  return captureViaFiles(command, args, { cwd, input, timeout, env, encoding })
}

/** Same invocation with stdin/stdout/stderr redirected to real files. */
function captureViaFiles(command, args, { cwd, input, timeout, env, encoding }) {
  const directory = mkdtempSync(join(tmpdir(), 'alm-capture-'))
  const stdinPath = join(directory, 'stdin')
  const stdoutPath = join(directory, 'stdout')
  const stderrPath = join(directory, 'stderr')
  const fds = []
  try {
    let stdin = 'ignore'
    if (input !== undefined && input !== null) {
      writeFileSync(stdinPath, input)
      stdin = openSync(stdinPath, 'r')
      fds.push(stdin)
    }
    const stdout = openSync(stdoutPath, 'w')
    const stderr = openSync(stderrPath, 'w')
    fds.push(stdout, stderr)
    const result = spawnSync(command, args, {
      cwd,
      timeout,
      env,
      stdio: [stdin, stdout, stderr],
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    })
    for (const fd of fds) closeSync(fd)
    fds.length = 0
    return {
      ...result,
      stdout: readFileSync(stdoutPath, encoding),
      stderr: readFileSync(stderrPath, encoding),
      fileFallback: true,
    }
  } finally {
    for (const fd of fds) {
      try { closeSync(fd) } catch {}
    }
    rmSync(directory, { recursive: true, force: true })
  }
}

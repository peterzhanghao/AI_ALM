import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export class OcrError extends Error {
  constructor(message) {
    super(message)
    this.name = 'OcrError'
  }
}

/**
 * Resolve the local engine used by dsh-ocr-local. The engine itself lives in
 * ~/.dsh-ocr (shared by profiles); the Python script comes from whichever
 * profile has the plugin installed.
 */
export function resolveOcrRuntime({ env = process.env, home = homedir(), platform = process.platform } = {}) {
  const venvPython = platform === 'win32'
    ? join(home, '.dsh-ocr', 'venv', 'Scripts', 'python.exe')
    : join(home, '.dsh-ocr', 'venv', 'bin', 'python')
  const python = env.DSH_OCR_PYTHON || venvPython

  if (env.DSH_OCR_SCRIPT) return { python, script: env.DSH_OCR_SCRIPT }

  const profiles = join(home, '.dsh', 'profiles')
  if (existsSync(profiles)) {
    for (const entry of readdirSync(profiles, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const script = join(profiles, entry.name, 'node_modules', 'dsh-ocr-local', 'ocr', 'ocr.py')
      if (existsSync(script)) return { python, script }
    }
  }
  return { python, script: '' }
}

/** ocr.py prints diagnostics first and the machine-readable JSON last. */
export function parseOcrJson(stdout) {
  const lines = String(stdout).split(/\r?\n/).filter((line) => line.trim() !== '')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const payload = JSON.parse(lines[index])
      if (payload && Array.isArray(payload.lines)) return payload
    } catch {
      // keep scanning upwards
    }
  }
  throw new OcrError('cannot parse OCR output')
}

export function normalizeOcrResult(payload, image) {
  const lines = (payload.lines ?? []).map((entry, index) => ({
    index: index + 1,
    text: String(entry.text ?? ''),
    confidence: Number(entry.confidence ?? 0),
    fontPx: entry.font_px ?? null,
    lowConfidence: Boolean(entry.low_confidence),
    ref: `${image}#L${index + 1}`,
  }))
  const blocks = (payload.blocks ?? []).map((entry, index) => ({
    index: index + 1,
    text: String(entry.text ?? ''),
    confidence: Number(entry.confidence ?? 0),
    box: entry.box ?? null,
  }))
  return {
    schema: 'alm.ocr/v1',
    image,
    engine: payload.engine ?? 'ppocrv5',
    text: lines.map((line) => line.text).join('\n'),
    lines,
    blocks,
    lowConfidence: lines.filter((line) => line.lowConfidence).length,
  }
}

function defaultRun(python, args, { timeoutMs }) {
  return spawnSync(python, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  })
}

/**
 * Run the local PP-OCRv5 engine on one image and normalize its output.
 * `run` is injectable so the adapter can be tested without Python.
 */
export function runOcr(image, { runtime = resolveOcrRuntime(), run = defaultRun, timeoutMs = 120000 } = {}) {
  if (!existsSync(image)) throw new OcrError(`image not found: ${image}`)
  if (!runtime.script || !existsSync(runtime.script)) {
    throw new OcrError('dsh-ocr-local is not installed; run ocr_setup or set DSH_OCR_SCRIPT')
  }
  const result = run(runtime.python, [runtime.script, image, '--full'], { timeoutMs })
  if (result.error) throw new OcrError(`OCR failed: ${result.error.message}`)
  if (result.status !== 0) throw new OcrError(`OCR exited ${result.status}: ${String(result.stderr ?? '').trim()}`)
  return normalizeOcrResult(parseOcrJson(result.stdout), image)
}

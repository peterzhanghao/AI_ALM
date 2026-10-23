#!/usr/bin/env node
/**
 * Verify every ALM skill against the live CLI and the registered Agent tools.
 *
 * Dev skills live in `.dsh/skills/`; product skills ship in `packages/alm-skills/`
 * and are installed into a target workspace by `scripts/demo-init.ps1`.
 *
 * Fails when a skill cites a command missing from `alm --help`, links a file
 * that does not exist, claims a tool the core plugin does not register, or
 * exceeds the size/naming limits. See `scripts/lib/skill-check.mjs`.
 */
import { fileURLToPath } from 'node:url'
import { HELP } from '../packages/alm-core/src/cli.mjs'
import { checkSkills } from './lib/skill-check.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const result = checkSkills({ root, help: HELP })

for (const skill of result.skills) {
  console.log(`ok  ${skill.label}: ${skill.commands} commands, ${skill.bytes} bytes`)
}

if (!result.ok) {
  for (const failure of result.failures) {
    console.error(`FAIL  ${failure.skill} ${failure.file}:${failure.line} ${failure.message}`)
  }
  console.error(`\n${result.failures.length} problem(s) across ${result.skills.length} skill(s)`)
  process.exit(1)
}

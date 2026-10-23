import * as cov001 from './rules/cov-001.mjs'
import * as cov002 from './rules/cov-002.mjs'
import * as id001 from './rules/id-001.mjs'
import * as id002 from './rules/id-002.mjs'
import * as rel001 from './rules/rel-001.mjs'
import * as rel002 from './rules/rel-002.mjs'
import * as ren001 from './rules/ren-001.mjs'
import * as ren002 from './rules/ren-002.mjs'
import * as sec001 from './rules/sec-001.mjs'
import * as state001 from './rules/state-001.mjs'

/**
 * R1 rule pack. `FMT-001`/`FMT-002` are produced by the parse layer and appear
 * as checks when a source fails to parse; the rules below evaluate parsed
 * assets. Adding a rule means appending it here and bumping `pack.json`.
 */
export const rules = [
  id001,
  id002,
  rel001,
  rel002,
  cov001,
  cov002,
  state001,
  sec001,
  ren001,
  ren002,
]

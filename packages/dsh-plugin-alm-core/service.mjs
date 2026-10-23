import { checkReport, indexReport, queryReport, showReport } from '../alm-core/src/commands.mjs'

/** Pure service facade over alm-core; no DSH APIs, trivially testable. */
export function index(root) {
  return indexReport(root)
}

export function check(root, options = {}) {
  return checkReport(root, options)
}

export function show(root, id) {
  return showReport(root, id)
}

export function query(root, filter = {}) {
  return queryReport(root, filter)
}

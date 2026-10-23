import { checkReport, indexReport, queryReport, showReport } from '../alm-core/src/commands.mjs'
import { createWorkspace, guardWrite, statusWorkspace } from '../alm-core/src/workspace/workspace.mjs'

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

export function workspaceCreate(root, options) {
  return createWorkspace({ root, baseline: options.baseline, changeId: options.changeId })
}

export function workspaceStatus(root) {
  return statusWorkspace({ root })
}

export function workspaceGuard(root, options) {
  return guardWrite({ root, changeId: options.changeId, paths: options.paths })
}

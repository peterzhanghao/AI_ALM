/**
 * STATE-001 (legacy, retired): status transitions are no longer a gate.
 *
 * `asset.status` used to be the delivery lifecycle, which forced every real
 * decision through an enum that could drift from the evidence. The lifecycle is
 * now derived from the delivery candidate + evidence decision + execution run
 * (packages/alm-core/src/requirements/delivery.mjs). New records do not carry a
 * status at all, and a historical value is read-only.
 *
 * The rule id stays registered so existing gate configurations and reports keep
 * resolving; it reports `skip` with the downgrade reason instead of pretending
 * to validate a field that no longer governs anything.
 */
export const id = 'STATE-001'
export const level = 'block'
export const legacy = true

export function check() {
  return {
    status: 'skip',
    findings: [],
    message: 'STATUS 已下线（legacy 只读）；交付状态由 candidate + evidence + run 派生（STATE-001 保留为空规则）',
  }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client-source.js', import.meta.url), 'utf8')

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start)
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`)
  return source.slice(start, end)
}

test('intent confirmation derives one non-contradictory phase from readiness and pending work', () => {
  const phase = section('      const draftPhase = () => {', '      const enterConfirm = async () => {')
  assert.match(phase, /if \(analysisPending\(\)\) return \{ tone: 'neutral', label: '重新分析中' \}/)
  assert.match(phase, /if \(gate\.ready\) return \{ tone: 'success', label: '草稿可确认' \}/)
  assert.match(phase, /state === 'failed'\) return \{ tone: 'error', label: '分析失败' \}/)

  const review = section('      const renderReview = () => {', '      const renderRehearsal = () => {')
  assert.match(review, /tonePill\(draftPhase\(\)\.tone, draftPhase\(\)\.label\)/)
  assert.doesNotMatch(review, /INTENT_STATE_LABELS\[session\?\.state\]/)
})

test('needs-priority may enter the final form but remains in the authoritative save gate', () => {
  const gates = section('      const confirmationGate = (humanConfirmation = false) => {', '      const draftPhase = () => {')
  assert.match(gates, /const gate = confirmationGate\(\)/)
  assert.match(gates, /filter\(\(entry\) => entry\?\.code !== 'needs-priority' && entry\?\.code !== 'invalid-priority' && entry\?\.code !== 'not-confirmed'\)/)
  assert.match(gates, /return \{ ready: reasons\.length === 0, reasons, finalGate: gate \}/)

  const enter = section('      const enterConfirm = async () => {', '      const submitConfirm = () => {')
  assert.match(enter, /gate\.reasons\.some\(\(entry\) => entry\?\.code === 'needs-priority' \|\| entry\?\.code === 'invalid-priority'\)/)
  assert.match(enter, /priorityRef\.current\?\.focus\?\.\(\)/)

  const confirm = section('      const renderConfirm = () => {', '      const renderReceipt = () => {')
  assert.match(confirm, /data-testid': 'intent-priority-select'/)
  assert.match(confirm, /gate\.reasons\.map/)
})

test('blocked review keeps its reason beside the disabled primary action without a competing footer button', () => {
  const review = section('      const renderReview = () => {', '      const renderRehearsal = () => {')
  assert.match(review, /id: 'intent-confirm-blocker'/)
  assert.match(review, /data-testid': 'intent-confirm-blocker'/)
  assert.match(review, /tabIndex: -1/)
  assert.match(review, /role: 'status'/)
  assert.match(review, /confirmDochash\(\)/)
  assert.match(review, /重新分析/)

  const footer = section('      const footerFor = () => {', '      const title =')
  assert.doesNotMatch(footer, /intent-footer-blocker/)
  assert.doesNotMatch(footer, /key: 'again'/)
  assert.doesNotMatch(footer, /confirmDochash\(\)/)
  assert.match(footer, /data-testid': 'intent-enter-confirm'/)
  assert.match(footer, /'aria-describedby': blockerText \? 'intent-confirm-blocker' : undefined/)
})

test('review and final save are distinct actions and only final save calls submitConfirm', () => {
  const footer = section('      const footerFor = () => {', '      const title =')
  const enterLabel = footer.indexOf("'保存并检查，进入最终确认'")
  const saveLabel = footer.indexOf("'确认并保存这份草案'")
  assert.ok(enterLabel >= 0 && saveLabel > enterLabel)
  assert.match(footer, /data-testid': 'intent-enter-confirm'[\s\S]*onClick: enterConfirm/)
  assert.match(footer, /key: 'save'[\s\S]*onClick: submitConfirm/)
  assert.equal((footer.match(/onClick: submitConfirm/g) ?? []).length, 1)
})

test('running group analysis locks edits, option controls, and duplicate submission', () => {
  const groupState = section('      const groupInteractionLocked = () =>', '      const groupAnswersPayload = (group) => {')
  assert.match(groupState, /groupBusy \|\| groupFeedback\?\.kind === 'running'/)
  assert.match(groupState, /if \(groupInteractionLocked\(\)\) return/)

  const card = section('      const renderGroupQuestionCard = (question, index) => {', '      const renderRecommendationCard = (question, index) => {')
  assert.match(card, /const interactionLocked = groupInteractionLocked\(\)/)
  assert.match(card, /disabled: interactionLocked/g)
  assert.match(card, /if \(groupInteractionLocked\(\)\) return/)

  const submit = section('      const submitGroupAnswers = () => {', '      const cancelGroupSubmit = () => {')
  assert.match(submit, /if \(!group \|\| groupInteractionLocked\(\)\) return/)
})

test('answer choices and recommendations clearly remain pending until the one group submit', () => {
  const group = section('      const renderQuestionGroup = () => {', '      const renderConfirmedDecisions = () => {')
  assert.match(group, /data-testid': 'intent-submit-group'/)
  assert.match(group, /`待提交 \$\{dirtyCount\} 条`/)
  assert.match(group, /推荐不会自动采用；点击采用后仍需统一提交/)

  const recommendation = section('      const renderRecommendationCard = (question, index) => {', '      const renderGroupFeedback = () => {')
  assert.match(recommendation, /const persisted = question\.status === 'answered'/)
  assert.match(recommendation, /disabled: interactionLocked \|\| persisted \|\| !recommendedOption/)
  assert.match(recommendation, /'aria-pressed': adopted/)
  assert.match(recommendation, /'已选择，尚未提交；请点击“提交本组回答”。'/)
  assert.match(recommendation, /'推荐已作为明确回答保存；如需更改，请在“已确认决定”中修改对应问题。'/)
  assert.match(recommendation, /persisted \? '已采用并提交' : adopted \? '取消待提交采用' : '采用推荐'/)
})

test('intent screen transition focus has a visible outline', () => {
  assert.match(source, /data-intent-screen-heading': 'true'/)
  assert.match(source, /\[role="dialog"\] \[data-intent-screen-heading\]:focus\s*\{[^}]*outline:\s*2px solid/)
  assert.doesNotMatch(source, /data-intent-screen-heading': 'true'[^\n]*outline: 'none'/)
})

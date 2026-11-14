#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { handleIntentRequest } from '../intent.mjs'
import { randomBytes } from 'node:crypto'
import { collectEvidence, revalidateInvestigation, writeInvestigation, INVESTIGATION_SCHEMA } from '../investigate.mjs'
import { crystallizeChatDraft } from '../intake.mjs'
import { indexReport } from '../../alm-core/src/commands.mjs'
import { normalizeDoc, parseDoc, renderDoc } from '../../alm-core/src/requirements/doc.mjs'
import { confirmSpecDelta, proposeSpecDelta, requirementSpecContext, resynthesizeRequirementSpec } from '../../alm-core/src/requirements/convergence.mjs'
import { matchRequirement } from '../../alm-core/src/requirements/matcher.mjs'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  process.stdout.write('Usage: node packages/dsh-plugin-requirements/bin/crystallize.mjs --root <workspace> [--source-session <title-or-id>] [--update <REQ-ID>] [--feedback <summary>|--text <summary>] [--investigation <INV-ID>] [--apply]\nWithout --update, feedback is matched to active requirements. --apply saves; omit it to preview.\n')
  process.exit(0)
}
const values = {}
for (let i = 0; i < args.length; i++) {
  const key = args[i]
  if (key === '--apply') { values.apply = true; continue }
  if (!['--root', '--investigation', '--text', '--feedback', '--source-session', '--update'].includes(key) || !args[i + 1]) throw new Error(`Invalid argument: ${key}`)
  values[key.slice(2)] = args[++i]
}
if (!values.root) throw new Error('Specify --root; use --help for details')
const root = resolve(values.root)
if (values.text && values.feedback) throw new Error('Use either --text or --feedback, not both')
const summary = values.feedback ?? values.text ?? readFileSync(0, 'utf8')
const automaticMatch = values.update ? null : matchRequirement({ root, text: summary })
if (!values.update && ['high', 'medium'].includes(automaticMatch.confidence) && automaticMatch.matchedReqId) values.update = automaticMatch.matchedReqId
if (!values.update && !values.investigation) {
  const evidence = collectEvidence({ root, question: summary })
  const snippet = evidence.snippets.find(entry => entry.text?.length >= 8)
  if (!snippet) throw new Error('未找到可核对的匹配代码行；请补充代码线索或传入已有 --investigation，未创建需求')
  const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const investigation = { schema: INVESTIGATION_SCHEMA, investigationId: `INV-${stamp}-${randomBytes(3).toString('hex')}`, source: 'observed_evidence', verdict: 'answered', question: summary.slice(0, 2000), findings: [{ claim: '检索命中的代码原文，相关性待人工核对', refs: [{ path: snippet.path, line: snippet.line, endLine: snippet.line, quote: snippet.text, verified: true }] }], createdAt: new Date().toISOString() }
  if (!revalidateInvestigation(root, investigation)) throw new Error('代码证据已变化，未创建需求')
  writeInvestigation(root, investigation)
  values.investigation = investigation.investigationId
}
if (values.update) {
  const matches = indexReport(root).assets.filter(asset => asset.id === values.update && asset.type === 'requirement')
  if (matches.length !== 1 || !matches[0].extra?.brief) throw new Error('需求不存在、重复或没有正文')
  const draft = crystallizeChatDraft({ summary })
  if (!draft.title || !draft.goal || !draft.problem || !draft.acceptance.length) throw new Error('需要标题、目标、问题和验收标准')
  const asset = matches[0]
  const beforeBrief = readFileSync(resolve(root, asset.extra.brief), 'utf8')
  const previous = parseDoc(beforeBrief)
  const next = normalizeDoc({ ...previous.doc, title: draft.title, goal: draft.goal, problem: draft.problem, acceptance: draft.acceptance.map(text => ({ text, provenance: 'human-edit' })) }, { previous: previous.doc })
  const afterBrief = resynthesizeRequirementSpec({ beforeBrief, feedback: summary, proposedBrief: renderDoc(next) })
  const evolutionNote = automaticMatch
    ? `🧲 跨会话自动吸附反馈：${summary.slice(0, 1000)}`
    : '主对话定稿'
  const proposal = proposeSpecDelta({ root, runId: requirementSpecContext(values.update), requirementId: values.update, afterBrief, evolutionNote, kind: 'spec_refinement', sourceSession: values['source-session'] })
  const result = values.apply ? confirmSpecDelta({ root, runId: requirementSpecContext(values.update), requirementId: values.update, deltaHash: proposal.deltaHash, baseRequirementHash: proposal.delta.baseRequirementHash, subject: { kind: 'human', id: 'human:local' } }) : null
  process.stdout.write(`${JSON.stringify({ ok: true, matched: automaticMatch, autoAttached: Boolean(automaticMatch), proposal, result }, null, 2)}\n`)
  process.exit(0)
}
const body = { action: 'crystallize', summary, investigationIds: [values.investigation], sourceSession: values['source-session'] }
const preview = await handleIntentRequest({ root, body })
const result = values.apply ? await handleIntentRequest({ root, body: { ...body, apply: true, draftHash: preview.draftHash } }) : preview
process.stdout.write(`${JSON.stringify({ ...result, matched: automaticMatch, autoAttached: false }, null, 2)}\n`)

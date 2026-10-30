import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, test } from 'node:test'
import { loadRepo } from '../../src/parse/load.mjs'
import { parseSdocAsset } from '../../src/parse/sdoc.mjs'
import { buildIndex } from '../../src/index/index.mjs'
import * as prj001 from '../../src/gates/rules/prj-001.mjs'
import { ProjectError, associateProject, listProjects, readProject, remoteSlug, verifyProject, writeProject } from '../../src/project/project.mjs'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const fixture = join(repoRoot, 'fixtures/order-refund')
const dirs = []

function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), 'alm-project-'))
  dirs.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/pay-platform.git'], { cwd: root })
  mkdirSync(join(root, 'requirements'))
  return root
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

test('remote slug normalizes https, ssh and bare forms', () => {
  assert.equal(remoteSlug('https://github.com/acme/pay-platform.git'), 'acme/pay-platform')
  assert.equal(remoteSlug('git@github.com:acme/pay-platform.git'), 'acme/pay-platform')
  assert.equal(remoteSlug('github.com/acme/pay-platform'), 'acme/pay-platform')
})

test('writeProject, readProject and verifyProject agree with the git remote', () => {
  const root = tempRepo()
  const written = writeProject({ root, id: 'PAY', name: '支付平台', githubRepo: 'acme/pay-platform', projectNumber: 3 })
  assert.equal(written.id, 'PAY')
  assert.equal(readProject(root).github.project.number, 3)

  const verified = verifyProject({ root })
  assert.equal(verified.ok, true)
  assert.deepEqual(verified.findings, [])

  execFileSync('git', ['remote', 'set-url', 'origin', 'https://github.com/acme/other.git'], { cwd: root })
  const failed = verifyProject({ root })
  assert.equal(failed.ok, false)
  assert.match(failed.findings[0].message, /remote acme\/other != acme\/pay-platform/)

  assert.throws(
    () => writeProject({ root, id: 'PAY', name: 'dup', githubRepo: 'acme/pay-platform' }),
    (error) => error instanceof ProjectError,
  )
})

test('associateProject creates and updates the project file on a workspace root', () => {
  const root = tempRepo()
  const created = associateProject({
    root,
    id: 'CRM',
    name: '客户 CRM',
    owner: 'acme',
    repo: 'crm-platform',
    projectNumber: 2,
    teams: ['CRM 团队'],
  })
  assert.equal(created.file, join(root, '.alm/project.json'))
  assert.deepEqual(created.remote, { slug: 'acme/pay-platform', matches: false })
  assert.equal(readProject(root).id, 'CRM')
  assert.equal(readProject(root).github.project.number, 2)
  assert.equal(created.teams[0], 'CRM 团队')

  const updated = associateProject({
    root,
    id: 'CRM',
    name: '客户 CRM v2',
    owner: 'acme',
    repo: 'pay-platform',
    projectNumber: 3,
  })
  assert.equal(updated.remote.matches, true)
  const project = readProject(root)
  assert.equal(project.name, '客户 CRM v2')
  assert.equal(project.github.project.number, 3)
})

test('invalid project ids and missing requirement roots are rejected', () => {
  const root = tempRepo()
  assert.throws(() => writeProject({ root, id: 'pay', name: 'x', githubRepo: 'acme/pay' }), /invalid project id/)
  const written = writeProject({ root, id: 'PAY', name: '支付', githubRepo: 'acme/pay' })
  assert.ok(written.file)
  rmSync(join(root, 'requirements'), { recursive: true, force: true })
  const result = verifyProject({ root })
  assert.ok(result.findings.some((finding) => finding.field === 'requirementRoot'))
})

test('registry lists projects and reports duplicates', () => {
  const a = tempRepo()
  const b = tempRepo()
  writeProject({ root: a, id: 'PAY', name: '支付', githubRepo: 'acme/pay' })
  writeProject({ root: b, id: 'CRM', name: '会员', githubRepo: 'acme/crm' })
  const registry = join(a, 'projects.json')
  writeFileSync(
    registry,
    JSON.stringify({
      schema: 'alm.projects/v1',
      projects: [
        { id: 'PAY', root: a },
        { id: 'CRM', root: b },
      ],
    }),
  )
  const listed = listProjects({ registry })
  assert.deepEqual(listed.projects.map((project) => project.id).sort(), ['CRM', 'PAY'])
  assert.deepEqual(listed.errors, [])

  writeFileSync(registry, JSON.stringify({ schema: 'alm.projects/v1', projects: [{ id: 'PAY', root: a }, { id: 'PAY', root: b }] }))
  const duplicated = listProjects({ registry })
  assert.equal(duplicated.projects.length, 1)
  assert.ok(duplicated.errors.some((error) => /!= project id/.test(error.message)))
})

test('PRJ-001 accepts the sample and rejects a mismatched requirement project', () => {
  const assets = loadRepo(fixture).assets
  assert.deepEqual(prj001.check({ root: fixture, assets }), [])

  const root = mkdtempSync(join(tmpdir(), 'alm-prj-gate-'))
  dirs.push(root)
  cpSync(fixture, root, { recursive: true })
  const projectPath = join(root, '.alm', 'project.json')
  const project = JSON.parse(readFileSync(projectPath, 'utf8'))
  project.id = 'CRM'
  writeFileSync(projectPath, JSON.stringify(project, null, 2))

  const broken = loadRepo(root).assets
  const findings = prj001.check({ root, assets: broken })
  assert.ok(findings.some((finding) => /PAY/.test(finding.message) && /CRM/.test(finding.message)))
})

test('SDoc PROJECT is parsed into extra.project', () => {
  const [asset] = parseSdocAsset(
    '[REQUIREMENT]\nUID: REQ-PAY-009\nTITLE: t\nSTATUS: proposed\nOWNER: team\nPROJECT: PAY\n',
    'requirements/x.sdoc',
  )
  assert.equal(asset.extra.project, 'PAY')
  const index = buildIndex([asset])
  assert.ok(index.byId.has('REQ-PAY-009'))
})

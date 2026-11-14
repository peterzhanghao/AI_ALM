import assert from 'node:assert/strict'
import test from 'node:test'

import { githubDeliveryLinks, githubWebUrl } from '../github-web.mjs'

test('normalizes HTTPS and SSH GitHub remotes into delivery links', () => {
  for (const remote of ['https://github.com/peterzhanghao/AI_ALM.git', 'git@github.com:peterzhanghao/AI_ALM.git', 'ssh://git@github.com/peterzhanghao/AI_ALM.git']) {
    const links = githubDeliveryLinks({
      remoteUrl: remote,
      devBranch: 'develop', mainBranch: 'main',
      devCommitSha: '1234567890abcdef', mainMergeCommitSha: 'abcdef0123456789',
      architectureDocPath: 'requirements/architecture/REQ-ALM-012-design.md',
    })
    assert.equal(links.repoWebUrl, 'https://github.com/peterzhanghao/AI_ALM')
    assert.equal(links.devBranchUrl, 'https://github.com/peterzhanghao/AI_ALM/tree/develop')
    assert.equal(links.mainBranchUrl, 'https://github.com/peterzhanghao/AI_ALM/tree/main')
    assert.equal(links.mainCommitUrl, 'https://github.com/peterzhanghao/AI_ALM/commit/abcdef0123456789')
    assert.equal(links.compareUrl, 'https://github.com/peterzhanghao/AI_ALM/compare/main...develop')
    assert.equal(links.architectureUrl, 'https://github.com/peterzhanghao/AI_ALM/blob/main/requirements/architecture/REQ-ALM-012-design.md')
  }
})

test('refuses non-GitHub and unsafe delivery link inputs', () => {
  assert.equal(githubWebUrl('https://example.test/org/repo.git'), null)
  const links = githubDeliveryLinks({ remoteUrl: 'https://github.com/a/b.git', devBranch: '../main', mainBranch: 'main' })
  assert.equal(links.devBranchUrl, null)
  assert.equal(links.mainBranchUrl, 'https://github.com/a/b/tree/main')
})

test('unsynced deliveries expose no clickable commit or archive links', () => {
  const links = githubDeliveryLinks({
    remoteUrl: 'https://github.com/a/b.git', devBranch: 'develop', mainBranch: 'main',
    devCommitSha: '1234567890abcdef', architectureDocPath: 'requirements/architecture/REQ-ALM-015-design.md',
    synced: false,
  })
  assert.equal(links.repoWebUrl, 'https://github.com/a/b')
  assert.equal(links.devBranchUrl, null)
  assert.equal(links.devCommitUrl, null)
  assert.equal(links.mainCommitUrl, null)
  assert.equal(links.architectureUrl, null)
})

test('an unmerged archive is pinned to the exact delivery commit', () => {
  const links = githubDeliveryLinks({
    remoteUrl: 'https://github.com/a/b.git', devBranch: 'develop', mainBranch: 'main',
    devCommitSha: '1234567890abcdef', architectureDocPath: 'requirements/architecture/REQ-ALM-015-design.md',
  })
  assert.equal(links.architectureUrl, 'https://github.com/a/b/blob/1234567890abcdef/requirements/architecture/REQ-ALM-015-design.md')
})

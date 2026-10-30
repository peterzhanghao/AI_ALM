import { execFileSync } from 'node:child_process'

/**
 * GitHub board/issue adapter. `repo` is `owner/name`; `projectNumber` is the
 * per-repository ProjectV2 board number. Tests inject their own adapter, so
 * this module is the only place that shells out to `gh`.
 */
export function githubProvider({ repo, owner, labels = [], projectNumber } = {}) {
  const gh = (args) =>
    execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

  const repoArgs = repo ? ['--repo', repo] : []

  return {
    name: 'github',
    find(title) {
      const listed = JSON.parse(
        gh(['issue', 'list', ...repoArgs, '--state', 'all', '--limit', '100', '--json', 'number,url,title']),
      )
      const match = listed.find((issue) => issue.title === title)
      return match ? { number: match.number, url: match.url, title: match.title } : null
    },
    create({ title, body, labels: extra = [], parent }) {
      const args = ['issue', 'create', ...repoArgs, '--title', title, '--body', body, '--label', [...labels, ...extra].join(',')]
      if (parent) args.push('--parent', String(parent))
      const url = gh(args)
      const number = Number(url.split('/').pop())
      return { number: Number.isFinite(number) ? number : null, url, title }
    },
    addToProject(url, number = projectNumber) {
      if (!number || !owner) return null
      gh(['project', 'item-add', String(number), '--owner', owner, '--url', url])
      return { number, url }
    },
  }
}

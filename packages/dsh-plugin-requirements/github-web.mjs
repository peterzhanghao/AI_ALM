/**
 * Convert a GitHub clone URL into safe, browser-facing delivery links.
 * The plugin deliberately emits no link for non-GitHub or malformed remotes:
 * delivery metadata must never become an arbitrary external navigation target.
 */
function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function gitHubPath(remoteUrl) {
  const raw = text(remoteUrl)
  if (!raw) return null
  const scp = /^git@github\.com:([^\s]+)$/i.exec(raw)
  if (scp) return scp[1]
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') return null
    if (parsed.hostname.toLowerCase() !== 'github.com') return null
    return parsed.pathname.replace(/^\/+/, '')
  } catch {
    return null
  }
}

export function githubWebUrl(remoteUrl) {
  const path = gitHubPath(remoteUrl)?.replace(/\.git$/i, '').replace(/\/+$/, '')
  if (!path || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)) return null
  return `https://github.com/${path}`
}

function branchPath(branch) {
  const value = text(branch)
  if (!value || value.includes('..') || value.startsWith('/') || /[?#\s\\]/.test(value)) return null
  return value.split('/').map(encodeURIComponent).join('/')
}

function sha(value) {
  const result = text(value)
  return result && /^[a-f0-9]{7,64}$/i.test(result) ? result.toLowerCase() : null
}

function repoPath(value) {
  const path = text(value)?.replaceAll('\\', '/').replace(/^\.\//, '')
  return path && !path.startsWith('/') && !path.split('/').includes('..') && !/[?#\s]/.test(path)
    ? path.split('/').map(encodeURIComponent).join('/')
    : null
}

/** Build all optional GitHub links for one requirement delivery. */
export function githubDeliveryLinks({ remoteUrl, devBranch, mainBranch, devCommitSha, mainMergeCommitSha, architectureDocPath, synced = true } = {}) {
  const repoWebUrl = githubWebUrl(remoteUrl)
  if (!repoWebUrl) return null
  const dev = branchPath(devBranch)
  const main = branchPath(mainBranch)
  const devSha = sha(devCommitSha)
  const mainSha = sha(mainMergeCommitSha)
  const archive = repoPath(architectureDocPath)
  // Pin an unmerged archive to the exact delivery commit. A branch name can
  // drift or never contain the file at all, which produced the 404 links.
  const archiveRef = mainSha ? main : (devSha ?? dev)
  const links = {
    repoWebUrl,
    devBranch: dev ? text(devBranch) : null,
    mainBranch: main ? text(mainBranch) : null,
    devCommitSha: devSha,
    mainMergeCommitSha: mainSha,
    devBranchUrl: dev ? `${repoWebUrl}/tree/${dev}` : null,
    mainBranchUrl: main ? `${repoWebUrl}/tree/${main}` : null,
    devCommitUrl: devSha ? `${repoWebUrl}/commit/${devSha}` : null,
    mainCommitUrl: mainSha ? `${repoWebUrl}/commit/${mainSha}` : null,
    compareUrl: main && dev ? `${repoWebUrl}/compare/${main}...${dev}` : null,
    architectureUrl: archive && archiveRef ? `${repoWebUrl}/blob/${archiveRef}/${archive}` : null,
  }
  // Nothing has reached the remote yet: do not advertise clickable delivery
  // links that would open a branch without the commit or a 404 archive path.
  if (!synced) return {
    ...links,
    devBranchUrl: null, devCommitUrl: null, mainCommitUrl: null, mainBranchUrl: null,
    compareUrl: null, architectureUrl: null,
  }
  return links
}

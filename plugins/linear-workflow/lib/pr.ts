export type PrInfo = {
  number: number
  url: string
  title: string
  headRefName: string
  headRefOid: string
  baseRefName: string
  isDraft: boolean
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | '' | null
  statusCheckRollup: { name?: string; context?: string; conclusion?: string | null; state?: string | null; status?: string | null }[]
}

export type LocalState = {
  branch: string
  dirty: string[]
  localHeadOid: string | null
}

export type ChecksSummary = { total: number; failed: string[]; pending: string[] }

export function summarizeChecks(rollup: PrInfo['statusCheckRollup']): ChecksSummary {
  const failed: string[] = []
  const pending: string[] = []
  for (const c of rollup) {
    const name = c.name ?? c.context ?? 'check'
    const result = (c.conclusion ?? c.state ?? '').toUpperCase()
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(result)) failed.push(name)
    else if (!result || ['PENDING', 'EXPECTED', 'IN_PROGRESS', 'QUEUED'].includes(result) || (c.status && c.status !== 'COMPLETED')) pending.push(name)
  }
  return { total: rollup.length, failed, pending }
}

export type PrVerdict = {
  verdict: 'ready' | 'wait' | 'stop'
  reasons: string[]
  pr: PrInfo | null
  checks: ChecksSummary | null
  candidates: { number: number; url: string; headRefName: string }[]
}

/**
 * Decide whether the issue's PR can be merged. `stop` needs a human; `wait` means only
 * checks are still running.
 */
export function evaluatePr(issueId: string, prs: PrInfo[], local: LocalState | null): PrVerdict {
  const candidates = prs.map(p => ({ number: p.number, url: p.url, headRefName: p.headRefName }))
  if (prs.length === 0) {
    return { verdict: 'stop', reasons: [`No open PR for ${issueId}. Run issue-review first.`], pr: null, checks: null, candidates }
  }
  if (prs.length > 1) {
    return { verdict: 'stop', reasons: [`${prs.length} open PRs mention ${issueId}; pick one.`], pr: null, checks: null, candidates }
  }
  const pr = prs[0] as PrInfo
  const reasons: string[] = []
  if (pr.isDraft) reasons.push('The PR is a draft.')
  if (pr.mergeable === 'CONFLICTING') reasons.push('The PR has merge conflicts.')
  if (pr.reviewDecision === 'CHANGES_REQUESTED') reasons.push('Changes were requested on the PR.')
  if (local && local.branch === pr.headRefName) {
    if (local.dirty.length) reasons.push(`Uncommitted changes on ${pr.headRefName} are not in the PR: ${local.dirty.slice(0, 5).join(', ')}${local.dirty.length > 5 ? ', …' : ''}`)
    if (local.localHeadOid && local.localHeadOid !== pr.headRefOid) reasons.push(`Local ${pr.headRefName} (${local.localHeadOid.slice(0, 8)}) differs from the PR head (${pr.headRefOid.slice(0, 8)}): push or pull first.`)
  }
  const checks = summarizeChecks(pr.statusCheckRollup ?? [])
  if (checks.failed.length) reasons.push(`Failed checks: ${checks.failed.join(', ')}`)
  if (reasons.length) return { verdict: 'stop', reasons, pr, checks, candidates }
  if (checks.pending.length) return { verdict: 'wait', reasons: [`Checks still running: ${checks.pending.join(', ')}`], pr, checks, candidates }
  return { verdict: 'ready', reasons: [], pr, checks, candidates }
}

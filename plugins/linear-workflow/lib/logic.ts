import type { Issue, IssueSource, SessionEntry } from '../types'
import type { IssueDetail } from './workflow.ts'

const ANY_ID = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/

export function idFromBranch(branch: string, teamKeys: string[]): string | undefined {
  if (teamKeys.length === 0) return undefined
  const re = new RegExp(`(?:^|/)(${teamKeys.join('|')})-(\\d+)(?:-|$)`, 'i')
  const m = re.exec(branch.trim())
  return m?.[1] && m[2] ? `${m[1].toUpperCase()}-${m[2]}` : undefined
}

export function idFromText(text: string): string | undefined {
  const m = ANY_ID.exec(text.toUpperCase())
  return m?.[1] && m[2] ? `${m[1]}-${m[2]}` : undefined
}

export function readEnvValue(text: string, key: string): string | undefined {
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (m?.[1] === key) return (m[2] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2')
  }
  return undefined
}

/** The issue named by the root branch, else by the most sub-project branches. */
export function pickSource(rootBranch: string, siteBranches: Record<string, string>, teamKeys: string[]): IssueSource | null {
  const rootId = idFromBranch(rootBranch, teamKeys)
  if (rootId) return { id: rootId, from: 'root', detail: rootBranch }

  const bySite = new Map<string, string[]>()
  for (const [site, branch] of Object.entries(siteBranches)) {
    const id = idFromBranch(branch, teamKeys)
    if (id) bySite.set(id, [...(bySite.get(id) ?? []), site])
  }
  if (bySite.size === 0) return null

  const top = [...bySite.entries()].sort((a, b) => b[1].length - a[1].length)[0]
  if (!top) return null
  const [id, sites] = top
  const others = bySite.size > 1 ? `, mixed: ${[...bySite.keys()].filter(k => k !== id).join(', ')}` : ''
  return { id, from: 'sites', detail: `${sites.length} project(s) on it${others}` }
}

/** Site keys the issue is scoped to through its labels (or its parent's); empty means every site. */
export function scopeSites(issue: Issue, siteKeys: string[]): string[] {
  const own = issue.labels.filter(l => siteKeys.includes(l))
  if (own.length > 0) return own
  return (issue.parent?.labels ?? []).filter(l => siteKeys.includes(l))
}

export function driftSite(
  filePath: string,
  sites: { key: string; path: string }[],
  scope: string[],
): string | undefined {
  if (scope.length === 0) return undefined
  const site = sites.find(s => filePath.startsWith(`${s.path.replace(/\/$/, '')}/`))
  return site && !scope.includes(site.key) ? site.key : undefined
}

/** The pane's view of an issue, from the shared fetch: latest comments, bodies capped. */
export function toPaneIssue(d: IssueDetail): Issue {
  return {
    identifier: d.identifier,
    title: d.title,
    url: d.url,
    state: d.state.name,
    stateType: d.state.type,
    priority: d.priorityLabel,
    labels: d.labels,
    parent: d.parent ? { identifier: d.parent.identifier, title: d.parent.title, labels: d.parent.labels } : null,
    assignee: d.assignee,
    cycle: d.cycle,
    milestone: d.milestone?.name ?? null,
    description: d.description.slice(0, 6000),
    children: d.children.map(c => ({ identifier: c.identifier, title: c.title, state: c.state.name, stateType: c.state.type })),
    comments: d.comments.slice(-3).map(c => ({ author: c.author, createdAt: c.createdAt.slice(0, 10), body: c.body.slice(0, 1200) })),
    links: d.links,
  }
}

/** The repo the session works in: the superproject when inside a submodule. */
export async function findRoot(git: (args: string[]) => Promise<string>): Promise<string> {
  return (await git(['rev-parse', '--show-superproject-working-tree'])) || (await git(['rev-parse', '--show-toplevel']))
}

/** API key: explicit option, then the environment, then `<root>/.env`. */
export function resolveApiKey(input: { option?: string; env?: string; envFileText?: string }): string | undefined {
  return input.option || input.env || (input.envFileText ? readEnvValue(input.envFileText, 'LINEAR_API_KEY') : undefined) || undefined
}

export function stateColor(type: string): string {
  switch (type) {
    case 'started': return 'yellow'
    case 'completed': return 'green'
    case 'canceled': return 'gray'
    case 'triage': return 'magenta'
    default: return 'blue'
  }
}

export const STALE_MS = 3 * 60 * 1000

export function isCheckout(command: string): boolean {
  return command.split(/&&|\|\||;|\n/).some(part => {
    if (!/\bgit\b(?:\s+-C\s+\S+|\s+-[-\w]+(?:=\S+)?)*\s+(?:checkout|switch)\b/.test(part)) return false
    return !/\s--(?:\s|$)/.test(part)
  })
}

export function checkoutLabel(checkout: string): string {
  const m = /\/worktrees\/([^/]+)\/?$/.exec(checkout)
  return m?.[1] ?? 'main'
}

export function liveOthers(entries: SessionEntry[], selfId: string, now: number): SessionEntry[] {
  return entries
    .filter(s => s.sessionId !== selfId && now - s.updatedAt < STALE_MS)
    .sort((a, b) => a.label.localeCompare(b.label) || (a.issue ?? '').localeCompare(b.issue ?? ''))
}

export type Conflict = { key: string; sessionId: string; text: string }

export function conflicts(self: { checkout: string; issue: string | null }, others: SessionEntry[]): Conflict[] {
  const found: Conflict[] = []
  for (const o of others) {
    if (self.issue && o.issue === self.issue) {
      found.push({ key: `same:${o.sessionId}:${o.issue}`, sessionId: o.sessionId, text: `another session (${o.label}) is also on ${o.issue}` })
    } else if (o.checkout === self.checkout && o.issue && self.issue && o.issue !== self.issue) {
      found.push({
        key: `checkout:${o.sessionId}:${o.issue}:${self.issue}`,
        sessionId: o.sessionId,
        text: `${o.issue} is being worked in this same checkout (${o.label}) — shared branch and tree`,
      })
    }
  }
  return found
}

export type SourceDecision = {
  /** Which issue the session shows: its pin, the branch's, or none. */
  use: 'pin' | 'branch' | 'none'
  pinned: string | null
  pinnedBy: string | null
  /** The branch issue this session took on by switching to it itself. */
  claimedBranch: string | null
}

/**
 * Decide which issue a session shows. A session only shows an issue it took on: a pin, a branch it
 * switched to itself, or a branch issue no other live session in the same checkout has claimed.
 */
export function decideSource(input: {
  fromBranch: IssueSource | null
  pinned: string | null
  pinnedBy: string | null
  previous: IssueSource | null
  branchMoved: boolean
  own: boolean
  claimedBranch: string | null
  claimedElsewhere: (id: string) => boolean
}): SourceDecision {
  const { fromBranch, previous, branchMoved, own, claimedElsewhere } = input
  let { pinned, pinnedBy, claimedBranch } = input
  // Only a switch this session made claims (or, onto a branch without an issue, releases) a branch issue.
  if (own && branchMoved) claimedBranch = fromBranch?.id ?? null

  if (branchMoved && !own) {
    // Another session moved the shared branch: keep the issue this session had claimed.
    if (!pinned && previous && claimedBranch === previous.id) {
      pinned = previous.id
      pinnedBy = 'held'
    }
  } else if (pinned && pinnedBy === 'held' && own && fromBranch?.id === pinned) {
    pinned = null
    pinnedBy = null
  } else if (pinned && branchMoved) {
    const release = pinnedBy === 'manual' ? fromBranch !== null && fromBranch.id !== pinned : fromBranch?.id !== pinned
    if (release) {
      pinned = null
      pinnedBy = null
    }
  }

  const decided = (use: SourceDecision['use']): SourceDecision => ({ use, pinned, pinnedBy, claimedBranch })
  if (pinned) return decided('pin')
  if (!fromBranch) return decided('none')
  if (claimedBranch === fromBranch.id) return decided('branch')
  if (claimedElsewhere(fromBranch.id)) return decided('none')
  return decided('branch')
}

/** Whether a tool call may have changed Linear, so the issue is worth fetching again. */
export function touchesLinear(tool: string, input: { command?: unknown; subagent_type?: unknown }): boolean {
  if (tool === 'Bash') return /linear-workflow\.ts"?\s+(transition|set-cycle)\b/.test(String(input.command ?? ''))
  if (tool === 'Agent') return /linear-manager/.test(String(input.subagent_type ?? ''))
  return /^mcp__.*linear.*__(save|create|update)_(issue|comment)$/i.test(tool)
}

import type { Issue, IssueSource, SessionEntry } from '../types'

const ANY_ID = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/

export function parseTeamKeys(value: unknown): string[] {
  return String(value ?? '')
    .split(/[\s,]+/)
    .map(k => k.trim().toUpperCase())
    .filter(k => /^[A-Z][A-Z0-9]{0,9}$/.test(k))
}

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

export function pickSource(
  rootBranch: string,
  siteBranches: Record<string, string>,
  pinned: string | null,
  teamKeys: string[],
): IssueSource | null {
  if (pinned) return { id: pinned, from: 'pinned', detail: 'pinned with /linear' }

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
  return { id, from: 'sites', detail: `${sites.length} site(s) on it${others}` }
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

export const ISSUE_QUERY = `query($id:String!){issue(id:$id){identifier title url priorityLabel description
state{name type} labels{nodes{name}} parent{identifier title labels{nodes{name}}}
children{nodes{identifier title state{name type}}} comments(last:3){nodes{body createdAt user{name}}}
attachments{nodes{title url}} assignee{name} cycle{number} projectMilestone{name}}}`

type Node<T> = { nodes: T[] }
type RawIssue = {
  identifier: string
  title: string
  url: string
  priorityLabel: string
  description: string | null
  state: { name: string; type: string }
  labels: Node<{ name: string }>
  parent: { identifier: string; title: string; labels: Node<{ name: string }> } | null
  children: Node<{ identifier: string; title: string; state: { name: string; type: string } }>
  comments: Node<{ body: string; createdAt: string; user: { name: string } | null }>
  attachments: Node<{ title: string; url: string }>
  assignee: { name: string } | null
  cycle: { number: number } | null
  projectMilestone: { name: string } | null
}

export function toIssue(raw: RawIssue): Issue {
  return {
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    state: raw.state.name,
    stateType: raw.state.type,
    priority: raw.priorityLabel,
    labels: raw.labels.nodes.map(l => l.name),
    parent: raw.parent
      ? { identifier: raw.parent.identifier, title: raw.parent.title, labels: raw.parent.labels.nodes.map(l => l.name) }
      : null,
    assignee: raw.assignee?.name ?? null,
    cycle: raw.cycle?.number ?? null,
    milestone: raw.projectMilestone?.name ?? null,
    description: (raw.description ?? '').slice(0, 6000),
    children: raw.children.nodes.map(c => ({
      identifier: c.identifier,
      title: c.title,
      state: c.state.name,
      stateType: c.state.type,
    })),
    comments: raw.comments.nodes.map(c => ({
      author: c.user?.name ?? 'bot',
      createdAt: c.createdAt.slice(0, 10),
      body: c.body.slice(0, 1200),
    })),
    links: raw.attachments.nodes.map(a => ({ title: a.title, url: a.url })),
  }
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

export const TEAMS_QUERY = `query{teams{nodes{key}}}`

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
  if (own && fromBranch) claimedBranch = fromBranch.id

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

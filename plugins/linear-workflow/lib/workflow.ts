import type { Client, IssueSummary, RawSummary, StateType } from './linear.ts'
import { isOpenType, LinearError, SUMMARY_FIELDS, toSummary } from './linear.ts'

export type ProjectConfig = {
  team?: string
  teamKey?: string
  project?: string
  assignee?: string
  baseBranch?: string
  checks?: string[]
  mergeMethod?: 'merge' | 'squash' | 'rebase' | 'local'
  deleteBranch?: boolean
  /** Your team's names for the three states the skills move issues to. */
  states?: StateNames
  /** What issue-start does about branches: create one (default), ask, or stay on the current one. */
  branching?: 'create' | 'ask' | 'none'
  /** Path (from the repo root) of a markdown template the agent uses for new issue descriptions. */
  issueTemplate?: string
}

export type StateNames = { inProgress?: string; inReview?: string; done?: string }

export function parseProjectConfig(text: string | undefined): ProjectConfig {
  if (!text) return {}
  const raw = JSON.parse(text) as Record<string, unknown>
  const out: ProjectConfig = {}
  for (const key of ['team', 'teamKey', 'project', 'assignee', 'baseBranch'] as const) {
    if (typeof raw[key] === 'string') out[key] = raw[key] as string
  }
  if (Array.isArray(raw.checks)) out.checks = raw.checks.filter((c): c is string => typeof c === 'string')
  if (['merge', 'squash', 'rebase', 'local'].includes(String(raw.mergeMethod))) {
    out.mergeMethod = raw.mergeMethod as ProjectConfig['mergeMethod']
  }
  if (typeof raw.deleteBranch === 'boolean') out.deleteBranch = raw.deleteBranch
  if (['create', 'ask', 'none'].includes(String(raw.branching))) out.branching = raw.branching as ProjectConfig['branching']
  if (typeof raw.issueTemplate === 'string') out.issueTemplate = raw.issueTemplate
  if (raw.states && typeof raw.states === 'object') {
    const st = raw.states as Record<string, unknown>
    const names: StateNames = {}
    for (const key of ['inProgress', 'inReview', 'done'] as const) if (typeof st[key] === 'string') names[key] = st[key] as string
    out.states = names
  }
  return out
}

/** `ENG-12`, `eng-12`, `#12` or `12` (with a single known team key) → `ENG-12`. */
export function normalizeId(input: string, teamKey?: string): string | undefined {
  const text = input.trim()
  const full = /^([A-Za-z][A-Za-z0-9]{0,9})-(\d+)$/.exec(text)
  if (full?.[1] && full[2]) return `${full[1].toUpperCase()}-${full[2]}`
  const bare = /^#?(\d+)$/.exec(text)
  if (bare?.[1] && teamKey) return `${teamKey.toUpperCase()}-${bare[1]}`
  return undefined
}

/** Team keys to look for in branch names: the repo's linear.json, then the user's plugin option, then your teams. */
export async function resolveTeamKeys(input: {
  option?: string
  configText?: string
  fetchMine?: () => Promise<string[]>
}): Promise<string[]> {
  let fromConfig: string[] = []
  try {
    fromConfig = splitKeys(parseProjectConfig(input.configText).teamKey)
  } catch {
    // unreadable linear.json: fall through
  }
  if (fromConfig.length) return fromConfig
  const fromOption = splitKeys(input.option)
  if (fromOption.length) return fromOption
  try {
    return input.fetchMine ? splitKeys((await input.fetchMine()).join(',')) : []
  } catch {
    return []
  }
}

function splitKeys(value: string | undefined): string[] {
  return String(value ?? '')
    .split(/[\s,]+/)
    .map(k => k.trim().toUpperCase())
    .filter(k => /^[A-Z][A-Z0-9]{0,9}$/.test(k))
}

/** Whole days from `today` (YYYY-MM-DD) to `date`; negative when overdue. */
export function daysUntil(date: string | null | undefined, today: string): number | null {
  if (!date) return null
  const ms = Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000)
}

// ---------- ranking (pure) ----------

function priorityRank(p: number): number {
  return p === 0 ? 5 : p
}

export function compareIssues(a: IssueSummary, b: IssueSummary): number {
  const byPriority = priorityRank(a.priority) - priorityRank(b.priority)
  if (byPriority) return byPriority
  const da = a.milestone?.targetDate ?? '9999-99-99'
  const db = b.milestone?.targetDate ?? '9999-99-99'
  if (da !== db) return da < db ? -1 : 1
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0
}

export function rank(issues: IssueSummary[]): IssueSummary[] {
  return [...issues].sort(compareIssues)
}

const ACTIONABLE: StateType[] = ['unstarted', 'started']

const REVIEW_NAMES = ['in review', 'review', 'to review', 'qa', 'in qa', 'code review']

let customStates: StateNames = {}

/** Apply the project's own state names (`states` in .claude/linear.json) for this process. */
export function useStateNames(names: StateNames | undefined): void {
  customStates = names ?? {}
}

/** Linear files review states under `started`, like In Progress; they are not work to pick up. */
export function isInReview(state: { name: string }): boolean {
  const name = state.name.trim().toLowerCase()
  return REVIEW_NAMES.includes(name) || name === customStates.inReview?.trim().toLowerCase()
}

export function isActionable(issue: IssueSummary): boolean {
  return ACTIONABLE.includes(issue.state.type) && !isInReview(issue.state) && issue.blockedBy.length === 0
}

// ---------- reads ----------

export type Cycle = { id: string; number: number; startsAt: string; endsAt: string; teamKey: string }

export async function activeCycle(client: Client, teamKey?: string): Promise<Cycle | null> {
  const data = await client.query<{ viewer: { teamMemberships: { nodes: { team: { key: string; activeCycle: { id: string; number: number; startsAt: string; endsAt: string } | null } }[] } } }>(
    `query{viewer{teamMemberships{nodes{team{key activeCycle{id number startsAt endsAt}}}}}}`,
  )
  const teams = data.viewer.teamMemberships.nodes.map(n => n.team)
  const team = teamKey ? teams.find(t => t.key.toUpperCase() === teamKey.toUpperCase()) : teams.find(t => t.activeCycle)
  if (teamKey && !team) throw new LinearError(`You are not a member of a team with key ${teamKey}`)
  return team?.activeCycle ? { ...team.activeCycle, teamKey: team.key } : null
}

export type QueueEntry = IssueSummary & { epic: { identifier: string; title: string } | null; dueInDays: number | null }
export type QueueResult = {
  cycle: Cycle | null
  examined: number
  candidates: QueueEntry[]
  droppedBlocked: string[]
  droppedEpics: { identifier: string; reason: string }[]
}

export async function queue(client: Client, opts: { teamKey?: string; limit?: number; today: string }): Promise<QueueResult> {
  const cycle = await activeCycle(client, opts.teamKey)
  if (!cycle) return { cycle: null, examined: 0, candidates: [], droppedBlocked: [], droppedEpics: [] }
  const data = await client.query<{ issues: { nodes: RawSummary[] } }>(
    `query($cycle:ID!){issues(first:250,filter:{cycle:{id:{eq:$cycle}},assignee:{isMe:{eq:true}},state:{type:{in:["unstarted","started"]}}}){nodes{${SUMMARY_FIELDS}}}}`,
    { cycle: cycle.id },
  )
  const issues = data.issues.nodes.map(toSummary).filter(i => !isInReview(i.state))
  const droppedBlocked = issues.filter(i => i.blockedBy.length > 0).map(i => i.identifier)
  const droppedEpics: QueueResult['droppedEpics'] = []
  const candidates: QueueEntry[] = []
  const due = (i: IssueSummary) => daysUntil(i.milestone?.targetDate, opts.today)

  const unblocked = issues.filter(i => i.blockedBy.length === 0)
  const isEpic = (i: IssueSummary) => i.state.type === 'started' && i.childCount > 0
  const nexts = await Promise.all(unblocked.map(i => (isEpic(i) ? nextChild(client, i.id) : Promise.resolve(null))))
  unblocked.forEach((issue, n) => {
    if (!isEpic(issue)) {
      candidates.push({ ...issue, epic: null, dueInDays: due(issue) })
      return
    }
    const next = nexts[n]
    if (next) candidates.push({ ...next, epic: { identifier: issue.identifier, title: issue.title }, dueInDays: due(next) })
    else droppedEpics.push({ identifier: issue.identifier, reason: 'no unblocked Todo or In Progress sub-issue' })
  })
  const seen = new Set<string>()
  const unique = candidates.filter(c => (seen.has(c.identifier) ? false : (seen.add(c.identifier), true)))
  return {
    cycle,
    examined: issues.length,
    candidates: rank(unique).slice(0, opts.limit ?? 10) as QueueEntry[],
    droppedBlocked,
    droppedEpics,
  }
}

async function nextChild(client: Client, parentId: string): Promise<IssueSummary | null> {
  const data = await client.query<{ issue: { children: { nodes: RawSummary[] } } }>(
    `query($id:String!){issue(id:$id){children(first:250,filter:{state:{type:{in:["unstarted","started"]}}}){nodes{${SUMMARY_FIELDS}}}}}`,
    { id: parentId },
  )
  return rank(data.issue.children.nodes.map(toSummary).filter(isActionable))[0] ?? null
}

export type PlanCycleResult = {
  cycle: (Cycle & { issueCount: number }) | null
  examined: number
  candidates: IssueSummary[]
  droppedBlocked: number
  droppedChildren: number
}

export async function planCycle(client: Client, opts: { teamKey?: string; project?: string; limit?: number }): Promise<PlanCycleResult> {
  const cycle = await activeCycle(client, opts.teamKey)
  if (!cycle) return { cycle: null, examined: 0, candidates: [], droppedBlocked: 0, droppedChildren: 0 }
  const projectFilter = opts.project ? `,project:{name:{eqIgnoreCase:$project}}` : ''
  const data = await client.query<{ issues: { nodes: RawSummary[] }; cycle: { issues: { nodes: { id: string }[] } } }>(
    `query($cycle:String!,$team:String!${opts.project ? ',$project:String!' : ''}){
      cycle(id:$cycle){issues(first:250){nodes{id}}}
      issues(first:250,filter:{cycle:{null:true},assignee:{isMe:{eq:true}},team:{key:{eq:$team}},state:{type:{in:["backlog","unstarted"]}}${projectFilter}}){nodes{${SUMMARY_FIELDS}}}}`,
    { cycle: cycle.id, team: cycle.teamKey, ...(opts.project ? { project: opts.project } : {}) },
  )
  const issues = data.issues.nodes.map(toSummary)
  const blocked = issues.filter(i => i.blockedBy.length > 0)
  const children = issues.filter(i => i.blockedBy.length === 0 && i.parent?.cycleId === cycle.id)
  const rest = issues.filter(i => i.blockedBy.length === 0 && i.parent?.cycleId !== cycle.id)
  return {
    cycle: { ...cycle, issueCount: data.cycle.issues.nodes.length },
    examined: issues.length,
    candidates: rank(rest).slice(0, opts.limit ?? 15),
    droppedBlocked: blocked.length,
    droppedChildren: children.length,
  }
}

export type Criterion = { text: string; checked: boolean }

/** The list items under an "Acceptance Criteria" heading (any level), with their checkbox state. */
export function parseAcceptanceCriteria(description: string): Criterion[] {
  const lines = description.split('\n')
  const start = lines.findIndex(l => /^#{1,6}\s*acceptance criteria\s*:?\s*$/i.test(l.trim()))
  if (start === -1) return []
  const out: Criterion[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line.trim())) break
    const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.+?)\s*$/.exec(line)
    if (m?.[2]) out.push({ text: m[2], checked: (m[1] ?? ' ').toLowerCase() === 'x' })
  }
  return out
}

export type IssueDetail = IssueSummary & {
  acceptanceCriteria: Criterion[]
  description: string
  teamKey: string
  assignee: string | null
  cycle: number | null
  children: { identifier: string; title: string; state: { name: string; type: StateType } }[]
  links: { title: string; url: string }[]
  comments: { id: string; author: string; createdAt: string; body: string }[]
}

/** The full issue. `latestComments` fetches only that many of the newest comments (the pane's need). */
export async function issueDetail(client: Client, id: string, opts: { latestComments?: number } = {}): Promise<IssueDetail> {
  const comments = opts.latestComments ? `comments(last:${Math.max(1, Math.floor(opts.latestComments))})` : 'comments(first:250)'
  const data = await client.query<{ issue: (RawSummary & {
    description: string | null
    team: { key: string }
    assignee: { name: string } | null
    cycle: { id: string; number: number } | null
    subIssues: { nodes: { identifier: string; title: string; state: { name: string; type: StateType } }[] }
    attachments: { nodes: { title: string; url: string }[] }
    comments: { nodes: { id: string; body: string; createdAt: string; user: { name: string } | null }[] }
  }) | null }>(
    `query($id:String!){issue(id:$id){${SUMMARY_FIELDS} description team{key} assignee{name} cycle{id number}
      subIssues: children(first:250){nodes{identifier title state{name type}}}
      attachments{nodes{title url}}
      ${comments}{nodes{id body createdAt user{name}}}}}`,
    { id },
  )
  if (!data.issue) throw new LinearError(`${id}: not found`)
  const raw = data.issue
  return {
    ...toSummary(raw),
    description: raw.description ?? '',
    acceptanceCriteria: parseAcceptanceCriteria(raw.description ?? ''),
    teamKey: raw.team.key,
    assignee: raw.assignee?.name ?? null,
    cycle: raw.cycle?.number ?? null,
    children: raw.subIssues.nodes,
    links: raw.attachments.nodes,
    comments: raw.comments.nodes
      .map(c => ({ id: c.id, author: c.user?.name ?? 'integration', createdAt: c.createdAt, body: c.body }))
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
  }
}

export async function myTeamKeys(client: Client): Promise<string[]> {
  const data = await client.query<{ viewer: { teamMemberships: { nodes: { team: { key: string } }[] } } }>(
    `query{viewer{teamMemberships{nodes{team{key}}}}}`,
  )
  return data.viewer.teamMemberships.nodes.map(n => n.team.key.toUpperCase())
}

export async function myOpenIssues(client: Client): Promise<IssueSummary[]> {
  const data = await client.query<{ issues: { nodes: RawSummary[] } }>(
    `query{issues(first:50,filter:{assignee:{isMe:{eq:true}},state:{type:{eq:"started"}}}){nodes{${SUMMARY_FIELDS}}}}`,
  )
  return data.issues.nodes.map(toSummary)
}

// ---------- writes ----------

export type TeamState = { id: string; name: string; type: StateType; position: number }

const ROLE_ALIASES: Record<string, string[]> = {
  'in progress': ['in progress', 'started', 'doing'],
  'in review': REVIEW_NAMES,
  done: ['done', 'completed', 'shipped', 'closed'],
}

const ROLE_KEYS: Record<string, keyof StateNames> = { 'in progress': 'inProgress', 'in review': 'inReview', done: 'done' }

/** Resolve a target like "In Review" against a team's workflow states, the project's own names first. */
export function resolveState(states: TeamState[], target: string): TeamState | undefined {
  const wanted = target.trim().toLowerCase()
  const role = Object.entries(ROLE_ALIASES).find(([, names]) => names.includes(wanted))
  const customName = role ? customStates[ROLE_KEYS[role[0]] as keyof StateNames]?.trim().toLowerCase() : undefined
  const custom = customName ? states.find(s => s.name.toLowerCase() === customName) : undefined
  if (custom) return custom
  const exact = states.find(s => s.name.toLowerCase() === wanted)
  if (exact) return exact
  if (role) {
    const byAlias = states.find(s => role[1].includes(s.name.toLowerCase()))
    if (byAlias) return byAlias
    const fallbackType: StateType = role[0] === 'done' ? 'completed' : 'started'
    const ofType = states.filter(s => s.type === fallbackType).sort((a, b) => a.position - b.position)
    return role[0] === 'in review' ? ofType[ofType.length - 1] : ofType[0]
  }
  return undefined
}

export type Role = 'done' | 'review'

/** The roll-up role of a target state, or null when a move there never rolls a parent up. */
export function rollUpRole(state: { name: string; type: StateType }): Role | null {
  if (state.type === 'completed') return 'done'
  return isInReview(state) ? 'review' : null
}

/** A sibling still owes work unless it is completed or canceled, or, for a review roll-up, in review. */
export function siblingsUnfinished(siblings: { identifier: string; state: { name: string; type: StateType } }[], role: Role): string[] {
  return siblings
    .filter(s => isOpenType(s.state.type) && !(role === 'review' && isInReview(s.state)))
    .map(s => s.identifier)
}

export type TransitionResult = {
  issue: string
  from: string
  to: string
  changed: boolean
  commented: boolean
  parent: { issue: string; rolledUp: boolean; unfinished: string[]; changed: boolean; note?: string } | null
}

type RawForTransition = {
  id: string
  identifier: string
  state: { id: string; name: string; type: StateType }
  team: { states: { nodes: TeamState[] } }
  parent: {
    id: string
    identifier: string
    state: { id: string; name: string }
    team: { states: { nodes: TeamState[] } }
    children: { nodes: { identifier: string; state: { name: string; type: StateType } }[] }
  } | null
}

export async function transition(client: Client, id: string, target: string, comment?: string): Promise<TransitionResult> {
  const data = await client.query<{ issue: RawForTransition | null }>(
    `query($id:String!){issue(id:$id){id identifier state{id name type} team{states{nodes{id name type position}}}
      parent{id identifier state{id name} team{states{nodes{id name type position}}}
        children(first:250){nodes{identifier state{name type}}}}}}`,
    { id },
  )
  const issue = data.issue
  if (!issue) throw new LinearError(`${id}: not found`)
  const state = resolveState(issue.team.states.nodes, target)
  if (!state) throw new LinearError(`No workflow state matches "${target}" (have: ${issue.team.states.nodes.map(s => s.name).join(', ')})`)

  const changed = issue.state.id !== state.id
  if (changed) await setState(client, issue.id, state.id)
  if (comment) await addComment(client, issue.id, comment)

  let parent: TransitionResult['parent'] = null
  const role = rollUpRole(state)
  if (role && issue.parent) {
    const siblings = issue.parent.children.nodes.map(s => (s.identifier === issue.identifier ? { ...s, state: { name: state.name, type: state.type } } : s))
    const unfinished = siblingsUnfinished(siblings, role)
    // The parent may live in another team: move it to that team's state for the same role.
    const resolved = resolveState(issue.parent.team.states.nodes, role === 'done' ? 'Done' : 'In Review')
    // resolveState falls back to an In Progress-like state; a review roll-up needs a real review state.
    const parentState = role === 'review' && resolved && !isInReview(resolved) ? undefined : resolved
    const parentChanged = unfinished.length === 0 && parentState !== undefined && issue.parent.state.id !== parentState.id
    if (parentChanged && parentState) {
      await setState(client, issue.parent.id, parentState.id)
      await addComment(client, issue.parent.id, 'All sub-issues complete.')
    }
    parent = {
      issue: issue.parent.identifier,
      rolledUp: unfinished.length === 0 && parentState !== undefined,
      unfinished,
      changed: parentChanged,
      ...(parentState ? {} : { note: `parent's team has no state for "${role}"` }),
    }
  }
  return { issue: issue.identifier, from: issue.state.name, to: state.name, changed, commented: Boolean(comment), parent }
}

async function setState(client: Client, issueId: string, stateId: string): Promise<void> {
  const r = await client.query<{ issueUpdate: { success: boolean } }>(
    `mutation($id:String!,$state:String!){issueUpdate(id:$id,input:{stateId:$state}){success}}`,
    { id: issueId, state: stateId },
  )
  if (!r.issueUpdate.success) throw new LinearError(`issueUpdate failed for ${issueId}`)
}

async function addComment(client: Client, issueId: string, body: string): Promise<void> {
  const r = await client.query<{ commentCreate: { success: boolean } }>(
    `mutation($id:String!,$body:String!){commentCreate(input:{issueId:$id,body:$body}){success}}`,
    { id: issueId, body },
  )
  if (!r.commentCreate.success) throw new LinearError(`commentCreate failed for ${issueId}`)
}

export type SetCycleResult = { cycle: number; set: string[]; already: string[]; failed: { issue: string; error: string }[] }

export async function setCycle(client: Client, teamKey: string | undefined, number: number, ids: string[]): Promise<SetCycleResult> {
  const team = teamKey ?? (await activeCycle(client))?.teamKey
  if (!team) throw new LinearError('No team: pass --team or set teamKey in .claude/linear.json')
  const found = await client.query<{ cycles: { nodes: { id: string; number: number }[] } }>(
    `query($team:String!,$n:Float!){cycles(filter:{team:{key:{eq:$team}},number:{eq:$n}}){nodes{id number}}}`,
    { team, n: number },
  )
  const target = found.cycles.nodes[0]
  if (!target) throw new LinearError(`Team ${team} has no cycle #${number}`)
  const out: SetCycleResult = { cycle: number, set: [], already: [], failed: [] }
  const results = await Promise.allSettled(
    ids.map(async id => {
      const cur = await client.query<{ issue: { id: string; cycle: { id: string } | null } | null }>(
        `query($id:String!){issue(id:$id){id cycle{id}}}`,
        { id },
      )
      if (!cur.issue) throw new LinearError('not found')
      if (cur.issue.cycle?.id === target.id) return 'already' as const
      const r = await client.query<{ issueUpdate: { success: boolean } }>(
        `mutation($id:String!,$c:String!){issueUpdate(id:$id,input:{cycleId:$c}){success}}`,
        { id: cur.issue.id, c: target.id },
      )
      if (!r.issueUpdate.success) throw new LinearError('issueUpdate failed')
      return 'set' as const
    }),
  )
  results.forEach((r, n) => {
    const id = ids[n] as string
    if (r.status === 'fulfilled') out[r.value].push(id)
    else out.failed.push({ issue: id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) })
  })
  return out
}

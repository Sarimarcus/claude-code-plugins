// Linear GraphQL client shared by the mod (through $.http.fetch) and the CLI (through fetch).

export type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number; text: string }>

export type StateType = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled'

export type IssueSummary = {
  id: string
  identifier: string
  title: string
  url: string
  priority: number
  priorityLabel: string
  state: { name: string; type: StateType }
  createdAt: string
  branchName: string
  milestone: { name: string; targetDate: string | null } | null
  labels: string[]
  parent: { identifier: string; title: string; cycleId: string | null } | null
  cycleId: string | null
  blockedBy: { identifier: string; state: string }[]
  childCount: number
}

export class LinearError extends Error {}

const ENDPOINT = 'https://api.linear.app/graphql'

export function createClient(fetcher: Fetcher, apiKey: string) {
  async function query<T>(text: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text, variables }),
    })
    let body: { data?: T; errors?: { message: string }[] }
    try {
      body = JSON.parse(res.text) as typeof body
    } catch {
      throw new LinearError(`Linear returned HTTP ${res.status} with a non-JSON body`)
    }
    if (body.errors?.length) throw new LinearError(body.errors.map(e => e.message).join('; '))
    if (!body.data) throw new LinearError(`Linear returned HTTP ${res.status} with no data`)
    return body.data
  }
  return { query }
}

export type Client = ReturnType<typeof createClient>

export const SUMMARY_FIELDS = `id identifier title url priority priorityLabel createdAt branchName
state{name type} projectMilestone{name targetDate} labels{nodes{name}} cycle{id}
parent{identifier title cycle{id}} children{nodes{id}}
inverseRelations{nodes{type issue{identifier state{name type}}}}`

type RawSummary = {
  id: string
  identifier: string
  title: string
  url: string
  priority: number
  priorityLabel: string
  createdAt: string
  branchName: string
  state: { name: string; type: StateType }
  projectMilestone: { name: string; targetDate: string | null } | null
  labels: { nodes: { name: string }[] }
  cycle: { id: string } | null
  parent: { identifier: string; title: string; cycle: { id: string } | null } | null
  children: { nodes: { id: string }[] }
  inverseRelations: { nodes: { type: string; issue: { identifier: string; state: { name: string; type: StateType } } }[] }
}

export function isOpenType(type: StateType): boolean {
  return type !== 'completed' && type !== 'canceled'
}

export function toSummary(raw: RawSummary): IssueSummary {
  return {
    id: raw.id,
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url,
    priority: raw.priority,
    priorityLabel: raw.priorityLabel,
    state: raw.state,
    createdAt: raw.createdAt,
    branchName: raw.branchName,
    milestone: raw.projectMilestone,
    labels: raw.labels.nodes.map(l => l.name),
    parent: raw.parent ? { identifier: raw.parent.identifier, title: raw.parent.title, cycleId: raw.parent.cycle?.id ?? null } : null,
    cycleId: raw.cycle?.id ?? null,
    blockedBy: raw.inverseRelations.nodes
      .filter(r => r.type === 'blocks' && isOpenType(r.issue.state.type))
      .map(r => ({ identifier: r.issue.identifier, state: r.issue.state.name })),
    childCount: raw.children.nodes.length,
  }
}

export type { RawSummary }

export type IssueChild = { identifier: string; title: string; state: string; stateType: string }

export type IssueComment = { author: string; createdAt: string; body: string }

export type Issue = {
  identifier: string
  title: string
  url: string
  state: string
  stateType: string
  priority: string
  labels: string[]
  parent: { identifier: string; title: string; labels: string[] } | null
  assignee: string | null
  cycle: number | null
  milestone: string | null
  description: string
  children: IssueChild[]
  comments: IssueComment[]
  links: { title: string; url: string }[]
}

export type IssueSource = { id: string; from: 'root' | 'sites' | 'pinned'; detail: string }

export type SessionEntry = {
  sessionId: string
  checkout: string
  label: string
  issue: string | null
  title: string | null
  state: string | null
  stateType: string | null
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'linear-issue-mod': {
      issue: Issue | null
      source: IssueSource | null
      error: string | null
      isBandHidden: boolean
      pinned: string | null
      pinnedBy: 'command' | 'manual' | 'held' | null
      warned: string[]
      others: SessionEntry[]
      conflictsWarned: string[]
    }
  }
}

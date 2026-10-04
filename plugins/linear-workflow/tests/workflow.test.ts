import { describe, expect, test } from 'claude-code/testing'

import type { Fetcher, IssueSummary, StateType } from '../lib/linear.ts'
import { createClient, toSummary } from '../lib/linear.ts'
import type { PrInfo } from '../lib/pr.ts'
import { evaluatePr, summarizeChecks } from '../lib/pr.ts'
import type { TeamState } from '../lib/workflow.ts'
import { isActionable, normalizeId, parseProjectConfig, rank, resolveState, siblingsUnfinished, transition } from '../lib/workflow.ts'

const summary = (id: string, priority: number, targetDate: string | null, createdAt: string): IssueSummary => ({
  id, identifier: id, title: id, url: '', priority, priorityLabel: '', state: { name: 'Todo', type: 'unstarted' },
  createdAt, branchName: '', milestone: targetDate ? { name: 'm', targetDate } : null, labels: [], parent: null,
  cycleId: null, blockedBy: [], childCount: 0,
})

const STATES: TeamState[] = [
  { id: 's-backlog', name: 'Backlog', type: 'backlog', position: 0 },
  { id: 's-todo', name: 'Todo', type: 'unstarted', position: 1 },
  { id: 's-prog', name: 'In Progress', type: 'started', position: 2 },
  { id: 's-rev', name: 'In Review', type: 'started', position: 3 },
  { id: 's-done', name: 'Done', type: 'completed', position: 4 },
  { id: 's-cancel', name: 'Canceled', type: 'canceled', position: 5 },
]

describe('ids and config', () => {
  test('normalizeId', async () => {
    expect(normalizeId('eng-12')).toBe('ENG-12')
    expect(normalizeId('#12', 'eng')).toBe('ENG-12')
    expect(normalizeId('12')).toBe(undefined)
    expect(normalizeId('refresh', 'ENG')).toBe(undefined)
  })
  test('parseProjectConfig keeps known, well-typed fields only', async () => {
    const c = parseProjectConfig('{"teamKey":"ENG","checks":["npm test",3],"mergeMethod":"yolo","deleteBranch":true}')
    expect(c).toEqual({ teamKey: 'ENG', checks: ['npm test'], deleteBranch: true })
    expect(parseProjectConfig(undefined)).toEqual({})
  })
})

describe('ranking', () => {
  test('priority, then milestone date, then age; no priority last', async () => {
    const order = rank([
      summary('none', 0, null, '2026-01-01'),
      summary('low', 4, null, '2026-01-01'),
      summary('high-late', 2, '2026-12-01', '2026-01-01'),
      summary('high-soon', 2, '2026-10-10', '2026-03-01'),
      summary('high-nodate-old', 2, null, '2025-01-01'),
      summary('urgent', 1, null, '2026-05-01'),
    ]).map(i => i.identifier)
    expect(order).toEqual(['urgent', 'high-soon', 'high-late', 'high-nodate-old', 'low', 'none'])
  })
  test('In Review is not actionable even though Linear types it as started', async () => {
    const inReview = { ...summary('r', 2, null, ''), state: { name: 'In Review', type: 'started' as StateType } }
    const inProgress = { ...summary('p', 2, null, ''), state: { name: 'In Progress', type: 'started' as StateType } }
    expect(isActionable(inReview)).toBe(false)
    expect(isActionable(inProgress)).toBe(true)
  })
  test('only open blockers count', async () => {
    const raw = {
      id: 'x', identifier: 'ENG-1', title: '', url: '', priority: 3, priorityLabel: 'Medium', createdAt: '', branchName: '',
      state: { name: 'Todo', type: 'unstarted' as StateType }, projectMilestone: null, labels: { nodes: [] }, cycle: null,
      parent: null, children: { nodes: [] },
      inverseRelations: { nodes: [
        { type: 'blocks', issue: { identifier: 'ENG-2', state: { name: 'Done', type: 'completed' as StateType } } },
        { type: 'blocks', issue: { identifier: 'ENG-3', state: { name: 'In Progress', type: 'started' as StateType } } },
        { type: 'related', issue: { identifier: 'ENG-4', state: { name: 'Todo', type: 'unstarted' as StateType } } },
      ] },
    }
    expect(toSummary(raw).blockedBy.map(b => b.identifier)).toEqual(['ENG-3'])
  })
})

describe('states and roll-up', () => {
  test('resolveState by name, alias, then type', async () => {
    expect(resolveState(STATES, 'in review')?.id).toBe('s-rev')
    expect(resolveState(STATES, 'completed')?.id).toBe('s-done')
    const noReview = STATES.filter(s => s.id !== 's-rev')
    expect(resolveState(noReview, 'In Review')?.id).toBe('s-prog')
    expect(resolveState(STATES, 'Shipped to Mars')).toBe(undefined)
  })
  test('a sibling in review is unfinished for Done, finished for In Review', async () => {
    const sibs = [
      { identifier: 'A', state: { id: 's-done', type: 'completed' as StateType } },
      { identifier: 'B', state: { id: 's-rev', type: 'started' as StateType } },
      { identifier: 'C', state: { id: 's-cancel', type: 'canceled' as StateType } },
    ]
    expect(siblingsUnfinished(sibs, STATES[4]!)).toEqual(['B'])
    expect(siblingsUnfinished(sibs, STATES[3]!)).toEqual([])
  })
})

function fakeLinear(issue: { state: string; siblings: { identifier: string; state: string }[]; parentState: string }) {
  const calls: { query: string; variables: Record<string, unknown> }[] = []
  const byId = (id: string) => STATES.find(s => s.id === id)!
  const fetcher: Fetcher = async (_url, init) => {
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> }
    calls.push({ query, variables })
    let data: unknown
    if (query.includes('issueUpdate')) data = { issueUpdate: { success: true } }
    else if (query.includes('commentCreate')) data = { commentCreate: { success: true } }
    else {
      data = { issue: {
        id: 'id-1', identifier: 'ENG-1', state: { ...byId(issue.state) },
        team: { states: { nodes: STATES } },
        parent: { id: 'id-p', identifier: 'ENG-0', state: { id: issue.parentState, name: byId(issue.parentState).name },
          children: { nodes: [{ identifier: 'ENG-1', state: { id: issue.state, type: byId(issue.state).type } },
            ...issue.siblings.map(s => ({ identifier: s.identifier, state: { id: s.state, type: byId(s.state).type } }))] } },
      } }
    }
    return { status: 200, text: JSON.stringify({ data }) }
  }
  return { client: createClient(fetcher, 'k'), calls }
}

describe('transition', () => {
  test('already in target: no save, but the comment and the roll-up still happen', async () => {
    const { client, calls } = fakeLinear({ state: 's-done', siblings: [{ identifier: 'ENG-2', state: 's-done' }], parentState: 's-prog' })
    const r = await transition(client, 'ENG-1', 'Done', 'shipped')
    expect(r.changed).toBe(false)
    expect(r.commented).toBe(true)
    expect(r.parent?.rolledUp).toBe(true)
    const updates = calls.filter(c => c.query.includes('issueUpdate')).map(c => c.variables.id)
    expect(updates).toEqual(['id-p'])
  })
  test('a sibling still in review keeps the parent open on Done', async () => {
    const { client, calls } = fakeLinear({ state: 's-rev', siblings: [{ identifier: 'ENG-2', state: 's-rev' }], parentState: 's-prog' })
    const r = await transition(client, 'ENG-1', 'Done')
    expect(r.changed).toBe(true)
    expect(r.parent?.unfinished).toEqual(['ENG-2'])
    expect(calls.filter(c => c.query.includes('issueUpdate')).map(c => c.variables.id)).toEqual(['id-1'])
  })
  test('unknown state name is an error, nothing written', async () => {
    const { client, calls } = fakeLinear({ state: 's-prog', siblings: [], parentState: 's-prog' })
    let message = ''
    try {
      await transition(client, 'ENG-1', 'Shipped to Mars')
    } catch (err) {
      message = String(err)
    }
    expect(message.includes('No workflow state matches')).toBe(true)
    expect(calls.some(c => c.query.includes('mutation'))).toBe(false)
  })
})

const pr = (over: Partial<PrInfo> = {}): PrInfo => ({
  number: 7, url: 'u', title: 'Add x (ENG-1)', headRefName: 'eng-1-x', headRefOid: 'abc12345ff', baseRefName: 'main',
  isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: [{ name: 'ci', conclusion: 'SUCCESS', status: 'COMPLETED' }],
  ...over,
})

describe('pr-check', () => {
  test('ready', async () => {
    expect(evaluatePr('ENG-1', [pr()], { branch: 'main', dirty: [], localHeadOid: 'zzz' }).verdict).toBe('ready')
  })
  test('no PR, several PRs, draft, conflicts, changes requested, failed checks all stop', async () => {
    expect(evaluatePr('ENG-1', [], null).verdict).toBe('stop')
    expect(evaluatePr('ENG-1', [pr(), pr({ number: 8 })], null).verdict).toBe('stop')
    expect(evaluatePr('ENG-1', [pr({ isDraft: true })], null).verdict).toBe('stop')
    expect(evaluatePr('ENG-1', [pr({ mergeable: 'CONFLICTING' })], null).verdict).toBe('stop')
    expect(evaluatePr('ENG-1', [pr({ reviewDecision: 'CHANGES_REQUESTED' })], null).verdict).toBe('stop')
    expect(evaluatePr('ENG-1', [pr({ statusCheckRollup: [{ name: 'ci', conclusion: 'FAILURE', status: 'COMPLETED' }] })], null).reasons[0]).toBe('Failed checks: ci')
  })
  test('local work not in the PR stops; pending checks wait', async () => {
    expect(evaluatePr('ENG-1', [pr()], { branch: 'eng-1-x', dirty: ['a.ts'], localHeadOid: 'abc12345ff' }).verdict).toBe('stop')
    expect(evaluatePr('ENG-1', [pr()], { branch: 'eng-1-x', dirty: [], localHeadOid: 'other' }).verdict).toBe('stop')
    expect(evaluatePr('ENG-1', [pr({ statusCheckRollup: [{ name: 'ci', status: 'IN_PROGRESS', conclusion: null }] })], null).verdict).toBe('wait')
  })
  test('summarizeChecks', async () => {
    expect(summarizeChecks([{ context: 'lint', state: 'SUCCESS' }, { context: 'e2e', state: 'PENDING' }])).toEqual({ total: 2, failed: [], pending: ['e2e'] })
  })
})

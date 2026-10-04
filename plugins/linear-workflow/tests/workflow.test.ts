import { describe, expect, test } from 'claude-code/testing'

import type { Fetcher, IssueSummary, StateType } from '../lib/linear.ts'
import { createClient, toSummary } from '../lib/linear.ts'
import type { PrInfo } from '../lib/pr.ts'
import { belongsTo, evaluateMerged, evaluatePr, summarizeChecks } from '../lib/pr.ts'
import type { TeamState } from '../lib/workflow.ts'
import { daysUntil, isActionable, normalizeId, parseProjectConfig, rank, resolveState, resolveTeamKeys, siblingsUnfinished, transition } from '../lib/workflow.ts'

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
  test('team keys: option, then linear.json, then your teams', async () => {
    expect(await resolveTeamKeys({ option: ' eng, ops  web-1 ' })).toEqual(['ENG', 'OPS'])
    expect(await resolveTeamKeys({ configText: '{"teamKey":"web"}', fetchMine: async () => ['X'] })).toEqual(['WEB'])
    expect(await resolveTeamKeys({ configText: '{not json', fetchMine: async () => ['abc'] })).toEqual(['ABC'])
    expect(await resolveTeamKeys({ fetchMine: async () => { throw new Error('offline') } })).toEqual([])
  })
  test('daysUntil', async () => {
    expect(daysUntil('2026-10-11', '2026-10-04')).toBe(7)
    expect(daysUntil('2026-10-01T00:00:00Z', '2026-10-04')).toBe(-3)
    expect(daysUntil(null, '2026-10-04')).toBe(null)
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
      { identifier: 'A', state: { name: 'Done', type: 'completed' as StateType } },
      { identifier: 'B', state: { name: 'QA', type: 'started' as StateType } },
      { identifier: 'C', state: { name: 'Canceled', type: 'canceled' as StateType } },
      { identifier: 'D', state: { name: 'In Progress', type: 'started' as StateType } },
    ]
    expect(siblingsUnfinished(sibs, 'done')).toEqual(['B', 'D'])
    expect(siblingsUnfinished(sibs, 'review')).toEqual(['D'])
  })
})

function fakeLinear(issue: { state: string; siblings: { identifier: string; state: string }[]; parentState: string; parentStates?: TeamState[] }) {
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
        parent: { id: 'id-p', identifier: 'ENG-0', state: { id: issue.parentState, name: issue.parentState },
          team: { states: { nodes: issue.parentStates ?? STATES } },
          children: { nodes: [{ identifier: 'ENG-1', state: { name: byId(issue.state).name, type: byId(issue.state).type } },
            ...issue.siblings.map(s => ({ identifier: s.identifier, state: { name: byId(s.state).name, type: byId(s.state).type } }))] } },
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
  test('a parent in another team moves to that team\'s Done state', async () => {
    const opsStates: TeamState[] = [
      { id: 'o-prog', name: 'Doing', type: 'started', position: 0 },
      { id: 'o-done', name: 'Shipped', type: 'completed', position: 1 },
    ]
    const { client, calls } = fakeLinear({ state: 's-rev', siblings: [], parentState: 'o-prog', parentStates: opsStates })
    const r = await transition(client, 'ENG-1', 'Done')
    expect(r.parent?.changed).toBe(true)
    const parentUpdate = calls.find(c => c.query.includes('issueUpdate') && c.variables.id === 'id-p')
    expect(parentUpdate?.variables.state).toBe('o-done')
  })
  test('no review roll-up into a parent team that has no review state', async () => {
    const noReview: TeamState[] = STATES.filter(st => st.id !== 's-rev')
    const { client, calls } = fakeLinear({ state: 's-prog', siblings: [], parentState: 's-prog', parentStates: noReview })
    const r = await transition(client, 'ENG-1', 'In Review')
    expect(r.parent?.rolledUp).toBe(false)
    expect(r.parent?.note?.includes('review')).toBe(true)
    expect(calls.some(c => c.query.includes('issueUpdate') && c.variables.id === 'id-p')).toBe(false)
  })
  test('a review state named QA still rolls the parent up', async () => {
    const qaStates: TeamState[] = STATES.map(s => (s.id === 's-rev' ? { ...s, name: 'QA' } : s))
    const { client } = fakeLinear({ state: 's-prog', siblings: [], parentState: 's-prog', parentStates: qaStates })
    const r = await transition(client, 'ENG-1', 'QA')
    expect(r.parent?.rolledUp).toBe(true)
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

describe('pr ownership and landing', () => {
  test('a PR belongs to the issue by branch, title or a closing keyword, not a mere mention', async () => {
    expect(belongsTo('ENG-12', { title: 'x', headRefName: 'alex/eng-12-thing' })).toBe(true)
    expect(belongsTo('ENG-12', { title: 'Fix x (ENG-12)', headRefName: 'b' })).toBe(true)
    expect(belongsTo('ENG-12', { title: 'x', headRefName: 'b', body: 'Closes ENG-12.' })).toBe(true)
    expect(belongsTo('ENG-12', { title: 'x', headRefName: 'b', body: 'Follow-up to ENG-12' })).toBe(false)
    expect(belongsTo('ENG-12', { title: 'ENG-120 thing', headRefName: 'eng-120-x' })).toBe(false)
  })
  test('a PR that only mentions the issue is not merged', async () => {
    const other = pr({ title: 'Other (ENG-15)', headRefName: 'eng-15-x', body: 'follow-up to ENG-1' })
    expect(evaluatePr('ENG-1', [other], null).verdict).toBe('stop')
  })
  test('--pr picks one of several, and refuses a number not found', async () => {
    const two = [pr(), pr({ number: 8 })]
    expect(evaluatePr('ENG-1', two, null).verdict).toBe('stop')
    expect(evaluatePr('ENG-1', two, null, 8).pr?.number).toBe(8)
    expect(evaluatePr('ENG-1', two, null, 99).verdict).toBe('stop')
  })
  test('landed only when MERGED with a merge commit', async () => {
    expect(evaluateMerged({ state: 'MERGED', mergeCommit: { oid: 'abc' }, url: 'u', number: 1 }).landed).toBe(true)
    expect(evaluateMerged({ state: 'OPEN', mergeCommit: null, url: 'u', number: 1 }).landed).toBe(false)
    expect(evaluateMerged({ state: 'MERGED', mergeCommit: null, url: 'u', number: 1 }).landed).toBe(false)
  })
})

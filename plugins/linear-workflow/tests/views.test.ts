import { describe, expect, test } from 'claude-code/testing'

import type { IssueDetail } from '../lib/workflow.ts'
import { prView, queueView, reviewView, startView, urgency, withoutSection } from '../lib/views.ts'

const DETAIL: IssueDetail = {
  id: 'u', identifier: 'ENG-1', title: 'Add dark mode', url: 'u', priority: 2, priorityLabel: 'High',
  state: { name: 'Todo', type: 'unstarted' }, createdAt: '2026-09-01T10:00:00Z', branchName: 'eng-1-x',
  milestone: { name: 'Beta', targetDate: '2026-10-10' }, labels: ['Feature'], parent: null, cycleId: null,
  blockedBy: [], childCount: 0, cycle: 13, assignee: 'Alex', teamKey: 'ENG', children: [], links: [],
  description: '## Context\nWhy.\n\n## Acceptance Criteria\n- [ ] SECRET\n### Sub-heading inside AC\n- also secret\n\n## Scope\n- here',
  acceptanceCriteria: [{ text: 'SECRET', checked: false }],
  comments: [{ id: 'c', author: 'Sam', createdAt: '2026-09-03T09:00:00Z', body: 'Persist it.' }],
}

describe('views', () => {
  test('withoutSection drops the section and its sub-headings, keeps the rest', async () => {
    const out = withoutSection(DETAIL.description, /^acceptance criteria$/i)
    expect(out).toBe('## Context\nWhy.\n\n## Scope\n- here')
  })
  test('start view has no acceptance criteria anywhere', async () => {
    const v = startView(DETAIL)
    expect(JSON.stringify(v).includes('SECRET')).toBe(false)
    expect(v.comments).toEqual([{ author: 'Sam', date: '2026-09-03', body: 'Persist it.' }])
  })
  test('review view is the criteria only', async () => {
    expect(reviewView(DETAIL)).toEqual({ identifier: 'ENG-1', title: 'Add dark mode', labels: ['Feature'], acceptanceCriteria: [{ text: 'SECRET', checked: false }] })
  })
  test('queue view is one compact entry per candidate', async () => {
    const v = queueView({
      cycle: { id: 'c', number: 13, startsAt: '2026-09-28T00:00:00Z', endsAt: '2026-10-12T00:00:00Z', teamKey: 'ENG' },
      examined: 1, droppedBlocked: ['ENG-5'], droppedEpics: [],
      candidates: [{ ...DETAIL, epic: { identifier: 'ENG-0', title: 'E' }, dueInDays: 6 }],
    })
    expect(v.candidates).toEqual([{ rank: 1, id: 'ENG-1', title: 'Add dark mode', priority: 'High', urgency: 'ends in 6d', state: 'Todo', milestone: 'Beta', epic: 'ENG-0' }])
    expect([urgency(-3), urgency(0), urgency(null)]).toEqual(['overdue 3d', 'due today', 'no due'])
    expect(v.blocked).toBe(1)
    expect(JSON.stringify(v).includes('Why.')).toBe(false)
  })
  test('pr view keeps only what the merge needs', async () => {
    const v = prView({
      verdict: 'ready', reasons: [], checks: { total: 0, failed: [], pending: [] }, candidates: [],
      pr: { number: 7, url: 'u', title: 't', body: 'long body', headRefName: 'h', headRefOid: 'o', baseRefName: 'main', isDraft: false, mergeable: 'MERGEABLE', reviewDecision: 'APPROVED', statusCheckRollup: [] },
    })
    expect(v.pr).toEqual({ number: 7, url: 'u', title: 't', headRefName: 'h', headRefOid: 'o' })
  })
})

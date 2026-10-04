import { describe, expect, test } from 'claude-code/testing'

import type { Issue, SessionEntry } from '../types'
import {
  checkoutLabel,
  decideSource,
  conflicts,
  driftSite,
  idFromBranch,
  idFromText,
  isCheckout,
  liveOthers,
  pickSource,
  readEnvValue,
  scopeSites,
  touchesLinear,
  STALE_MS,
} from '../lib/logic.ts'

const KEYS = ['ENG']
const SITES = ['web', 'api', 'docs']

const issue = (labels: string[], parentLabels: string[] = []): Issue => ({
  identifier: 'ENG-1', title: 't', url: 'u', state: 'In Progress', stateType: 'started', priority: 'High',
  labels, parent: parentLabels.length ? { identifier: 'ENG-0', title: 'p', labels: parentLabels } : null,
  assignee: null, cycle: null, milestone: null, description: '', children: [], comments: [], links: [],
})

describe('issue id', () => {
  test('from branch', async () => {
    expect(idFromBranch('alex/eng-2919-link-builders-b6', KEYS)).toBe('ENG-2919')
    expect(idFromBranch('eng-12', KEYS)).toBe('ENG-12')
    expect(idFromBranch('main', KEYS)).toBe(undefined)
    expect(idFromBranch('feature/core-builders-b6', KEYS)).toBe(undefined)
    expect(idFromBranch('astro-7-upgrade', KEYS)).toBe(undefined)
    expect(idFromBranch('alex/phase-2-x', KEYS)).toBe(undefined)
    expect(idFromBranch('eng-12', [])).toBe(undefined)
  })
  test('from text', async () => {
    expect(idFromText(' eng-2912 ')).toBe('ENG-2912')
    expect(idFromText('refresh')).toBe(undefined)
  })
})

describe('source', () => {
  test('root branch wins over sites', async () => {
    expect(pickSource('alex/eng-5-x', { a: 'alex/eng-6-y' }, KEYS)?.id).toBe('ENG-5')
  })
  test('majority of site branches when root is main', async () => {
    const s = pickSource('main', { a: 'alex/eng-6-y', b: 'alex/eng-6-y', c: 'alex/eng-7-z' }, KEYS)
    expect(s?.id).toBe('ENG-6')
    expect(s?.detail).toBe('2 project(s) on it, mixed: ENG-7')
  })
  test('nothing', async () => {
    expect(pickSource('main', { a: 'main' }, KEYS)).toBe(null)
  })
})

describe('drift', () => {
  const PATHS = SITES.map(key => ({ key, path: `/f/apps/${key}` }))
  test('scope from own labels, ignoring category labels', async () => {
    expect(scopeSites(issue(['web', 'Bug']), SITES)).toEqual(['web'])
  })
  test('scope falls back to parent labels', async () => {
    expect(scopeSites(issue(['Feature'], ['api']), SITES)).toEqual(['api'])
  })
  test('edit outside scope is drift', async () => {
    expect(driftSite('/f/apps/api/src/a.astro', PATHS, ['web'])).toBe('api')
  })
  test('edit inside scope, at repo root, or unscoped is not', async () => {
    expect(driftSite('/f/apps/web/src/a.astro', PATHS, ['web'])).toBe(undefined)
    expect(driftSite('/f/scripts/x.mjs', PATHS, ['web'])).toBe(undefined)
    expect(driftSite('/f/apps/api/a', PATHS, [])).toBe(undefined)
  })
})

test('env parsing', async () => {
  expect(readEnvValue('A=1\nLINEAR_API_KEY="lin_api_x"\n', 'LINEAR_API_KEY')).toBe('lin_api_x')
  expect(readEnvValue('export LINEAR_API_KEY=abc', 'LINEAR_API_KEY')).toBe('abc')
  expect(readEnvValue('B=1', 'LINEAR_API_KEY')).toBe(undefined)
})

describe('sessions', () => {
  const MAIN = '/f'
  const WT = '/f/.claude/worktrees/eng-2748'
  const entry = (sessionId: string, checkout: string, issue: string | null, updatedAt = 1000): SessionEntry => ({
    sessionId, checkout, label: checkoutLabel(checkout), issue, title: null, state: null, stateType: null, claimed: true, updatedAt,
  })

  test('checkout commands', async () => {
    expect(isCheckout('git checkout alex/eng-1-x')).toBe(true)
    expect(isCheckout('git -C "$REPO/apps/a" switch -c alex/eng-1-x')).toBe(true)
    expect(isCheckout('cd x && git checkout -b eng-2')).toBe(true)
    expect(isCheckout('git checkout -- src/a.ts')).toBe(false)
    expect(isCheckout('git status && git log')).toBe(false)
    expect(isCheckout('echo checkout')).toBe(false)
  })
  test('labels', async () => {
    expect(checkoutLabel(MAIN)).toBe('main')
    expect(checkoutLabel(WT)).toBe('eng-2748')
  })
  test('live others drop self and stale', async () => {
    const now = 1000 + STALE_MS - 1
    const list = [entry('me', MAIN, 'ENG-1'), entry('a', MAIN, 'ENG-2'), entry('old', MAIN, 'ENG-3', 0)]
    expect(liveOthers(list, 'me', now).map(o => o.sessionId)).toEqual(['a'])
  })
  test('different issues in the same checkout clash', async () => {
    const c = conflicts({ checkout: MAIN, issue: 'ENG-1' }, [entry('a', MAIN, 'ENG-2')])
    expect(c.map(x => x.sessionId)).toEqual(['a'])
  })
  test('same issue anywhere clashes', async () => {
    expect(conflicts({ checkout: MAIN, issue: 'ENG-1' }, [entry('a', WT, 'ENG-1')]).length).toBe(1)
  })
  test('worktree on another issue, or a session with no issue, does not clash', async () => {
    expect(conflicts({ checkout: MAIN, issue: 'ENG-1' }, [entry('a', WT, 'ENG-2'), entry('b', MAIN, null)])).toEqual([])
    expect(conflicts({ checkout: MAIN, issue: null }, [entry('a', MAIN, 'ENG-2')])).toEqual([])
  })
})

describe('which issue a session shows', () => {
  const branch = (id: string) => ({ id, from: 'root' as const, detail: `x/${id.toLowerCase()}-y` })
  const base = {
    fromBranch: null, pinned: null, pinnedBy: null, previous: null,
    branchMoved: false, own: false, claimedBranch: null, claimedElsewhere: () => false,
  }
  test('an idle session does not adopt a branch another session claimed', async () => {
    const d = decideSource({ ...base, fromBranch: branch('ENG-1'), claimedElsewhere: id => id === 'ENG-1' })
    expect(d.use).toBe('none')
  })
  test('nobody claims it: a lone session on a feature branch shows it', async () => {
    expect(decideSource({ ...base, fromBranch: branch('ENG-1') }).use).toBe('branch')
  })
  test('switching to a branch yourself claims it, even if another session also lists it', async () => {
    const d = decideSource({ ...base, fromBranch: branch('ENG-1'), branchMoved: true, own: true, claimedElsewhere: () => true })
    expect(d.use).toBe('branch')
    expect(d.claimedBranch).toBe('ENG-1')
  })
  test('a foreign branch move holds a claimed issue, but not an adopted one', async () => {
    const claimed = decideSource({ ...base, fromBranch: branch('ENG-2'), previous: branch('ENG-1'), branchMoved: true, claimedBranch: 'ENG-1' })
    expect(claimed.use).toBe('pin')
    expect(claimed.pinnedBy).toBe('held')
    const adopted = decideSource({ ...base, fromBranch: branch('ENG-2'), previous: branch('ENG-1'), branchMoved: true, claimedElsewhere: () => true })
    expect(adopted.use).toBe('none')
    expect(adopted.pinned).toBe(null)
  })
  test('switching yourself to a branch without an issue releases the claim', async () => {
    const d = decideSource({ ...base, fromBranch: null, branchMoved: true, own: true, claimedBranch: 'ENG-1' })
    expect(d.claimedBranch).toBe(null)
  })
  test('a checkout that does not move the branch (e.g. restoring a file) claims nothing', async () => {
    const d = decideSource({ ...base, fromBranch: branch('ENG-2'), own: true, claimedElsewhere: () => true })
    expect(d.claimedBranch).toBe(null)
    expect(d.use).toBe('none')
  })
  test('a pin wins; held clears when you switch back to its branch', async () => {
    expect(decideSource({ ...base, fromBranch: branch('ENG-2'), pinned: 'ENG-9', pinnedBy: 'manual' }).use).toBe('pin')
    const back = decideSource({ ...base, fromBranch: branch('ENG-1'), pinned: 'ENG-1', pinnedBy: 'held', branchMoved: true, own: true })
    expect(back.pinned).toBe(null)
    expect(back.use).toBe('branch')
  })
})

test('which tool calls may have changed Linear', async () => {
  expect(touchesLinear('Bash', { command: 'node "/p/bin/linear-workflow.ts" transition ENG-1 Done' })).toBe(true)
  expect(touchesLinear('Bash', { command: 'node "/p/bin/linear-workflow.ts" queue' })).toBe(false)
  expect(touchesLinear('Agent', { subagent_type: 'linear-workflow:linear-manager' })).toBe(true)
  expect(touchesLinear('mcp__claude_ai_Linear__save_issue', {})).toBe(true)
  expect(touchesLinear('mcp__claude_ai_Linear__get_issue', {})).toBe(false)
})

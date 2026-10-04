#!/usr/bin/env node
// Deterministic Linear/GitHub steps for the linear-workflow skills. JSON on stdout, one summary
// line on stderr, exit 0 = ok, 1 = error or bad input, 2 = refused (needs a human).

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

import { createClient, LinearError } from '../lib/linear.ts'
import { findRoot, idFromBranch, resolveApiKey } from '../lib/logic.ts'
import type { LocalState, MergeView, PrInfo } from '../lib/pr.ts'
import { evaluateMerged, evaluatePr } from '../lib/pr.ts'
import { planView, prView, queueView, reviewView, startView } from '../lib/views.ts'
import {
  issueDetail,
  myOpenIssues,
  myTeamKeys,
  normalizeId,
  parseProjectConfig,
  planCycle,
  queue,
  resolveTeamKeys,
  setCycle,
  transition,
  useStateNames,
} from '../lib/workflow.ts'

const USAGE = `Usage: linear-workflow <command> [args]

One call per skill step:
  start <ABC-123>                          issue to work from (no acceptance criteria) + repo state
  review [ABC-123]                         which issue, repo state, branch check, acceptance criteria
  ship [ABC-123] [--pr N]                  which issue, merge settings, PR verdict (uses gh)

Single steps:
  config                                   resolved settings, base branch, current branch's PR
  resolve [ABC-123|123]                    which issue: argument, then branch, then your started issues
  issue <ABC-123> [--view start|review]    the issue; a view keeps only what that step reads
  queue [--limit N]                        active cycle's Todo/In Progress issues, ranked
  plan-cycle [--limit N]                   unscheduled backlog candidates for the active cycle
  transition <ABC-123> <state> [--comment TEXT | --comment-file F]
  set-cycle <number> <ABC-123>...          put issues in a cycle, nothing else
  pr-check <ABC-123> [--pr N]              can the issue's PR be merged? (uses gh)
  pr-merged <ABC-123> --pr N               did that PR land? exit 0 only when merged (uses gh)

Global: --team KEY  overrides the team key · --pretty  indented JSON · --out FILE  full JSON to a file`

const VALUE_FLAGS = ['team', 'limit', 'comment', 'comment-file', 'pr', 'view', 'out']

function run(cmd: string, args: string[], opts: { trim?: boolean } = {}): string {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return opts.trim === false ? out : out.trim()
  } catch {
    return ''
  }
}

function gh(args: string[]): string {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr?.trim()
    throw new Error(`gh ${args[0]} ${args[1] ?? ''} failed: ${stderr || (err instanceof Error ? err.message.split('\n')[0] : String(err))}`)
  }
}

function parseArgs(argv: string[]) {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2) as [string, string | undefined]
      if (v !== undefined) flags[k] = v
      else if (VALUE_FLAGS.includes(k)) flags[k] = argv[++i] ?? ''
      else flags[k] = true
    } else positional.push(a)
  }
  return { positional, flags }
}

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

async function context(flags: Record<string, string | true>) {
  const root = (await findRoot(async args => run('git', args))) || process.cwd()
  const configText = readIfExists(`${root}/.claude/linear.json`)
  const config = parseProjectConfig(configText)
  useStateNames(config.states)
  const apiKey = resolveApiKey({ env: process.env.LINEAR_API_KEY, envFileText: readIfExists(`${root}/.env`) })
  const teamKey = typeof flags.team === 'string' ? flags.team.toUpperCase() : undefined
  return { root, config, configText, apiKey, teamKey }
}

type Ctx = Awaited<ReturnType<typeof context>>

function client(apiKey: string | undefined) {
  if (!apiKey) throw new LinearError('LINEAR_API_KEY not set (environment, or <repo>/.env)')
  return createClient(async (url, init) => {
    const res = await fetch(url, init)
    return { status: res.status, text: await res.text() }
  }, apiKey)
}

/** `--team`, else the mod's order: plugin option (exported by the mod), linear.json, your teams. */
async function teamKeys(ctx: Ctx): Promise<string[]> {
  if (ctx.teamKey) return [ctx.teamKey]
  return resolveTeamKeys({
    option: process.env.LINEAR_WORKFLOW_TEAM_KEYS,
    configText: ctx.configText,
    fetchMine: ctx.apiKey ? () => myTeamKeys(client(ctx.apiKey)) : undefined,
  })
}

/** The one team whose cycle queue/plan-cycle/set-cycle use: `--team`, else a single configured key. */
async function cycleTeam(ctx: Ctx): Promise<string | undefined> {
  if (ctx.teamKey) return ctx.teamKey
  const configured = await resolveTeamKeys({ option: process.env.LINEAR_WORKFLOW_TEAM_KEYS, configText: ctx.configText })
  return configured.length === 1 ? configured[0] : undefined
}

function requireId(raw: string | undefined, singleKey: string | undefined): string {
  const id = raw ? normalizeId(raw, singleKey) : undefined
  if (!id) throw new Error(raw ? `Not an issue id: ${raw}${/^#?\d+$/.test(raw) ? ' (set teamKey to use bare numbers)' : ''}` : 'Missing issue id')
  return id
}

function baseBranch(ctx: Ctx): string {
  if (ctx.config.baseBranch) return ctx.config.baseBranch
  const head = run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])
  return head.replace(/^origin\//, '') || 'main'
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function prNumber(flags: Record<string, string | true>): number | undefined {
  if (flags.pr === undefined) return undefined
  const n = Number(String(flags.pr).replace(/^#/, ''))
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Not a PR number: ${String(flags.pr)}`)
  return n
}

type Outcome = { out: unknown; summary: string; code?: number }

/**
 * Eval fixture mode: answer each command from `<dir>/<command>.json` ({ out, summary, code }) and
 * log the call to `<dir>/calls.log`, so evals exercise the skills without Linear or GitHub.
 */
function fromFixture(dir: string, argv: string[]): Outcome {
  appendFileSync(`${dir}/calls.log`, `${argv.join(' ')}\n`)
  const file = `${dir}/${argv[0] ?? 'none'}.json`
  if (!existsSync(file)) throw new Error(`No fixture for "${argv[0] ?? ''}" in ${dir}`)
  return JSON.parse(readFileSync(file, 'utf8')) as Outcome
}

async function singleKey(ctx: Ctx): Promise<string | undefined> {
  const keys = await teamKeys(ctx)
  return keys.length === 1 ? keys[0] : undefined
}

function currentBranch(): string {
  return run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
}

function dirtyFiles(): string[] {
  // Untrimmed: porcelain lines start with a status column that may be a space.
  return run('git', ['status', '--porcelain'], { trim: false }).split('\n').filter(Boolean).map(l => l.slice(3))
}

/** Uncommitted files for a skill's eyes: the count, and the first 20 names. */
function dirtySummary() {
  const files = dirtyFiles()
  return { count: files.length, files: files.slice(0, 20) }
}

async function repoState(ctx: Ctx) {
  const branch = currentBranch()
  const base = baseBranch(ctx)
  type Pr = { number: number; url: string; state: string }
  let existingPr: Pr | null
  try {
    const pr = JSON.parse(gh(['pr', 'view', '--json', 'number,url,state'])) as Pr
    existingPr = pr.state === 'OPEN' ? pr : null
  } catch {
    existingPr = null
  }
  const keys = await teamKeys(ctx)
  return {
    root: ctx.root,
    branch,
    baseBranch: base,
    onBaseBranch: branch === base || branch === 'main' || branch === 'master',
    branchIssue: idFromBranch(branch, keys) ?? null,
    existingPr,
    teamKeys: keys,
    hasApiKey: Boolean(ctx.apiKey),
    config: ctx.config,
  }
}

type Resolved = { id: string; from: 'argument' | 'branch' | 'linear'; title?: string } | { id: null; candidates: { id: string; title: string; state: string }[] }

async function resolveIssue(ctx: Ctx, arg: string | undefined): Promise<Resolved> {
  if (arg) return { id: requireId(arg, await singleKey(ctx)), from: 'argument' }
  const fromBranch = idFromBranch(currentBranch(), await teamKeys(ctx))
  if (fromBranch) return { id: fromBranch, from: 'branch' }
  const mine = await myOpenIssues(client(ctx.apiKey))
  const only = mine.length === 1 ? mine[0] : undefined
  if (only) return { id: only.identifier, from: 'linear', title: only.title }
  return { id: null, candidates: mine.map(i => ({ id: i.identifier, title: i.title, state: i.state.name })) }
}

async function checkPr(ctx: Ctx, id: string, pr: number | undefined) {
  const fields = 'number,url,title,body,headRefName,headRefOid,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup'
  const found = JSON.parse(gh(['pr', 'list', '--state', 'open', '--search', `"${id}" in:title,body`, '--json', fields])) as PrInfo[]
  const local: LocalState = { branch: currentBranch(), dirty: dirtyFiles(), localHeadOid: run('git', ['rev-parse', 'HEAD']) || null }
  return { found: found.length, verdict: evaluatePr(id, found, local, pr) }
}

const unresolved = (r: Extract<Resolved, { id: null }>): Outcome => ({
  out: { id: null, candidates: r.candidates },
  summary: `no issue id given or on the branch; ${r.candidates.length} started issue(s) assigned to you`,
  code: 2,
})

async function main(argv: string[]): Promise<Outcome> {
  const fixtures = process.env.EVAL_LINEAR_WORKFLOW_FIXTURES
  if (fixtures) return fromFixture(fixtures, argv)
  const [command, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  const ctx = await context(flags)
  const limit = typeof flags.limit === 'string' ? Number(flags.limit) : undefined

  switch (command) {
    case 'start': {
      const id = requireId(positional[0], await singleKey(ctx))
      const [issue, repo] = await Promise.all([issueDetail(client(ctx.apiKey), id), repoState(ctx)])
      return {
        out: {
          issue: startView(issue),
          repo: { branch: repo.branch, baseBranch: repo.baseBranch, branching: ctx.config.branching ?? 'create', dirty: dirtySummary() },
        },
        summary: `start: ${issue.identifier} ${issue.state.name}, ${issue.comments.length} comment(s), ${issue.blockedBy.length} open blocker(s); on ${repo.branch}`,
      }
    }

    case 'review': {
      const r = await resolveIssue(ctx, positional[0])
      if (r.id === null) return unresolved(r)
      const [issue, repo] = await Promise.all([issueDetail(client(ctx.apiKey), r.id), repoState(ctx)])
      return {
        out: {
          issue: { from: r.from, ...reviewView(issue) },
          repo: {
            branch: repo.branch,
            baseBranch: repo.baseBranch,
            onBaseBranch: repo.onBaseBranch,
            branchIssue: repo.branchIssue,
            existingPr: repo.existingPr,
            checks: ctx.config.checks ?? null,
            dirty: dirtySummary(),
          },
        },
        summary: `review: ${issue.identifier} (from ${r.from}), ${issue.acceptanceCriteria.length} acceptance criteria; branch ${repo.branch}${repo.branchIssue && repo.branchIssue !== issue.identifier ? ` names ${repo.branchIssue}` : ''}`,
      }
    }

    case 'ship': {
      const r = await resolveIssue(ctx, positional[0])
      if (r.id === null) return unresolved(r)
      const { found, verdict } = await checkPr(ctx, r.id, prNumber(flags))
      return {
        out: {
          issue: { id: r.id, from: r.from },
          merge: { baseBranch: baseBranch(ctx), mergeMethod: ctx.config.mergeMethod ?? 'merge', deleteBranch: ctx.config.deleteBranch ?? false },
          check: prView(verdict),
        },
        summary: `ship: ${r.id} (from ${r.from}), ${found} open PR(s) mention it; verdict ${verdict.verdict}${verdict.reasons.length ? ` (${verdict.reasons.length} reason(s))` : ''}`,
        code: verdict.verdict === 'ready' ? 0 : 2,
      }
    }

    case 'config': {
      const repo = await repoState(ctx)
      return {
        out: repo,
        summary: `config: root ${ctx.root}, branch ${repo.branch} (base ${repo.baseBranch}), PR ${repo.existingPr ? `#${repo.existingPr.number}` : 'none'}, API key ${ctx.apiKey ? 'found' : 'missing'}`,
      }
    }

    case 'resolve': {
      const r = await resolveIssue(ctx, positional[0])
      if (r.id === null) return unresolved(r)
      return { out: r, summary: `resolve: ${r.id} from ${r.from}` }
    }

    case 'issue': {
      const id = requireId(positional[0], await singleKey(ctx))
      const issue = await issueDetail(client(ctx.apiKey), id)
      const view = flags.view
      if (view !== undefined && view !== 'start' && view !== 'review') throw new Error(`Unknown view: ${String(view)} (start or review)`)
      return {
        out: view === 'start' ? startView(issue) : view === 'review' ? reviewView(issue) : issue,
        summary: `issue: ${issue.identifier} ${issue.state.name}, ${issue.acceptanceCriteria.length} acceptance criteria, ${issue.comments.length} comment(s), ${issue.children.length} sub-issue(s), ${issue.blockedBy.length} open blocker(s)`,
      }
    }

    case 'queue': {
      const r = await queue(client(ctx.apiKey), { teamKey: await cycleTeam(ctx), limit, today: today() })
      return {
        out: queueView(r),
        summary: r.cycle
          ? `queue: cycle #${r.cycle.number} (${r.cycle.teamKey}), ${r.examined} issue(s) examined, ${r.candidates.length} candidate(s), ${r.droppedBlocked.length} blocked`
          : 'queue: no active cycle',
      }
    }

    case 'plan-cycle': {
      const r = await planCycle(client(ctx.apiKey), { teamKey: await cycleTeam(ctx), project: ctx.config.project, limit })
      return {
        out: planView(r),
        summary: r.cycle
          ? `plan-cycle: cycle #${r.cycle.number}, ${r.examined} backlog issue(s) examined, ${r.candidates.length} candidate(s), ${r.droppedBlocked} blocked, ${r.droppedChildren} children held back`
          : 'plan-cycle: no active cycle',
      }
    }

    case 'transition': {
      const id = requireId(positional[0], await singleKey(ctx))
      const target = positional.slice(1).join(' ')
      if (!target) throw new Error('Missing target state, e.g. "In Review"')
      const comment =
        typeof flags['comment-file'] === 'string' ? readFileSync(flags['comment-file'], 'utf8').trim()
        : typeof flags.comment === 'string' ? flags.comment
        : undefined
      const r = await transition(client(ctx.apiKey), id, target, comment)
      const parent = r.parent
        ? r.parent.rolledUp ? `; parent ${r.parent.issue} ${r.parent.changed ? 'rolled up' : 'already there'}`
          : r.parent.note ? `; parent ${r.parent.issue} not rolled up (${r.parent.note})`
          : `; parent ${r.parent.issue} stays (${r.parent.unfinished.length} unfinished)`
        : ''
      return { out: r, summary: `transition: ${r.issue} ${r.changed ? `${r.from} → ${r.to}` : `already ${r.to}`}${r.commented ? ', comment posted' : ''}${parent}` }
    }

    case 'set-cycle': {
      const n = Number(positional[0])
      if (!Number.isInteger(n) || n <= 0) throw new Error('Usage: set-cycle <number> <ABC-123>...')
      const key = await singleKey(ctx)
      const ids = positional.slice(1).map(p => requireId(p, key))
      if (ids.length === 0) throw new Error('No issue ids given')
      const r = await setCycle(client(ctx.apiKey), await cycleTeam(ctx), n, ids)
      return {
        out: r,
        summary: `set-cycle: #${n}, ${ids.length} issue(s): ${r.set.length} set, ${r.already.length} already there, ${r.failed.length} failed`,
        code: r.failed.length ? 1 : 0,
      }
    }

    case 'pr-check': {
      const id = requireId(positional[0], await singleKey(ctx))
      const { found, verdict } = await checkPr(ctx, id, prNumber(flags))
      return {
        out: prView(verdict),
        summary: `pr-check: ${found} open PR(s) mention ${id}; verdict ${verdict.verdict}${verdict.reasons.length ? ` (${verdict.reasons.length} reason(s))` : ''}`,
        code: verdict.verdict === 'ready' ? 0 : 2,
      }
    }

    case 'pr-merged': {
      const id = requireId(positional[0], await singleKey(ctx))
      const n = prNumber(flags)
      if (n === undefined) throw new Error('pr-merged needs --pr N (the number ship or pr-check returned)')
      const view = JSON.parse(gh(['pr', 'view', String(n), '--json', 'number,url,state,mergeCommit'])) as MergeView
      const r = evaluateMerged(view)
      return {
        out: { issue: id, pr: n, ...r },
        summary: `pr-merged: #${n} ${r.landed ? `merged as ${r.mergeCommit?.slice(0, 8)}` : `not merged (state ${r.state})`}`,
        code: r.landed ? 0 : 2,
      }
    }

    default:
      throw new Error(command ? `Unknown command: ${command}\n\n${USAGE}` : USAGE)
  }
}

const argv = process.argv.slice(2)
const { flags: globalFlags } = parseArgs(argv.slice(1))

// exitCode, not exit(): a large JSON payload on a pipe must drain before the process ends.
main(argv)
  .then(({ out, summary, code }) => {
    if (typeof globalFlags.out === 'string') {
      writeFileSync(globalFlags.out, `${JSON.stringify(out, null, 2)}\n`)
      process.stdout.write(`${JSON.stringify({ written: globalFlags.out })}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(out, null, globalFlags.pretty ? 2 : undefined)}\n`)
    }
    process.stderr.write(`${code === 2 ? '⚠' : code ? '✗' : '✓'} ${summary}\n`)
    process.exitCode = code ?? 0
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    process.stdout.write(`${JSON.stringify({ error: message })}\n`)
    process.stderr.write(`✗ ${message}\n`)
    process.exitCode = 1
  })

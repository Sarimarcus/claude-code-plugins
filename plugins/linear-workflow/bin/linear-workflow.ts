#!/usr/bin/env node
// Deterministic Linear/GitHub steps for the linear-workflow skills. JSON on stdout, one summary
// line on stderr, exit 0 = ok, 1 = error or bad input, 2 = refused (needs a human).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { createClient, LinearError } from '../lib/linear.ts'
import { idFromBranch, readEnvValue } from '../lib/logic.ts'
import type { LocalState, PrInfo } from '../lib/pr.ts'
import { evaluatePr } from '../lib/pr.ts'
import {
  issueDetail,
  myOpenIssues,
  myTeamKeys,
  normalizeId,
  parseProjectConfig,
  planCycle,
  queue,
  setCycle,
  transition,
} from '../lib/workflow.ts'

const USAGE = `Usage: linear-workflow <command> [args]

  config                                   resolved project settings
  resolve [ABC-123|123]                    which issue: argument, then branch, then your started issues
  issue <ABC-123>                          issue with description, blockers and every comment
  queue [--limit N]                        active cycle's actionable issues, ranked
  plan-cycle [--limit N]                   unscheduled backlog candidates for the active cycle
  transition <ABC-123> <state> [--comment TEXT | --comment-file F] [--no-rollup]
  set-cycle <number> <ABC-123>...          put issues in a cycle, nothing else
  pr-check <ABC-123>                       can the issue's PR be merged? (uses gh)

Global: --team KEY  overrides teamKey from .claude/linear.json`

function sh(cmd: string, args: string[], cwd?: string): string {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return ''
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
      else if (['team', 'limit', 'comment', 'comment-file'].includes(k)) flags[k] = argv[++i] ?? ''
      else flags[k] = true
    } else positional.push(a)
  }
  return { positional, flags }
}

function context(flags: Record<string, string | true>) {
  const root =
    sh('git', ['rev-parse', '--show-superproject-working-tree']) || sh('git', ['rev-parse', '--show-toplevel']) || process.cwd()
  const configPath = `${root}/.claude/linear.json`
  const config = parseProjectConfig(existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined)
  const teamKey = (typeof flags.team === 'string' ? flags.team : config.teamKey)?.toUpperCase()
  const envFile = `${root}/.env`
  const apiKey = process.env.LINEAR_API_KEY || (existsSync(envFile) ? readEnvValue(readFileSync(envFile, 'utf8'), 'LINEAR_API_KEY') : undefined)
  return { root, config, teamKey, apiKey }
}

function client(apiKey: string | undefined) {
  if (!apiKey) throw new LinearError('LINEAR_API_KEY not set (environment, or <repo>/.env)')
  return createClient(async (url, init) => {
    const res = await fetch(url, init)
    return { status: res.status, text: await res.text() }
  }, apiKey)
}

function requireId(raw: string | undefined, teamKey: string | undefined): string {
  const id = raw ? normalizeId(raw, teamKey) : undefined
  if (!id) throw new Error(raw ? `Not an issue id: ${raw}${/^#?\d+$/.test(raw) ? ' (set teamKey to use bare numbers)' : ''}` : 'Missing issue id')
  return id
}

async function run(argv: string[]): Promise<{ out: unknown; summary: string; code?: number }> {
  const [command, ...rest] = argv
  const { positional, flags } = parseArgs(rest)
  const ctx = context(flags)
  const limit = typeof flags.limit === 'string' ? Number(flags.limit) : undefined

  switch (command) {
    case 'config': {
      const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
      return {
        out: { root: ctx.root, branch, teamKey: ctx.teamKey ?? null, hasApiKey: Boolean(ctx.apiKey), config: ctx.config },
        summary: `config: root ${ctx.root}, team ${ctx.teamKey ?? 'unset'}, API key ${ctx.apiKey ? 'found' : 'missing'}`,
      }
    }

    case 'resolve': {
      if (positional[0]) {
        const id = requireId(positional[0], ctx.teamKey)
        return { out: { id, from: 'argument' }, summary: `resolve: ${id} from the argument` }
      }
      const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
      const keys = ctx.teamKey ? [ctx.teamKey] : ctx.apiKey ? await myTeamKeys(client(ctx.apiKey)) : []
      const fromBranch = idFromBranch(branch, keys)
      if (fromBranch) return { out: { id: fromBranch, from: 'branch', branch }, summary: `resolve: ${fromBranch} from branch ${branch}` }
      const mine = await myOpenIssues(client(ctx.apiKey))
      if (mine.length === 1) {
        const only = mine[0]!
        return { out: { id: only.identifier, from: 'linear', title: only.title }, summary: `resolve: ${only.identifier} (your only started issue)` }
      }
      const candidates = mine.map(i => ({ id: i.identifier, title: i.title, state: i.state.name }))
      return {
        out: { id: null, from: null, branch, candidates },
        summary: `resolve: no id on branch ${branch}; ${mine.length} started issue(s) assigned to you`,
        code: 2,
      }
    }

    case 'issue': {
      const id = requireId(positional[0], ctx.teamKey)
      const issue = await issueDetail(client(ctx.apiKey), id)
      return { out: issue, summary: `issue: ${issue.identifier} ${issue.state.name}, ${issue.comments.length} comment(s), ${issue.blockedBy.length} open blocker(s)` }
    }

    case 'queue': {
      const r = await queue(client(ctx.apiKey), { teamKey: ctx.teamKey, limit })
      return {
        out: r,
        summary: r.cycle
          ? `queue: cycle #${r.cycle.number} (${r.cycle.teamKey}), ${r.examined} issue(s) examined, ${r.candidates.length} candidate(s), ${r.droppedBlocked.length} blocked`
          : 'queue: no active cycle',
      }
    }

    case 'plan-cycle': {
      const r = await planCycle(client(ctx.apiKey), { teamKey: ctx.teamKey, project: ctx.config.project, limit })
      return {
        out: r,
        summary: r.cycle
          ? `plan-cycle: cycle #${r.cycle.number}, ${r.examined} backlog issue(s) examined, ${r.candidates.length} candidate(s), ${r.droppedBlocked} blocked, ${r.droppedChildren} children held back`
          : 'plan-cycle: no active cycle',
      }
    }

    case 'transition': {
      const id = requireId(positional[0], ctx.teamKey)
      const target = positional.slice(1).join(' ')
      if (!target) throw new Error('Missing target state, e.g. "In Review"')
      const comment =
        typeof flags['comment-file'] === 'string' ? readFileSync(flags['comment-file'], 'utf8').trim()
        : typeof flags.comment === 'string' ? flags.comment
        : undefined
      const r = await transition(client(ctx.apiKey), id, target, comment, flags['no-rollup'] !== true)
      const parent = r.parent
        ? r.parent.rolledUp ? `; parent ${r.parent.issue} ${r.parent.changed ? 'rolled up' : 'already there'}` : `; parent ${r.parent.issue} stays (${r.parent.unfinished.length} unfinished)`
        : ''
      return { out: r, summary: `transition: ${r.issue} ${r.changed ? `${r.from} → ${r.to}` : `already ${r.to}`}${r.commented ? ', comment posted' : ''}${parent}` }
    }

    case 'set-cycle': {
      const n = Number(positional[0])
      if (!Number.isInteger(n) || n <= 0) throw new Error('Usage: set-cycle <number> <ABC-123>...')
      const ids = positional.slice(1).map(p => requireId(p, ctx.teamKey))
      if (ids.length === 0) throw new Error('No issue ids given')
      const r = await setCycle(client(ctx.apiKey), ctx.teamKey, n, ids)
      return {
        out: r,
        summary: `set-cycle: #${n}, ${ids.length} issue(s): ${r.set.length} set, ${r.already.length} already there, ${r.failed.length} failed`,
        code: r.failed.length ? 1 : 0,
      }
    }

    case 'pr-check': {
      const id = requireId(positional[0], ctx.teamKey)
      const fields = 'number,url,title,headRefName,headRefOid,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup'
      let prs: PrInfo[]
      try {
        prs = JSON.parse(
          execFileSync('gh', ['pr', 'list', '--state', 'open', '--search', `${id} in:title,body`, '--json', fields], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }),
        ) as PrInfo[]
      } catch (err) {
        throw new Error(`gh pr list failed: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`)
      }
      const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
      const local: LocalState = {
        branch,
        dirty: sh('git', ['status', '--porcelain']).split('\n').filter(Boolean).map(l => l.slice(3)),
        localHeadOid: sh('git', ['rev-parse', 'HEAD']) || null,
      }
      const v = evaluatePr(id, prs, local)
      return {
        out: v,
        summary: `pr-check: ${prs.length} open PR(s) for ${id}; verdict ${v.verdict}${v.reasons.length ? ` (${v.reasons.length} reason(s))` : ''}`,
        code: v.verdict === 'ready' ? 0 : 2,
      }
    }

    default:
      throw new Error(command ? `Unknown command: ${command}\n\n${USAGE}` : USAGE)
  }
}

run(process.argv.slice(2))
  .then(({ out, summary, code }) => {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
    process.stderr.write(`${code === 2 ? '⚠' : code ? '✗' : '✓'} ${summary}\n`)
    process.exit(code ?? 0)
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    process.stdout.write(`${JSON.stringify({ error: message })}\n`)
    process.stderr.write(`✗ ${message}\n`)
    process.exit(1)
  })

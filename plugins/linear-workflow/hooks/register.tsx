import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register } from 'claude-code'

import { createClient } from '../lib/linear.ts'
import {
  checkoutLabel,
  conflicts,
  decideSource,
  driftSite,
  findRoot,
  idFromText,
  isCheckout,
  liveOthers,
  pickSource,
  resolveApiKey,
  scopeSites,
  stateColor,
  toPaneIssue,
} from '../lib/logic.ts'
import { issueDetail, myTeamKeys, normalizeId, resolveTeamKeys } from '../lib/workflow.ts'
import type { Issue, IssueSource, SessionEntry } from '../types'

const PANE = 'linear-workflow'
const HEARTBEAT_MS = 60 * 1000
const GC_MS = 24 * 60 * 60 * 1000

const issueAtom = atom({ plugin: 'linear-workflow', key: 'issue' } as const, null)
const sourceAtom = atom({ plugin: 'linear-workflow', key: 'source' } as const, null)
const errorAtom = atom({ plugin: 'linear-workflow', key: 'error' } as const, null)
const hiddenAtom = atom({ plugin: 'linear-workflow', key: 'isBandHidden' } as const, false)
const pinnedAtom = atom({ plugin: 'linear-workflow', key: 'pinned' } as const, null)
const pinnedByAtom = atom({ plugin: 'linear-workflow', key: 'pinnedBy' } as const, null)
const warnedAtom = atom({ plugin: 'linear-workflow', key: 'warned' } as const, [])
const othersAtom = atom({ plugin: 'linear-workflow', key: 'others' } as const, [])
const conflictsWarnedAtom = atom({ plugin: 'linear-workflow', key: 'conflictsWarned' } as const, [])
const claimedBranchAtom = atom({ plugin: 'linear-workflow', key: 'claimedBranch' } as const, null)

type Repo = { root: string; sites: { key: string; path: string }[] }

let repo: Repo | null = null
let apiKey: string | undefined
let teamKeys: string[] = []
let config = {
  linearApiKey: '',
  teamKeys: '',
  registryFile: 'sites.json',
  pinCommand: 'issue-start',
  pollMinutes: 5,
  showOtherSessions: true,
}
let lastBranchId: string | undefined
let ownCheckout = false
let registryDir: string | null = null
let inflight: Promise<void> = Promise.resolve()

async function git($: EngineInterface, cwd: string, args: string[]): Promise<string> {
  try {
    const ran = await $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 5000 })
    return ran.exitCode === 0 ? ran.stdout.trim() : ''
  } catch {
    return ''
  }
}

async function loadRepo($: EngineInterface): Promise<Repo | null> {
  const top = await findRoot(args => git($, '.', args))
  if (!top) return null

  let sites: Repo['sites'] = []
  try {
    if (!config.registryFile) throw new Error('no registry')
    const registry = JSON.parse(await $.fs.read(`${top}/${config.registryFile}`)) as {
      sites?: { key: string; path: string; active?: boolean }[]
    }
    sites = (registry.sites ?? [])
      .filter(s => s.active !== false)
      .map(s => ({ key: s.key, path: `${top}/${s.path}` }))
  } catch {
    sites = []
  }
  return { root: top, sites }
}

async function loadKey($: EngineInterface): Promise<string | undefined> {
  if (config.linearApiKey) {
    // Hand the secret option to the workflow CLI, which runs in Bash.
    await $.env.set('LINEAR_API_KEY', config.linearApiKey)
  }
  const envFileText = repo ? await $.fs.read(`${repo.root}/.env`).catch(() => undefined) : undefined
  return resolveApiKey({ option: config.linearApiKey, env: await $.env.get('LINEAR_API_KEY'), envFileText })
}

async function resolveSource($: EngineInterface): Promise<IssueSource | null> {
  if (!repo) return null
  const rootBranch = await git($, repo.root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const branches = await Promise.all(repo.sites.map(site => git($, site.path, ['rev-parse', '--abbrev-ref', 'HEAD'])))
  const siteBranches = Object.fromEntries(repo.sites.map((site, n) => [site.key, branches[n] ?? '']))
  const fromBranch = pickSource(rootBranch, siteBranches, teamKeys)
  const pinned = await read($, pinnedAtom)
  const pinnedBy = await read($, pinnedByAtom)
  const previous = await read($, sourceAtom)
  const claimedBranch = await read($, claimedBranchAtom)
  const branchMoved = lastBranchId !== undefined && (fromBranch?.id ?? '') !== lastBranchId
  const own = ownCheckout
  ownCheckout = false
  lastBranchId = fromBranch?.id ?? ''
  const others = await read($, othersAtom)
  const root = repo.root
  const d = decideSource({
    fromBranch,
    pinned,
    pinnedBy,
    previous,
    branchMoved,
    own,
    claimedBranch,
    claimedElsewhere: id => others.some(o => o.checkout === root && o.issue === id && o.claimed !== false),
  })
  const by = d.pinnedBy as 'command' | 'manual' | 'held' | null
  if (d.pinned !== pinned || d.pinnedBy !== pinnedBy) await setPin($, d.pinned, by)
  if (d.claimedBranch !== claimedBranch) await update($, claimedBranchAtom, () => d.claimedBranch)
  if (d.use === 'pin' && d.pinned) return pinnedSource(d.pinned, by)
  return d.use === 'branch' ? fromBranch : null
}

function pinnedSource(id: string, by: 'command' | 'manual' | 'held' | null): IssueSource {
  const detail =
    by === 'held' ? 'held: another session moved the branch' : by === 'command' ? `pinned by /${config.pinCommand}` : 'pinned with /linear'
  return { id, from: 'pinned', detail }
}

async function fetchIssue($: EngineInterface, id: string): Promise<Issue | string> {
  if (!apiKey) return 'Linear API key not found (plugin option, LINEAR_API_KEY env, or <repo>/.env)'
  try {
    return toPaneIssue(await issueDetail(linear($), id))
  } catch (err) {
    return `${id}: ${err instanceof Error ? err.message : 'fetch failed'}`
  }
}

async function setPin($: EngineInterface, id: string | null, by: 'command' | 'manual' | 'held' | null): Promise<void> {
  await update($, pinnedAtom, () => id)
  await update($, pinnedByAtom, () => by)
}

function refresh($: EngineInterface, force: boolean): Promise<void> {
  inflight = inflight.then(() => refreshNow($, force)).then(() => syncSessions($)).catch(() => undefined)
  return inflight
}

function heartbeat($: EngineInterface): Promise<void> {
  inflight = inflight.then(() => syncSessions($)).catch(() => undefined)
  return inflight
}

async function syncSessions($: EngineInterface): Promise<void> {
  if (!repo || !registryDir || !config.showOtherSessions) return
  const selfId = await $.session.id()
  const now = await $.clock.now()
  const source = await read($, sourceAtom)
  const issue = await read($, issueAtom)
  const fresh = issue && issue.identifier === source?.id ? issue : null
  const self: SessionEntry = {
    sessionId: selfId,
    checkout: repo.root,
    label: checkoutLabel(repo.root),
    issue: source?.id ?? null,
    title: fresh?.title ?? null,
    state: fresh?.state ?? null,
    stateType: fresh?.stateType ?? null,
    claimed: Boolean(await read($, pinnedAtom)) || (source !== null && (await read($, claimedBranchAtom)) === source.id),
    updatedAt: now,
  }
  await $.fs.write(`${registryDir}/${selfId}.json`, JSON.stringify(self))

  const entries: SessionEntry[] = []
  for (const f of await $.fs.list(registryDir).catch(() => [])) {
    if (!f.name.endsWith('.json')) continue
    const path = `${registryDir}/${f.name}`
    if (now - f.mtimeMs > GC_MS) {
      await $.process.run(['rm', '-f', path], { timeoutMs: 2000 }).catch(() => undefined)
      continue
    }
    try {
      entries.push(JSON.parse(await $.fs.read(path)) as SessionEntry)
    } catch {
      // a file mid-write; the next heartbeat reads it
    }
  }

  const others = liveOthers(entries, selfId, now)
  const shape = (list: SessionEntry[]) => JSON.stringify(list.map(o => ({ ...o, updatedAt: 0 })))
  if (shape(others) !== shape(await read($, othersAtom))) await update($, othersAtom, () => others)

  const warned = await read($, conflictsWarnedAtom)
  const unwarned = conflicts(self, others).filter(c => !warned.includes(c.key))
  if (unwarned.length) {
    await update($, conflictsWarnedAtom, list => [...list, ...unwarned.map(c => c.key)])
    for (const c of unwarned) $.ui.toast(`⚠ ${c.text}`)
  }
}

async function refreshNow($: EngineInterface, force: boolean): Promise<void> {
  if (teamKeys.length === 0 && apiKey) teamKeys = await loadTeamKeys($)
  const source = await resolveSource($)
  const previous = await read($, sourceAtom)
  if (JSON.stringify(previous) !== JSON.stringify(source)) await update($, sourceAtom, () => source)

  if (!source) {
    await update($, issueAtom, () => null)
    await update($, errorAtom, () => null)
    return
  }

  const current = await read($, issueAtom)
  if (!force && current?.identifier === source.id) return

  const got = await fetchIssue($, source.id)
  if ((await read($, sourceAtom))?.id !== source.id) return
  if (typeof got === 'string') {
    await update($, errorAtom, () => got)
    return
  }
  if (current?.identifier === got.identifier && current.state !== got.state) {
    $.ui.toast(`${got.identifier} moved to ${got.state}`)
  }
  await update($, errorAtom, () => null)
  await update($, issueAtom, () => got)
}

function linear($: EngineInterface) {
  return createClient(async (url, init) => {
    const res = await $.http.fetch(url, init)
    return { status: res.status, text: res.text }
  }, apiKey ?? '')
}

async function loadTeamKeys($: EngineInterface): Promise<string[]> {
  if (config.teamKeys) {
    // The CLI resolves team keys the same way; hand it the option too.
    await $.env.set('LINEAR_WORKFLOW_TEAM_KEYS', config.teamKeys)
  }
  return resolveTeamKeys({
    option: config.teamKeys,
    configText: repo ? await $.fs.read(`${repo.root}/.claude/linear.json`).catch(() => undefined) : undefined,
    fetchMine: apiKey ? () => myTeamKeys(linear($)) : undefined,
  })
}

type Ui = Pick<ElementTable, 'Box' | 'Text'>

/** `── Title n ─────` across the width; the title never shrinks, the rule does. */
function divider({ Box, Text }: Ui, title: string, width: number, opts: { count?: number; dim?: boolean; marginTop?: number } = {}) {
  return (
    <Box marginTop={opts.marginTop ?? 0}>
      <Box flexShrink={0}>
        <Text dimColor>── </Text>
        <Text bold dimColor={opts.dim}>{title}</Text>
        {opts.count !== undefined && <Text dimColor> {opts.count}</Text>}
        <Text> </Text>
      </Box>
      <Box flexShrink={1} overflow="hidden">
        <Text dimColor wrap="truncate">{'─'.repeat(Math.max(0, width))}</Text>
      </Box>
    </Box>
  )
}

/** `◆ ABC-123  In Progress · High` */
function header({ Box, Text }: Ui, issue: Issue) {
  return (
    <Box>
      <Text bold color={stateColor(issue.stateType)}>◆ </Text>
      <Text bold>{issue.identifier}  </Text>
      <Text color={stateColor(issue.stateType)}>{issue.state}</Text>
      <Text dimColor> · {issue.priority}</Text>
    </Box>
  )
}

export const register: Register = (on, options) => {
  config = {
    linearApiKey: String(options.linearApiKey ?? ''),
    teamKeys: String(options.teamKeys ?? ''),
    registryFile: String(options.registryFile ?? 'sites.json'),
    pinCommand: String(options.pinCommand ?? 'issue-start').replace(/^\//, ''),
    pollMinutes: Math.max(1, Number(options.pollMinutes ?? 5) || 5),
    showOtherSessions: options.showOtherSessions !== false,
  }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: 'linear',
      description: 'Linear issue pane — /linear [ABC-123 | refresh | clear | hide | show]',
    })
    $.clock.every(config.pollMinutes * 60 * 1000, () => refresh($, true))
    $.clock.every(HEARTBEAT_MS, () => heartbeat($))
    repo = await loadRepo($)
    apiKey = await loadKey($)
    teamKeys = await loadTeamKeys($)
    const home = await $.env.get('HOME')
    registryDir = home ? `${home}/.claude/linear-workflow/sessions` : null
    // Learn which issues other sessions claim before choosing this session's own.
    await heartbeat($)
    await refresh($, true)
    if (await read($, sourceAtom)) void $.ui.open({ id: PANE, title: 'Linear' })
    return started
  })

  on('command.run', { command: 'linear' }, async ($, e) => {
    const arg = e.args.trim()
    switch (arg.toLowerCase()) {
      case 'refresh':
        await refresh($, true)
        return { text: 'Linear issue refreshed.' }
      case 'clear':
        await setPin($, null, null)
        await refresh($, true)
        return { text: 'Pin cleared; following the branch again.' }
      case 'hide':
      case 'show':
        await update($, hiddenAtom, () => arg.toLowerCase() === 'hide')
        return { text: `Band ${arg.toLowerCase() === 'hide' ? 'hidden' : 'shown'}.` }
    }

    if (arg) {
      const id = idFromText(arg)
      if (!id) return { text: `Not an issue id: ${arg}` }
      await setPin($, id, 'manual')
      await refresh($, true)
    }
    await $.ui.open({ id: PANE, title: 'Linear' })
    return { text: arg ? `Pinned ${idFromText(arg)}.` : 'Linear pane opened.' }
  })

  on('command.run', async ($, e, next) => {
    const name = String(e.command).split(':').pop()
    const id =
      config.pinCommand && name === config.pinCommand
        ? (normalizeId(e.args, teamKeys.length === 1 ? teamKeys[0] : undefined) ?? idFromText(e.args))
        : undefined
    if (id) {
      await setPin($, id, 'command')
      await refresh($, true)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (registryDir) {
      await $.process.run(['rm', '-f', `${registryDir}/${e.sessionId}.json`], { timeoutMs: 2000 }).catch(() => undefined)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await refresh($, false)
    return done
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    const succeeded = !('deny' in result && result.deny) && !result.isError
    if (succeeded && isCheckout(String((e as unknown as { command?: string }).command ?? ''))) ownCheckout = true
    return result
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    if (repo && (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit' || tool === 'NotebookEdit')) {
      const input = e as unknown as { file_path?: string; notebook_path?: string }
      const path = input.file_path ?? input.notebook_path ?? ''
      const fetched = await read($, issueAtom)
      const issue = fetched?.identifier === (await read($, sourceAtom))?.id ? fetched : null
      const siteKeys = repo.sites.map(s => s.key)
      const site = issue && driftSite(path, repo.sites, scopeSites(issue, siteKeys))
      if (issue && site) {
        const tag = `${issue.identifier}:${site}`
        if (!(await read($, warnedAtom)).includes(tag)) {
          await update($, warnedAtom, list => [...list, tag])
          $.ui.toast(`Drift: editing ${site}, outside ${issue.identifier}'s scope (${scopeSites(issue, siteKeys).join(', ')})`)
        }
      }
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const source = await read($, sourceAtom)
    const others = await read($, othersAtom)
    if (e.props.hasSurvey || !repo || (await read($, hiddenAtom))) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const issue = await read($, issueAtom)
    const error = await read($, errorAtom)
    const width = e.props.bodyColumns
    const clashing = new Set(
      repo ? conflicts({ checkout: repo.root, issue: source?.id ?? null }, others).map(c => c.sessionId) : [],
    )

    const ui = { Box, Text }
    const rule = divider(ui, 'Linear', width, { dim: true })
    const sessionsRow = others.length > 0 && (
      <Box>
        <Box flexShrink={0}>
          <Text dimColor>  sessions  </Text>
        </Box>
        {others.map((o, i) => {
          const clash = clashing.has(o.sessionId)
          const text = o.issue ? `${o.issue}${o.state ? ` ${o.state}` : ''} (${o.label})` : `${o.label}: no issue`
          return (
            <Text key={o.sessionId} color={clash ? 'red' : undefined} dimColor={!clash} wrap="truncate">
              {i > 0 ? '  ·  ' : ''}
              {clash ? '⚠  ' : ''}
              {text}
            </Text>
          )
        })}
      </Box>
    )
    const buttons = (
      <Box>
        <Button key="details" label="Details" plain onPress={() => $.ui.open({ id: PANE, title: 'Linear' })} />
        <Text>  </Text>
        <Button key="hide" label="Hide" plain onPress={() => update($, hiddenAtom, () => true)} />
      </Box>
    )

    if (!source) {
      return (
        <Box flexDirection="column" width={width} marginTop={1}>
          {rule}
          <Text dimColor>  No Linear issue found</Text>
          {sessionsRow}
        </Box>
      )
    }

    if (!issue || issue.identifier !== source.id) {
      return (
        <Box flexDirection="column" width={width} marginTop={1}>
          {rule}
          <Text dimColor wrap="truncate">
            ◆ {source.id}  {error ?? 'loading…'}
          </Text>
          {sessionsRow}
        </Box>
      )
    }

    const siteKeys = repo?.sites.map(s => s.key) ?? []
    const scope = scopeSites(issue, siteKeys)
    const meta = [
      source.from === 'pinned' ? (source.detail.startsWith('held') ? 'held' : 'pinned') : source.from === 'root' ? 'root branch' : source.detail,
      scope.length ? `scope: ${scope.join(', ')}` : 'scope: all sites',
      issue.parent ? `parent ${issue.parent.identifier}` : '',
      error ? `stale: ${error}` : '',
    ].filter(Boolean)

    return (
      <Box flexDirection="column" width={width} marginTop={1}>
        {rule}
        {header(ui, issue)}
        <Text wrap="truncate">  {issue.title}</Text>
        <Box justifyContent="space-between">
          <Box flexShrink={1}>
            <Text dimColor wrap="truncate">  {meta.join(' · ')}</Text>
          </Box>
          <Box flexShrink={0}>{buttons}</Box>
        </Box>
        {sessionsRow}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link, Markdown } = $.ui.resolve(e)
    const source = await read($, sourceAtom)
    const issue = await read($, issueAtom)
    const error = await read($, errorAtom)
    const others = await read($, othersAtom)
    const width = e.props.bodyColumns
    const clashes = repo ? conflicts({ checkout: repo.root, issue: source?.id ?? null }, others) : []

    const ui = { Box, Text }
    const section = (title: string, count?: number) => divider(ui, title, width, { count, marginTop: 1 })
    const field = (label: string, value: string | null | undefined) =>
      value ? (
        <Box key={label}>
          <Box flexShrink={0} width={11}>
            <Text dimColor>{label}</Text>
          </Box>
          <Box flexShrink={1}>
            <Text wrap="truncate">{value}</Text>
          </Box>
        </Box>
      ) : null
    const othersSection = others.length > 0 && (
      <Box flexDirection="column">
        {section('Other sessions', others.length)}
        {others.map(o => (
          <Box key={o.sessionId}>
            <Text color={o.stateType ? stateColor(o.stateType) : undefined}>{(o.state ?? '—').padEnd(13)}</Text>
            <Text wrap="truncate">{o.issue ?? 'no issue'}  {o.title ?? ''}</Text>
            <Text dimColor>  {o.label}</Text>
          </Box>
        ))}
        {clashes.map(c => <Text key={c.key} color="red">⚠  {c.text}</Text>)}
      </Box>
    )

    if (!issue || issue.identifier !== source?.id) {
      return (
        <Box flexDirection="column" width={width}>
          <Text dimColor>{source ? `${source.id}: ${error ?? 'loading…'}` : 'No Linear issue on this branch. /linear ABC-123 pins one.'}</Text>
          {othersSection}
        </Box>
      )
    }

    const siteKeys = repo?.sites.map(s => s.key) ?? []
    const scope = scopeSites(issue, siteKeys)
    const sourceText = source
      ? source.from === 'pinned' ? source.detail : source.from === 'root' ? `branch ${source.detail}` : source.detail
      : null

    return (
      <Box flexDirection="column" width={width}>
        {header(ui, issue)}
        <Text bold>{issue.title}</Text>
        <Box marginTop={1}>
          <Button key="copy" label="Copy link" onPress={async () => {
            const copied = await $.ui.copy({ text: issue.url })
            $.ui.toast(copied.isCopied ? `Copied ${issue.url}` : issue.url)
          }} />
          <Text>  </Text>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refresh($, true)} />
        </Box>
        {error && <Text color="red">Refresh failed: {error}</Text>}

        <Box flexDirection="column" marginTop={1}>
          {field('Parent', issue.parent ? `${issue.parent.identifier} · ${issue.parent.title}` : null)}
          {field('Assignee', issue.assignee)}
          {field('Cycle', issue.cycle !== null ? String(issue.cycle) : null)}
          {field('Milestone', issue.milestone)}
          {field('Labels', issue.labels.join(', ') || null)}
          {field('Scope', scope.length ? scope.join(', ') : 'all')}
          {field('Source', sourceText)}
        </Box>

        {issue.children.length > 0 && (
          <Box flexDirection="column">
            {section('Sub-issues', issue.children.length)}
            {issue.children.map(c => (
              <Box key={c.identifier}>
                <Text color={stateColor(c.stateType)}>{c.state.padEnd(13)}</Text>
                <Text wrap="truncate">{c.identifier}  {c.title}</Text>
              </Box>
            ))}
          </Box>
        )}

        {section('Description')}
        <Markdown text={issue.description || '_No description._'} />

        {issue.comments.length > 0 && (
          <Box flexDirection="column">
            {section('Latest comments', issue.comments.length)}
            {issue.comments.map((c, i) => (
              <Box key={`c${i}`} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
                <Text dimColor>{c.author} · {c.createdAt}</Text>
                <Markdown text={c.body} />
              </Box>
            ))}
          </Box>
        )}

        {section('Links')}
        <Link href={issue.url} label="Open in Linear" />
        {issue.links.map(l => <Link key={l.url} href={l.url} label={l.title} />)}

        {othersSection}
      </Box>
    )
  })
}

// What each skill step gets to see: only the fields it reads, so nothing else enters the conversation.

import type { PrVerdict } from './pr.ts'
import type { IssueDetail, PlanCycleResult, QueueResult } from './workflow.ts'

/** The description without one `## Heading` section (any level), e.g. the acceptance criteria. */
export function withoutSection(markdown: string, heading: RegExp): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let skipLevel = 0
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*?)\s*:?\s*$/.exec(line.trim())
    if (h?.[1] && h[2] !== undefined) {
      if (skipLevel && h[1].length <= skipLevel) skipLevel = 0
      if (!skipLevel && heading.test(h[2])) {
        skipLevel = h[1].length
        continue
      }
    }
    if (!skipLevel) out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

const ACCEPTANCE = /^acceptance criteria$/i

/** issue-start: context and comments to work from; the acceptance criteria are left out on purpose. */
export function startView(d: IssueDetail) {
  return {
    identifier: d.identifier,
    title: d.title,
    url: d.url,
    state: d.state.name,
    priority: d.priorityLabel,
    parent: d.parent ? { identifier: d.parent.identifier, title: d.parent.title } : null,
    blockedBy: d.blockedBy,
    cycle: d.cycle,
    milestone: d.milestone?.name ?? null,
    branchName: d.branchName,
    description: withoutSection(d.description, ACCEPTANCE),
    comments: d.comments.map(c => ({ author: c.author, date: c.createdAt.slice(0, 10), body: c.body })),
  }
}

/** issue-review: what the change must satisfy. */
export function reviewView(d: IssueDetail) {
  return { identifier: d.identifier, title: d.title, labels: d.labels, acceptanceCriteria: d.acceptanceCriteria }
}

/** `overdue 3d`, `due today`, `ends in 5d`, or `no due`: worded here so every model shows the same. */
export function urgency(dueInDays: number | null): string {
  if (dueInDays === null) return 'no due'
  if (dueInDays < 0) return `overdue ${-dueInDays}d`
  return dueInDays === 0 ? 'due today' : `ends in ${dueInDays}d`
}

/** issue-next: one compact entry per candidate, already ranked and worded for display. */
export function queueView(r: QueueResult) {
  return {
    cycle: r.cycle ? { number: r.cycle.number, team: r.cycle.teamKey, endsAt: r.cycle.endsAt.slice(0, 10) } : null,
    examined: r.examined,
    blocked: r.droppedBlocked.length,
    droppedEpics: r.droppedEpics,
    candidates: r.candidates.map((c, n) => ({
      rank: n + 1,
      id: c.identifier,
      title: c.title,
      priority: c.priorityLabel,
      urgency: urgency(c.dueInDays),
      state: c.state.name,
      milestone: c.milestone?.name ?? null,
      epic: c.epic?.identifier ?? null,
    })),
  }
}

/** issue-plan-cycle: one compact entry per candidate. */
export function planView(r: PlanCycleResult) {
  return {
    cycle: r.cycle
      ? { number: r.cycle.number, team: r.cycle.teamKey, startsAt: r.cycle.startsAt.slice(0, 10), endsAt: r.cycle.endsAt.slice(0, 10), issueCount: r.cycle.issueCount }
      : null,
    examined: r.examined,
    blocked: r.droppedBlocked,
    childrenHeldBack: r.droppedChildren,
    candidates: r.candidates.map(c => ({
      id: c.identifier,
      title: c.title,
      priority: c.priorityLabel,
      milestone: c.milestone ? `${c.milestone.name}${c.milestone.targetDate ? ` (${c.milestone.targetDate})` : ''}` : null,
    })),
  }
}

/** issue-ship: the verdict, its reasons, and only the PR fields the merge needs. */
export function prView(v: PrVerdict) {
  return {
    verdict: v.verdict,
    reasons: v.reasons,
    pr: v.pr ? { number: v.pr.number, url: v.pr.url, title: v.pr.title, headRefName: v.pr.headRefName, headRefOid: v.pr.headRefOid } : null,
    candidates: v.candidates,
  }
}

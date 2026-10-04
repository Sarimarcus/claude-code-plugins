---
name: issue-next
description: Pick the next Linear issue to work on — the active cycle's unblocked issues ranked by priority and milestone urgency, with an offer to start the top one
---

# /linear-workflow:issue-next — what to work on next

Read-only. A five-second decision, not a planning session. That is `/linear-workflow:issue-plan-cycle`.

## 1. Fetch candidates

Read `.claude/linear.json` if it exists (`team`, `project`, `assignee`). Spawn `linear-workflow:linear-manager`:

> Find the current cycle for team <team> (`list_cycles` type current). List issues in it assigned
> to <assignee, default me>, in a Todo or In Progress state, with no open blocker. If an In Progress
> issue has sub-issues, it is an epic: return its next unblocked Todo/In Progress sub-issue instead,
> tagged with the epic's id and title, or skip it if none is eligible. Return identifier, title,
> priority, state, milestone name and target date, labels, URL and epic (if redirected), ordered by
> priority (Urgent first, no priority last), then milestone target date (soonest first), then
> creation date (oldest first). Return at most 10. Never return descriptions. Also return the cycle
> number and dates.

- No active cycle → stop: `No active cycle. Create one in Linear, or run /linear-workflow:issue-plan-cycle.`
- No candidates → stop: `Nothing unblocked in the cycle. Run /linear-workflow:issue-plan-cycle to add work.`

## 2. Show the top 5

```
ABC-123  Urgent · ends in 2d    <title>
         milestone: <name>      why: highest priority, nearest milestone
ABC-140  High · no due          <title>   [epic: ABC-100 <title>]
         why: next unblocked sub-issue of in-progress epic ABC-100
```

- Show urgency relative to today: `ends in Nd`, `overdue Nd`, or `no due`.
- Give a "why" of one short sentence per row, and don't repeat the same reason word for word.
- Don't invent urgency the data doesn't support.

## 3. Offer to start

`Start ABC-123? [Y/n/<other id>]`. On `Y` or Enter, run `/linear-workflow:issue-start ABC-123`. On another id, start
that one instead. On `n`, stop. If the user declines all five, offer the next five once, then stop.

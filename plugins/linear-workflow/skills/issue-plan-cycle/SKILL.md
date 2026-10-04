---
name: issue-plan-cycle
description: Feed the active Linear cycle from the backlog — list unscheduled, unblocked candidates by priority, confirm, then set their cycle
disable-model-invocation: true
---

# /linear-workflow:issue-plan-cycle — add backlog issues to the active cycle

Changes cycle membership only. It never touches priority, status, milestone or assignee.

## 1. Fetch

Read `.claude/linear.json` if it exists (`team`, `project`, `assignee`). Spawn `linear-workflow:linear-manager`:

> For team <team>: return the current cycle (number, start, end, issue count). Then list issues
> in project <project, or all projects> assigned to <assignee, default me>, in a Backlog or Todo
> state, in no cycle, with no open blocker. Leave out sub-issues whose parent is already in the
> cycle, and report how many were left out and how many were blocked. Order by priority, then
> milestone target date, then creation date. Return at most 15, with identifier, title, priority,
> milestone (name and date), parent and URL. Never return descriptions.

- No active cycle → stop: `No active cycle. Create one in Linear first.`
- No candidates → stop, and say how many were held back as blocked and how many as children, so
  "nothing to schedule" is distinguishable from "everything was filtered out".

## 2. Show

```
Cycle #11 (2026-09-07 → 2026-09-21) — 24 issues in cycle
Candidates (10 of 33; 4 blocked, 7 sub-issues held back):

  ABC-285  Urgent  <title>
  ABC-451  High    <title>   (milestone: <name>, 2026-09-30)
```

No scoring and no capacity estimate: how much goes into the cycle is the user's call.

## 3. Confirm

`Add which issues to cycle #11? [all / none / ABC-285 ABC-451 …]`

## 4. Write

Spawn `linear-workflow:linear-manager`: `Set the cycle to <number> on <ids>. Change no other field.`

## 5. Report

The issues that were added (✓) and the ones skipped by your choice (—).

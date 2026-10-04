---
name: issue-plan-cycle
model: haiku
description: Feed the active Linear cycle from the backlog — list unscheduled, unblocked candidates by priority, confirm, then set their cycle
disable-model-invocation: true
---

# issue-plan-cycle — add backlog issues to the active cycle

Changes cycle membership only. It never touches priority, status, milestone or assignee.

Every CLI call below is written out in full. A shell variable set in one Bash call does not exist in the next.

## 1. Fetch

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" plan-cycle --limit 15
```

The CLI selects your unscheduled, unblocked Backlog and Todo issues in the cycle's team (and in
`project` if set), ranked. It holds back sub-issues whose parent is already in the cycle.
JSON: `cycle` (`number`, `startsAt`, `endsAt`, `issueCount`), `examined`, `blocked` and `childrenHeldBack`
(counts), and `candidates`, each `{id, title, priority, milestone}`.

- Exit 1 for a missing key or a Linear failure → ask the `linear-workflow:linear-manager` agent for
  the same list and say so.
- `cycle` is null → stop: `No active cycle. Create one in Linear first.`
- `candidates` is empty → stop, and report `blocked` and `childrenHeldBack`, so "nothing to
  schedule" is distinguishable from "everything was filtered out".

## 2. Show

```
Cycle #11 (2026-09-07 → 2026-09-21) — 24 issues in cycle
Candidates (10 of 33 examined; 4 blocked, 7 sub-issues held back):

  ABC-285  Urgent  <title>
  ABC-451  High    <title>   (milestone: <name>, 2026-09-30)
```

No scoring and no capacity estimate: how much goes into the cycle is the user's call.

## 3. Confirm

`Add which issues to cycle #11? [all / none / ABC-285 ABC-451 …]`

## 4. Write

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" set-cycle <number> <ids…>
```

The JSON lists `set`, `already` and `failed`. Exit 1 means at least one failed.

## 5. Report

The issues added (✓), the ones already in the cycle, any failures with their error, and the ones
skipped by your choice (—).

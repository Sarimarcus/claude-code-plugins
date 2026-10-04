---
description: Start work on a Linear issue — fetch it, move it to In Progress, load its context and comments, create its branch, then begin
argument-hint: "<ABC-123>"
---

# /issue-start — begin work on a Linear issue

Takes you from a cold start to implementation in one command. There is no "ready to proceed?" pause.

## 1. Parse the identifier

Take the issue id from `$ARGUMENTS`: `ABC-123`, `abc-123`, `#123` or `123`. For a bare number, use the
`teamKey` from `.claude/linear.json` if present. Normalize to `ABC-123`. If the argument is empty, stop with
`Usage: /issue-start <ABC-123>`.

## 2. Fetch and transition

Spawn the `linear-manager` agent:

> Fetch <ID> with its relations and move it to "In Progress". Return title, state, priority,
> parent (id and title), open blockers (id and state), cycle, milestone, labels, `gitBranchName`, URL
> and the full description. List every comment on the issue and return each one **verbatim**
> (author, date, full body).

If it reports "Already in In Progress", continue.

## 3. Show the context

From the description, show `## Context`, `## Implementation` and `## Scope` verbatim, or the whole
description if it has no such headings. Leave out `## Acceptance Criteria`: those are for the
reviewer. Loading them at the start pushes the work toward ticking boxes.

The comments are part of the spec. Reproduce **verbatim** any comment that asks for something to be
built, changed or avoided, and treat it as scope. Summarize status notes in one line each. A newer
comment that contradicts the description wins. If the conflict is material, say so and ask. When
there are no comments, print `Comments: none`.

```markdown
**ABC-123: <title>** — In Progress   (parent: ABC-100 <title>)

## Context …
## Implementation …
## Scope …
## Comments (N)
```

If the issue has open blockers, list them and ask `Continue anyway? [y/N]`. Go on only on a yes.

## 4. Branch

Use the `gitBranchName` Linear returned (fall back to `<abc-123>-<slugified-title>` if it is missing).
Base it on the configured `baseBranch` (default: the repo's default branch):

```bash
git switch "<branch>" 2>/dev/null || git switch -c "<branch>"
```

If the working tree has uncommitted changes that are not part of this issue, stop and ask before
switching branches. Never stash or discard them.

Print one line: `` Branch `<branch>` · <priority> · cycle <n|none> · milestone <name|none> ``.

## 5. Start the work

Begin right away on the Implementation and Scope steps and on any actionable comments: read the
relevant files and make the first change. Stop only for a real blocker that needs the user's
decision.

When the work is done: `/issue-review <ABC-123>` opens the PR, and `/issue-ship <ABC-123>` merges it.

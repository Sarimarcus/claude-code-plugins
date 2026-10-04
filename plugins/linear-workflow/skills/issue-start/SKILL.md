---
name: issue-start
description: Start work on a Linear issue — fetch it, move it to In Progress, load its context and comments, create its branch from the base, then begin
argument-hint: "<ABC-123>"
---

# issue-start — begin work on a Linear issue

Takes you from a cold start to implementation in one command. There is no "ready to proceed?" pause.

The deterministic steps run through the bundled CLI. It prints JSON on stdout and one summary line
on stderr. Exit 0 means ok, 1 means an error (the message is in `error`), and 2 means it refused.

Every CLI call below is written out in full. A shell variable set in one Bash call does not exist in the next.

**Project conventions win.** Where the project's `CLAUDE.md`, `CONTRIBUTING.md` or `.claude/linear.json`
says otherwise (commit style, PR format, checks, branching, state names), follow the project. The
steps below are the defaults.

**Fallback:** if a CLI call exits 1 because the API key is missing or Linear is unreachable, do the same
step through the `linear-workflow:linear-manager` agent and say that you did.

## 1. Fetch (one call)

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" start "$ARGUMENTS"
```

`$ARGUMENTS` can be `ABC-123`, `#123` or `123`; a bare number needs `teamKey` in `.claude/linear.json`.
Exit 1 on a bad id → stop with `Usage: /linear-workflow:issue-start <ABC-123>`.

`issue` has `identifier`, `title`, `url`, `state`, `priority`, `parent`, `blockedBy` (open blockers
only), `cycle`, `milestone`, `branchName`, `description` and `comments` (every comment, oldest first,
verbatim). `repo` has `branch`, `baseBranch`, `branching` and `dirty` (count and first files).

The description comes **without its Acceptance Criteria**: the CLI removes them, because they are for
the reviewer, and starting from them pushes the work toward ticking boxes. Don't fetch them.

## 2. Show the context

From `issue.description`, show `## Context`, `## Implementation` and `## Scope` verbatim, or the
whole description if it has no such headings.

The comments are part of the spec. Reproduce **verbatim** any comment that asks for something to be
built, changed or avoided, and treat it as scope. Summarize status notes in one line each. A newer
comment that contradicts the description wins. If the conflict is material, say so and ask. When
there are no comments, print `Comments: none`.

```markdown
**ABC-123: <title>** — <state>   (parent: ABC-100 <title>)

## Context …
## Implementation …
## Scope …
## Comments (N)
```

If `blockedBy` is not empty, list the blockers and ask `Continue anyway? [y/N]`. Go on only on a yes.

Do steps 1–3 before touching git: don't create or switch branches until you've seen the context and
the blockers.

## 3. Move to In Progress

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" transition <ID> "In Progress"
```

Idempotent: if the issue is already in that state, nothing is written.

## 4. Branch

**Never**, whatever happens: `git push --force`, `git reset --hard`, `git clean`, `git checkout -- .`
or `git restore .`, a bare `git stash`, or `git commit --amend`. Each can destroy work that isn't
yours, for example another session's in a shared checkout. If one seems necessary, stop and ask.

`repo.branching` decides: `create` (default) creates the issue's branch as below; `ask` asks
first; `none` stays on the current branch and skips this step.

If `repo.dirty.count` is not 0, those uncommitted changes aren't part of this issue: stop and ask
before switching branches. Never stash or discard them.

Use `issue.branchName` (Linear always sets it). If the branch exists, switch to it. Otherwise create
it **from the up-to-date base**, never from what is checked out now: starting from another issue's
branch would drag its commits into this PR. `<base>` is `repo.baseBranch`, which already falls back
to the repo's default branch.

```bash
git fetch origin "<base>" && \
{ git switch "<branch>" 2>/dev/null || git switch -c "<branch>" "origin/<base>"; }
```

Print one line: `` Branch `<branch>` · <priority> · cycle <n|none> · milestone <name|none> ``.

## 5. Start the work

Begin right away on the Implementation and Scope steps and on any actionable comments: read the
relevant files and make the first change. Stop only for a real blocker that needs the user's
decision.

When the work is done, run `/linear-workflow:issue-review` to open the PR, then
`/linear-workflow:issue-ship` to merge it.

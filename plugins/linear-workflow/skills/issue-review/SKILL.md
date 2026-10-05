---
name: issue-review
description: Put a Linear issue up for review — run the project's checks, commit, push the branch, open a PR that closes the issue, move it to In Review
argument-hint: "[<ABC-123>]"
---

# issue-review — open the PR for a Linear issue

Checks → commit → push the feature branch → PR with `Closes ABC-123` → In Review. Nothing gets
merged or deployed. That is `issue-ship`.

Running this command authorizes pushing **this issue's feature branch**. It never pushes the base branch.

Every CLI call below is written out in full. A shell variable set in one Bash call does not exist in the next.

**Project conventions win.** Where the project's `CLAUDE.md`, `CONTRIBUTING.md` or `.claude/linear.json`
says otherwise (commit style, PR format, checks, branching, state names), follow the project. The
steps below are the defaults.

If a CLI call exits 1 because the API key is missing or Linear is unreachable, do that step through
the `linear-workflow:linear-manager` agent instead and say so.

## 1. Everything the review needs (one call)

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" review $ARGUMENTS
```

Without an argument, pass the issue this session started with `issue-start`, if any. Otherwise the
CLI resolves it: the issue id in the branch name, then your only started issue in Linear. Exit 2 →
it found none or several: stop and list `candidates`. If `issue.from` isn't `argument`, print
`Resolved ABC-123 (from <from>)` before anything else.

`issue` has `identifier`, `title`, `labels` and `acceptanceCriteria`. `repo` has `branch`,
`baseBranch`, `onBaseBranch`, `branchIssue` (the issue id the branch name points to), `existingPr`
(this branch's open PR, or null), `checks` and `dirty` (count and first files).

## 2. Pre-flight

- `repo.onBaseBranch` is true → stop: there is no branch to review. Run `issue-start` first or switch
  to the issue's branch.
- `repo.branchIssue` is another issue → stop: this branch belongs to that issue, and committing here
  would put this work under it. `repo.branchIssue` is null (the branch names no issue) → say so and
  ask before going on.
- Look at the uncommitted files. If some clearly don't belong to this issue, ask which ones to
  include. Never commit them silently.

## 3. Acceptance criteria

`issue-start` left these out on purpose. Check them now, before anything is committed. For each
entry in `issue.acceptanceCriteria`, say whether the change meets it, with the evidence (the file,
test or behaviour). If any isn't met, or you can't tell, list those and ask whether to open the PR
anyway. If the list is empty, say the issue has no acceptance criteria.

## 4. Checks

Run each command in `repo.checks`, in order. If none are configured, infer the obvious ones (e.g.
`npm run build` / `npm test` when `package.json` defines them, `make test`, `cargo test`) and say
which ones you ran. Stop on the first failure and show its output. Don't commit.

## 5. Commit and push

**Never**, whatever happens: `git push --force`, `git reset --hard`, `git clean`, `git checkout -- .`
or `git restore .`, a bare `git stash`, or `git commit --amend`. Each can destroy work that isn't
yours, for example another session's in a shared checkout. If one seems necessary, stop and ask.

- Stage the paths that belong to this issue explicitly. Never `git add -A`.
- Message: the project's commit convention if it has one (CLAUDE.md, CONTRIBUTING.md, recent `git log`).
  Otherwise a conventional-commit prefix (`fix:` for a Bug label or a "fix" title, else `feat:`/`chore:`)
  + the issue title + ` (ABC-123)`. Always keep the issue id in it.
- Skip the commit if there is nothing to commit. A branch that is already ahead still needs the push.
- `git push -u origin HEAD`. Never force-push.

## 6. Open the PR

If `repo.existingPr` is set, reuse it. Otherwise open one. If the repo has a PR template
(`.github/pull_request_template.md` or `.github/PULL_REQUEST_TEMPLATE/`), fill that in and add the
`Closes ABC-123` line to it; otherwise use:

```bash
gh pr create --base "<repo.baseBranch>" --title "<title> (ABC-123)" --body "$(cat <<'BODY'
## Summary

Closes ABC-123.

- <one or two bullets about the change>

## Test plan

- [ ] <one verifiable check>
BODY
)"
```

The `Closes ABC-123` line is what links the PR to the issue, so it is required.

## 7. Linear

Write the completion comment to a temp file, then:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" transition ABC-123 "In Review" --comment-file <file>
```

The comment, four bullets:

```markdown
- **Changed:** <one line>
- **Files:** see commit `<sha>`
- **Verified:** <checks and their result>
- **Next:** review <PR URL>, then `/linear-workflow:issue-ship ABC-123`
```

The transition is idempotent. If Linear's GitHub integration already moved the issue, nothing is
re-saved, but the comment is still posted and the parent roll-up still runs. The JSON says which
(`changed`, `commented`, `parent`).

## 8. Report

```
ABC-123 up for review.
  Branch: <branch> (<sha>)
  PR:     <url>
  Checks: <commands> ✓
  Linear: <from> → In Review (or already), comment posted
  Next:   /linear-workflow:issue-ship ABC-123
```

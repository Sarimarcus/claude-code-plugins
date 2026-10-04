---
name: issue-review
description: Put a Linear issue up for review — run the project's checks, commit, push the branch, open a PR that closes the issue, move it to In Review
argument-hint: "[<ABC-123>]"
disable-model-invocation: true
---

# issue-review — open the PR for a Linear issue

Checks → commit → push the feature branch → PR with `Closes ABC-123` → In Review. Nothing gets
merged or deployed. That is `issue-ship`.

Running this command authorizes pushing **this issue's feature branch**. It never pushes the base branch.

```bash
LW="${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.ts"
```

If a CLI call exits 1 because the API key is missing or Linear is unreachable, do that step through
the `linear-workflow:linear-manager` agent instead and say so.

## 1. Resolve the issue and settings

If this session started an issue with `issue-start` and no argument was given, use that id. Otherwise:

```bash
node "$LW" resolve $ARGUMENTS
node "$LW" config
```

`resolve` takes the argument, then the issue id in the branch name, then your only started issue in
Linear. Exit 2 → it found none or several: stop and list `candidates`. If the id came from the
branch or from Linear, print `Resolved ABC-123 (from <from>)` before anything else.

`config` gives `baseBranch`, `checks` and the current `branch`.

## 2. Pre-flight

- Current branch is the base branch (or `main`/`master`) → stop: there is no branch to review. Run
  `issue-start` first or switch to the issue's branch.
- Show `git status --short`. If files that clearly don't belong to this issue are modified, ask
  which ones to include. Never commit them silently.

## 3. Checks

Run each command in `checks`, in order. If none are configured, infer the obvious ones (e.g.
`npm run build` / `npm test` when `package.json` defines them, `make test`, `cargo test`) and say
which ones you ran. Stop on the first failure and show its output. Don't commit.

## 4. Commit and push

- Stage the paths that belong to this issue explicitly. Never `git add -A`.
- Message: a conventional-commit prefix (`fix:` for a Bug label or a "fix" title, otherwise `feat:`/`chore:` by
  judgment) + the issue title + ` (ABC-123)`.
- Skip the commit if there is nothing to commit. A branch that is already ahead still needs the push.
- `git push -u origin HEAD`. Never force-push.

## 5. Open the PR

If a PR already exists for the branch (`gh pr view --json url`), reuse it. Otherwise:

```bash
gh pr create --base "<baseBranch>" --title "<title> (ABC-123)" --body "$(cat <<'BODY'
## Summary

Closes ABC-123.

- <one or two bullets about the change>

## Test plan

- [ ] <one verifiable check>
BODY
)"
```

The `Closes ABC-123` line is what links the PR to the issue, so it is required.

## 6. Linear

Write the completion comment to a temp file, then:

```bash
node "$LW" transition ABC-123 "In Review" --comment-file <file>
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

## 7. Report

```
ABC-123 up for review.
  Branch: <branch> (<sha>)
  PR:     <url>
  Checks: <commands> ✓
  Linear: <from> → In Review (or already), comment posted
  Next:   /linear-workflow:issue-ship ABC-123
```

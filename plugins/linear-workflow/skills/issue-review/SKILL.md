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

Every CLI call below is written out in full. A shell variable set in one Bash call does not exist in the next.

**Project conventions win.** Where the project's `CLAUDE.md`, `CONTRIBUTING.md` or `.claude/linear.json`
says otherwise (commit style, PR format, checks, branching, state names), follow the project. The
steps below are the defaults.

If a CLI call exits 1 because the API key is missing or Linear is unreachable, do that step through
the `linear-workflow:linear-manager` agent instead and say so.

## 1. Resolve the issue and settings

If this session started an issue with `issue-start` and no argument was given, use that id. Otherwise:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" resolve $ARGUMENTS
node "${CLAUDE_PLUGIN_ROOT}/bin/linear-workflow.mjs" config
```

`resolve` takes the argument, then the issue id in the branch name, then your only started issue in
Linear. Exit 2 → it found none or several: stop and list `candidates`. If the id came from the
branch or from Linear, print `Resolved ABC-123 (from <from>)` before anything else.

`config` gives `branch`, the resolved `baseBranch`, `onBaseBranch`, `existingPr` (the open PR for
this branch, or null) and `checks`.

## 2. Pre-flight

- `onBaseBranch` is true → stop: there is no branch to review. Run `issue-start` first or switch to
  the issue's branch.
- Show `git status --short`. If files that clearly don't belong to this issue are modified, ask
  which ones to include. Never commit them silently.

## 3. Checks

Run each command in `checks`, in order. If none are configured, infer the obvious ones (e.g.
`npm run build` / `npm test` when `package.json` defines them, `make test`, `cargo test`) and say
which ones you ran. Stop on the first failure and show its output. Don't commit.

## 4. Commit and push

- Stage the paths that belong to this issue explicitly. Never `git add -A`.
- Message: the project's commit convention if it has one (CLAUDE.md, CONTRIBUTING.md, recent `git log`).
  Otherwise a conventional-commit prefix (`fix:` for a Bug label or a "fix" title, else `feat:`/`chore:`)
  + the issue title + ` (ABC-123)`. Always keep the issue id in it.
- Skip the commit if there is nothing to commit. A branch that is already ahead still needs the push.
- `git push -u origin HEAD`. Never force-push.

## 5. Open the PR

If `config` reported an `existingPr`, reuse it. Otherwise open one. If the repo has a PR template
(`.github/pull_request_template.md` or `.github/PULL_REQUEST_TEMPLATE/`), fill that in and add the
`Closes ABC-123` line to it; otherwise use:

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

## 7. Report

```
ABC-123 up for review.
  Branch: <branch> (<sha>)
  PR:     <url>
  Checks: <commands> ✓
  Linear: <from> → In Review (or already), comment posted
  Next:   /linear-workflow:issue-ship ABC-123
```

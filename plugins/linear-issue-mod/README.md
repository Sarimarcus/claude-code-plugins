# linear-issue-mod — a Claude Code mod

A Claude Code mod (a plugin of live hooks that draws its own UI) that shows the Linear issue
you're working on right above the prompt, so the issue for
the session is always in view.

```
◆ ENG-2919 In Progress · High · Core affiliate link builders
root branch · scope: web · parent ENG-2900          Details  Hide
also: ENG-2748 In Review (eng-2748) · ⚠ ENG-2912 In Progress (main)
```

- **Band above the prompt**: issue id, state, priority, title, scope and parent issue.
- **Details pane** (`/linear`): description, sub-issues, links, latest comments, and an
  "Open in Linear" button.
- **Issue from your branch**: `alex/eng-2919-link-builders` → `ENG-2919`. If the root repo is
  on a branch without an issue id (e.g. `main`), it checks the branches of the sub-projects in the
  registry (see below).
- **Other sessions**: every Claude Code session on the machine that runs the mod appears on the
  `also:` row, with its issue and checkout (`main` or the worktree name).
- **Conflict warnings**: a toast and a red ⚠ when another session in the *same checkout* works a
  *different* issue (you share one branch and one working tree), or when two sessions take the same issue.
- **Branch moves by other sessions don't take your issue.** If another session checks out a
  different branch in the shared checkout, your session holds its own issue (`held`). It follows
  the branch again only after your own session runs `git checkout`/`git switch`.
- **Scope drift** (optional): if your repo has a sub-project registry, issue labels that match a
  sub-project key define the issue's scope. Editing files outside that scope raises a toast.
- A toast when the issue changes state in Linear.

It also includes an issue workflow, from picking the issue to the merged PR:

```
/linear-issue-mod:issue-next → /linear-issue-mod:issue-start ENG-123 → (work) → /linear-issue-mod:issue-review → /linear-issue-mod:issue-ship
```

The workflow uses a `linear-manager` subagent (`linear-issue-mod:linear-manager`), so issue payloads stay out of your main conversation.

## Install

```
/plugin marketplace add Sarimarcus/claude-code-plugins
/plugin install linear-issue-mod@sarimarcus
```

Requires a Claude Code version with mods (plugin hooks modules in `hooks/hooks.json` → `modules`).
Developed and tested on 2.1.289.

The band and pane talk to Linear's API directly and need an API key (below). The `/issue-*`
commands and `linear-manager` need two more things:

- **Linear MCP server**: the Linear connector on claude.ai, or
  `claude mcp add --transport http linear https://mcp.linear.app/mcp`
- **GitHub CLI** (`gh`), logged in, for `/linear-issue-mod:issue-review` and `/linear-issue-mod:issue-ship`

Provide a Linear personal API key (Linear → Settings → Security & access) in one of
three ways, checked in this order:

1. the mod's **Linear API key** option (stored as a secret),
2. the `LINEAR_API_KEY` environment variable,
3. a `LINEAR_API_KEY=` line in the `.env` at your repo root.

## Commands

### Workflow

| Command | What it does |
| --- | --- |
| `/linear-issue-mod:issue-next` | Ranks the active cycle's unblocked issues (priority, then milestone date, then age) and offers to start the top one |
| `/linear-issue-mod:issue-start ENG-123` | Moves the issue to In Progress, shows its context and comments, creates Linear's branch for it, and starts work |
| `/linear-issue-mod:issue-review [ENG-123]` | Runs your checks, commits, pushes the branch, opens a PR with `Closes ENG-123`, and moves the issue to In Review |
| `/linear-issue-mod:issue-ship [ENG-123]` | Checks the PR (not a draft, no conflicts, checks green), merges it, verifies the merge, and moves the issue to Done |
| `/linear-issue-mod:issue-plan-cycle` | Lists unscheduled, unblocked backlog issues; you choose which to add to the active cycle |

Without an id, `/linear-issue-mod:issue-review` and `/linear-issue-mod:issue-ship` use the session's issue, then the branch name.
Running `/linear-issue-mod:issue-review` or `/linear-issue-mod:issue-ship` yourself authorizes the push or merge for that one issue.
Nothing ever force-pushes or pushes the base branch directly.

Claude Code namespaces plugin commands and agents, so they appear as `/linear-issue-mod:issue-start`
(type `/issue` and pick it from the menu) and the agent as `linear-issue-mod:linear-manager`.
They don't conflict with commands or agents of the same name in your project.

### Band and pane

| Command | What it does |
| --- | --- |
| `/linear` | Open the details pane |
| `/linear ENG-123` | Pin an issue to this session, whatever the branch |
| `/linear clear` | Drop the pin and follow the branch again |
| `/linear refresh` | Re-fetch from Linear now |
| `/linear hide` / `show` | Hide or show the band |

## Options

Set from the `/config` menu or under `pluginConfigs.linear-issue-mod` in settings.

| Option | Default | Meaning |
| --- | --- | --- |
| `linearApiKey` | — | Linear API key (secret) |
| `teamKeys` | *(auto)* | Comma-separated team keys to find in branch names. Left empty: `teamKey` from `.claude/linear.json`, else your workspace's keys fetched from Linear. |
| `registryFile` | `sites.json` | Sub-project registry used for scope and drift. If the file is missing, those features are off. |
| `pinCommand` | `issue-start` | Slash command (without `/`) whose first argument is an issue id; running it pins that issue to the session. Empty disables it. |
| `pollMinutes` | `5` | How often the issue is refreshed |
| `showOtherSessions` | `true` | Share this session's issue with your other sessions and list theirs |

### Project settings for the workflow

Optional: put a `.claude/linear.json` in your repo. Every field is optional. A missing value is
inferred, or the command asks once.

```json
{
  "team": "Engineering",
  "teamKey": "ENG",
  "project": "Website",
  "assignee": "me",
  "baseBranch": "main",
  "checks": ["npm run build", "npm test"],
  "mergeMethod": "squash",
  "deleteBranch": true
}
```

`mergeMethod` is `merge` (default), `squash`, `rebase`, or `local`. `local` merges with
`git merge --no-ff` and pushes, so your own `pre-push` hooks run. A copy of this file is in
[`linear.example.json`](linear.example.json).

### Sub-project registry

```json
{
  "sites": [
    { "key": "web", "path": "apps/web" },
    { "key": "api", "path": "services/api", "active": true }
  ]
}
```

`path` is relative to the repo root. An issue labelled `web` (or whose parent is) is scoped to
`apps/web`, so editing `services/api/...` triggers a drift toast once per issue and sub-project.
An issue with no matching label is scoped to everything.

## How the session list works

Each session writes a small JSON file to `~/.claude/linear-issue-mod/sessions/<session-id>.json` every
minute. The file holds the session's checkout path, issue id, title and state, nothing else. A
session drops off the list 3 minutes after its last update. Its file is deleted when the session
ends, and files left by a crash are cleaned up after a day. Everything stays on your machine. The
API key is never written to the file.

## Development

```
claude --plugin-dir .      # from this folder: load from source, hot-reloads on save
claude plugin validate .
claude plugin test .
```

The engine generates `.claude-plugin/types/` when the mod loads. After that, `tsc -p .`
type-checks it.

## License

MIT

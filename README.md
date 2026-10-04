# linear-issue — a Claude Code plugin

Shows the Linear issue you're working on right above the Claude Code prompt, so the issue for
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
- **Other sessions**: every Claude Code session on the machine that runs the plugin appears on the
  `also:` row, with its issue and checkout (`main` or the worktree name).
- **Conflict warnings**: a toast and a red ⚠ when another session in the *same checkout* works a
  *different* issue (you share one branch and one working tree), or when two sessions take the same issue.
- **Branch moves by other sessions don't take your issue.** If another session checks out a
  different branch in the shared checkout, your session holds its own issue (`held`). It follows
  the branch again only after your own session runs `git checkout`/`git switch`.
- **Scope drift** (optional): if your repo has a sub-project registry, issue labels that match a
  sub-project key define the issue's scope. Editing files outside that scope raises a toast.
- A toast when the issue changes state in Linear.

## Install

```
/plugin marketplace add Sarimarcus/claude-linear-issue
/plugin install linear-issue@claude-linear-issue
```

Requires a Claude Code version with plugin hooks modules (`hooks/hooks.json` → `modules`).
Developed and tested on 2.1.289.

Provide a Linear personal API key (Linear → Settings → Security & access) in one of
three ways, checked in this order:

1. the plugin's **Linear API key** option (stored as a secret),
2. the `LINEAR_API_KEY` environment variable,
3. a `LINEAR_API_KEY=` line in the `.env` at your repo root.

## Commands

| Command | What it does |
| --- | --- |
| `/linear` | Open the details pane |
| `/linear ENG-123` | Pin an issue to this session, whatever the branch |
| `/linear clear` | Drop the pin and follow the branch again |
| `/linear refresh` | Re-fetch from Linear now |
| `/linear hide` / `show` | Hide or show the band |

## Options

Set from the `/config` menu or under `pluginConfigs.linear-issue` in settings.

| Option | Default | Meaning |
| --- | --- | --- |
| `linearApiKey` | — | Linear API key (secret) |
| `teamKeys` | *(auto)* | Comma-separated team keys to find in branch names. Left empty, your workspace's keys are fetched from Linear. |
| `registryFile` | `sites.json` | Sub-project registry used for scope and drift. If the file is missing, those features are off. |
| `pinCommand` | — | One of your slash commands (without `/`) whose first argument is an issue id, e.g. `issue-start`. Running it pins that issue. |
| `pollMinutes` | `5` | How often the issue is refreshed |
| `showOtherSessions` | `true` | Share this session's issue with your other sessions and list theirs |

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

Each session writes a small JSON file to `~/.claude/linear-issue/sessions/<session-id>.json` every
minute. The file holds the session's checkout path, issue id, title and state, nothing else. A
session drops off the list 3 minutes after its last update. Its file is deleted when the session
ends, and files left by a crash are cleaned up after a day. Everything stays on your machine. The
API key is never written to the file.

## Development

```
claude --plugin-dir ./plugins/linear-issue      # load from source, hot-reloads on save
claude plugin validate ./plugins/linear-issue
claude plugin test ./plugins/linear-issue
```

The engine generates `plugins/linear-issue/.claude-plugin/types/` when the plugin loads. After
that, `tsc -p plugins/linear-issue` type-checks the plugin.

## License

MIT

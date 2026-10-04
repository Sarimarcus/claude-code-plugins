# Claude Code plugins

Plugins and mods for [Claude Code](https://claude.com/claude-code) by Olivier Depiesse.

## Install

Add the marketplace once:

```
/plugin marketplace add Sarimarcus/claude-code-plugins
```

Then install any plugin with `/plugin install <name>@sarimarcus`.

## Plugins

| Plugin | Kind | What it does |
| --- | --- | --- |
| [linear-workflow](plugins/linear-workflow) | skills + CLI + agent + mod | Linear workflow: `issue-*` skills from cycle to merged PR, backed by a deterministic CLI, a `linear-manager` agent, and a mod showing the current issue, your other sessions and conflict warnings |

## Layout

Each plugin lives in `plugins/<name>/` with its own README and CHANGELOG, and has an entry in
`.claude-plugin/marketplace.json`.

## License

MIT

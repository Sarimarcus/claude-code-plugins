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
| [linear-workflow](plugins/linear-workflow) | commands + agent + mod | Linear workflow: `/issue-*` commands from cycle to merged PR, a `linear-manager` agent, and a mod showing the current issue, your other sessions and conflict warnings |

## Layout

Each plugin lives in `plugins/<name>/` with its own README, and has an entry in
`.claude-plugin/marketplace.json`.

## License

MIT

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
| [linear-issue-mod](plugins/linear-issue-mod) | mod + commands + agent | Linear in Claude Code: the current issue above the prompt, your other sessions and conflict warnings, and `/issue-*` commands from start to merged PR |

## Layout

Each plugin lives in `plugins/<name>/` with its own README, and has an entry in
`.claude-plugin/marketplace.json`.

## License

MIT

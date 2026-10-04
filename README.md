# Claude Code plugins

Plugins for [Claude Code](https://claude.com/claude-code) by Olivier Depiesse.

## Install

Add the marketplace once:

```
/plugin marketplace add Sarimarcus/claude-code-plugins
```

Then install any plugin with `/plugin install <name>@sarimarcus`.

## Plugins

| Plugin | What it does |
| --- | --- |
| [linear-issue](plugins/linear-issue) | Shows the Linear issue behind your current git branch above the prompt, lists your other Claude Code sessions and their issues, and warns about conflicts and scope drift |

## Layout

Each plugin lives in `plugins/<name>/` with its own README, and has an entry in
`.claude-plugin/marketplace.json`.

## License

MIT

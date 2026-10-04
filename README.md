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

Dev tooling (`package.json`: TypeScript, type-check, test and eval scripts) sits at the repo root,
outside every plugin, so installing a plugin never pulls it in.

## Releasing

Each plugin is versioned on its own; tags look like `<plugin>-v<version>`.

1. Write the changes under `## Unreleased` in the plugin's `CHANGELOG.md`.
2. `npm run release -- linear-workflow 0.2.0` sets the version in `plugin.json` and
   `marketplace.json`, and dates the CHANGELOG section.
3. `npm test && npm run eval` (commit the refreshed `evals/RESULTS.md`).
4. Commit, then `git tag linear-workflow-v0.2.0 && git push && git push origin linear-workflow-v0.2.0`.

The **Release** workflow then checks that the tag, both manifests and the CHANGELOG agree
(`scripts/release-check.mjs`), and creates a GitHub Release with that version's notes and the plugin
as a `.tar.gz`. **CI** validates the marketplace and every plugin, type-checks, runs the unit tests and
the same release check on pushes to `main` and on pull requests. The Release workflow runs those
checks again on the tagged commit before publishing, and marks `-rc`-style versions as prereleases.

Users only receive an update when the version changes: `claude plugin update` compares versions, so
a push without a version bump never reaches existing installs.

## License

MIT

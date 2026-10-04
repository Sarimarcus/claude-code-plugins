#!/usr/bin/env node
// Prepares a release: sets the version in the plugin manifest and the marketplace entry, and turns the
// CHANGELOG's "## Unreleased" heading into "## <version> — <date>". Usage: release.mjs <plugin> <version>
// It never commits, tags or pushes; it prints those steps.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [plugin, version] = process.argv.slice(2)
const fail = msg => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
if (!plugin || !/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version ?? '')) fail('Usage: release.mjs <plugin> <version>, e.g. release.mjs linear-workflow 0.2.0')

const dir = join(root, 'plugins', plugin)
const manifestPath = join(dir, '.claude-plugin', 'plugin.json')
if (!existsSync(manifestPath)) fail(`No plugin "${plugin}"`)

// Check everything before writing anything, so a failure never leaves a half-bumped release.
const changelogPath = join(dir, 'CHANGELOG.md')
const changelog = readFileSync(changelogPath, 'utf8')
const today = new Date().toISOString().slice(0, 10)
const updated = changelog.replace(/^## Unreleased[ \t]*$/im, `## ${version} — ${today}`)
if (updated === changelog && !new RegExp(`^## ${version.replace(/[.]/g, '\\.')}\\b`, 'm').test(changelog)) {
  fail('CHANGELOG.md has neither a "## Unreleased" section nor one for this version: write the notes first')
}
const marketplacePath = join(root, '.claude-plugin', 'marketplace.json')
const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8'))
const entry = marketplace.plugins.find(p => p.name === plugin)
if (!entry) fail(`marketplace.json has no entry for ${plugin}`)

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const previous = manifest.version
manifest.version = version
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

entry.version = version
writeFileSync(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`)
writeFileSync(changelogPath, updated)

const tag = `${plugin}-v${version}`
console.log(`✓ ${plugin}: ${previous} → ${version} in plugin.json, marketplace.json and CHANGELOG.md

Next:
  npm test && npm run eval            # evals/RESULTS.md for this version
  node scripts/release-check.mjs ${tag}
  git add -A plugins/${plugin} .claude-plugin/marketplace.json
  git commit -m "Release ${tag}"
  git tag ${tag}
  git push && git push origin ${tag}  # the release workflow creates the GitHub Release`)

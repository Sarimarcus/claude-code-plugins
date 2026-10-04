#!/usr/bin/env node
// Checks that a release tag, the plugin manifest, the marketplace entry and the CHANGELOG agree, and
// prints that version's release notes. Usage: release-check.mjs <tag> [--notes-out FILE]
// Tags look like `<plugin>-v<version>`, e.g. linear-workflow-v0.1.0. Exit 1 on any mismatch.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [tag, flag, notesOut] = process.argv.slice(2)
const fail = msg => {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

const m = /^(.+)-v(\d+\.\d+\.\d+(?:-[\w.]+)?)$/.exec(tag ?? '')
if (!m) fail(`Tag must look like <plugin>-v<version> (got "${tag ?? ''}")`)
const [, plugin, version] = m

const manifestPath = join(root, 'plugins', plugin, '.claude-plugin', 'plugin.json')
if (!existsSync(manifestPath)) fail(`No plugin "${plugin}" (expected ${manifestPath})`)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const marketplace = JSON.parse(readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8'))
const entry = marketplace.plugins.find(p => p.name === plugin)

const problems = []
if (manifest.version !== version) problems.push(`plugin.json version is ${manifest.version}, tag says ${version}`)
if (!entry) problems.push(`marketplace.json has no entry for ${plugin}`)
else if (entry.version && entry.version !== version) problems.push(`marketplace.json version is ${entry.version}, tag says ${version}`)

// The version lives in the manifests and the CHANGELOG only; a number in the README's Version section drifts.
const readme = readFileSync(join(root, 'plugins', plugin, 'README.md'), 'utf8')
const versionSection = /^## Version\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readme)?.[1] ?? ''
if (/\d+\.\d+\.\d+/.test(versionSection)) problems.push('README.md "Version" section hard-codes a version: link to the CHANGELOG instead')

const changelog = readFileSync(join(root, 'plugins', plugin, 'CHANGELOG.md'), 'utf8')
const heading = new RegExp(`^## ${version.replace(/[.]/g, '\\.')}\\b.*$`, 'm')
const start = changelog.search(heading)
let notes = ''
if (start === -1) problems.push(`CHANGELOG.md has no "## ${version}" section`)
else {
  const rest = changelog.slice(start).split('\n')
  const end = rest.slice(1).findIndex(l => /^## /.test(l))
  notes = rest.slice(1, end === -1 ? undefined : end + 1).join('\n').trim()
  if (/unreleased/i.test(rest[0])) problems.push(`CHANGELOG.md "${rest[0]}" is still marked unreleased`)
  if (!notes) problems.push(`CHANGELOG.md "## ${version}" section is empty`)
}

if (problems.length) fail(`${tag}: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`)
if (flag === '--notes-out' && notesOut) writeFileSync(notesOut, `${notes}\n`)
else console.log(notes)
console.error(`✓ ${tag}: plugin.json, marketplace.json and CHANGELOG agree on ${version}`)

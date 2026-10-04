#!/usr/bin/env node
// Entry point: older Node cannot load the TypeScript CLI at all, so check here first.
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 18)) {
  process.stdout.write(`${JSON.stringify({ error: `Node.js 22.18 or later is required (found ${process.versions.node})` })}\n`)
  process.stderr.write(`✗ linear-workflow needs Node.js 22.18 or later (found ${process.versions.node})\n`)
  process.exit(1)
}
await import('./linear-workflow.ts')

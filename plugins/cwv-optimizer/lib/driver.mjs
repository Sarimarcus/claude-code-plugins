import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLI_VERSION } from './config.mjs';

const NPX = ['-y', '-p', `chrome-devtools-mcp@${CLI_VERSION}`];
let binCache;

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts });
}

const onPath = n => run('sh', ['-c', `command -v ${n}`]).stdout.trim();

function chromeBinary() {
  const env = process.env.CHROME_PATH;
  const found = [env, ...['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome']
    .map(onPath)]
    .filter(Boolean);
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter(x => /^chromium-\d+$/.test(x)).sort().reverse()) {
      found.push(path.join(pw, d, 'chrome-linux64', 'chrome'));
    }
  }
  return found.find(f => f && fs.existsSync(f)) || null;
}

/** Everything the runner needs, checked up front. Never installs anything: it says what to run. */
export function preflight(root) {
  const problems = [];
  const npx = run('npx', ['--version']);
  if (npx.status !== 0) {
    problems.push({ what: '`npx` is not available', fix: 'Install Node.js 22 or newer (https://nodejs.org), which ships npx.' });
  } else {
    const probe = run('npx', [...NPX, 'chrome-devtools', '--version'], { timeout: 180000 });
    if (probe.status !== 0) {
      problems.push({
        what: `the chrome-devtools CLI (chrome-devtools-mcp@${CLI_VERSION}) cannot start`,
        fix: `Run: npm i -g chrome-devtools-mcp@${CLI_VERSION}   (check network access to the npm registry, then re-run)`,
      });
    }
  }
  if (!chromeBinary()) {
    problems.push({
      what: 'no Chrome or Chromium binary found',
      fix: 'Install Google Chrome (or Chromium), or point CHROME_PATH at the binary. On Linux: sudo apt install chromium',
    });
  }
  const git = run('git', ['-C', root, 'rev-parse', '--show-toplevel']);
  if (git.status !== 0) {
    problems.push({ what: `${root} is not inside a git repository`, fix: 'Run from a git repo: reverts of rejected fixes rely on git.' });
  }
  return problems;
}

export function printPreflight(problems) {
  const lines = ['cwv: cannot run, missing prerequisites:', ''];
  for (const p of problems) lines.push(`  ✗ ${p.what}`, `      → ${p.fix}`, '');
  return lines.join('\n');
}

function resolveBin() {
  if (binCache !== undefined) return binCache;
  const r = run('npx', [...NPX, 'sh', '-c', 'readlink -f "$(command -v chrome-devtools)"'], { timeout: 180000 });
  const p = (r.stdout || '').trim().split('\n').pop();
  binCache = p && fs.existsSync(p) ? p : null;
  return binCache;
}

function cli(args, { timeout = 240000, text = false } = {}) {
  const bin = resolveBin();
  const full = text ? args : [...args, '--output-format', 'json'];
  const r = bin ? run('node', [bin, ...full], { timeout }) : run('npx', [...NPX, 'chrome-devtools', ...full], { timeout });
  const out = (r.stdout || '').trim();
  if (text) {
    if (r.status !== 0) throw new Error(`chrome-devtools ${args[0]} failed: ${(r.stderr || out).slice(0, 400)}`);
    return { json: null, text: out };
  }
  const start = out.indexOf('{');
  let json = null;
  if (start >= 0) {
    try { json = JSON.parse(out.slice(start, out.lastIndexOf('}') + 1)); } catch { json = null; }
  }
  if (r.status !== 0 && !json) throw new Error(`chrome-devtools ${args[0]} failed: ${(r.stderr || out).slice(0, 400)}`);
  return { json, text: out };
}

/** One isolated browser tab with mobile emulation, reused for every trace of a run. */
export class Session {
  constructor(profile) {
    this.profile = profile;
    this.pageId = null;
  }

  open() {
    // The CLI launches stable Google Chrome by default: anything else is passed to the daemon explicitly.
    const stable = ['google-chrome', 'google-chrome-stable'].some(n => onPath(n));
    if (!stable || process.env.CHROME_PATH) {
      const bin = chromeBinary();
      if (bin) cli(['start', '--headless=true', '--executablePath', bin], { text: true });
    }
    const ctx = `cwv-${process.pid}-${Date.now()}`;
    const r = cli(['new_page', 'about:blank', '--isolatedContext', ctx]);
    const pages = r.json?.pages || [];
    const mine = pages.find(p => p.isolatedContext === ctx) || pages[pages.length - 1];
    if (!mine) throw new Error('chrome-devtools did not return the new page');
    this.pageId = mine.id;
    const p = this.profile;
    cli(['emulate', String(this.pageId),
      '--cpuThrottlingRate', String(p.cpuThrottlingRate),
      '--networkConditions', p.networkConditions,
      '--viewport', p.viewport]);
    return this;
  }

  /** Cold, throttled load of `url`; saves the raw trace and returns the DevTools summary text. */
  trace(url, traceFile) {
    fs.mkdirSync(path.dirname(traceFile), { recursive: true });
    cli(['navigate_page', String(this.pageId), '--url', url]);
    const r = cli(['performance_start_trace', String(this.pageId), '--reload', 'true', '--autoStop', 'true',
      '--ignoreCache', 'true', '--filePath', traceFile]);
    const summary = r.json?.traceSummary;
    if (!summary) throw new Error(`no trace summary for ${url}`);
    return summary;
  }

  insight(setId, name) {
    const r = cli(['performance_analyze_insight', String(this.pageId), setId, name], { text: true });
    const at = r.text.indexOf('## Insight Title');
    return at >= 0 ? r.text.slice(at) : r.text;
  }

  close() {
    if (this.pageId == null) return;
    try { cli(['close_page', String(this.pageId)]); } catch { /* tab already gone */ }
    this.pageId = null;
  }
}

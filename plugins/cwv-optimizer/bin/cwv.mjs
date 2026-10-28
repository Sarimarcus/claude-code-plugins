#!/usr/bin/env node
// cwv — measure Core Web Vitals through the chrome-devtools CLI and drive a keep-or-revert fix loop.
// Commands: preflight | measure | next | skip | verify | finish | report | clean   (see ../README.md)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PLUGIN_ROOT, loadConfig, readJson, resolveFrom } from '../lib/config.mjs';
import { Session, preflight, printPreflight } from '../lib/driver.mjs';
import { measureAll, measurePage } from '../lib/measure.mjs';
import { discoverPages } from '../lib/pages.mjs';
import { buildProposals, loadClassification } from '../lib/proposals.mjs';
import { renderFinal, renderMarkdown, renderReport } from '../lib/report.mjs';
import { serveDist, findDist } from '../lib/serve.mjs';
import { changedSince, dirtyFiles, protectedHits, revert, snapshot } from '../lib/state.mjs';
import { median } from '../lib/trace.mjs';

const OPTIONS = {
  root: { type: 'string' }, config: { type: 'string' }, 'report-dir': { type: 'string' }, target: { type: 'string' },
  profile: { type: 'string' }, max: { type: 'string' }, run: { type: 'string' }, id: { type: 'string' },
  reason: { type: 'string' }, days: { type: 'string' },
  full: { type: 'boolean' }, build: { type: 'boolean' }, fix: { type: 'boolean' }, json: { type: 'boolean' },
  'no-color': { type: 'boolean' }, 'keep-artifacts': { type: 'boolean' },
};

let parsed;
try {
  parsed = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true, strict: true });
} catch (e) {
  process.stderr.write(`cwv: ${e.message}\n`);
  process.exit(2);
}
const [command] = parsed.positionals;
const opts = parsed.values;

const log = m => process.stderr.write(`${m}\n`);
const die = (m, code = 2) => { log(`cwv: ${m}`); process.exit(code); };
class CwvError extends Error {}
const useColor = () => !opts['no-color'] && !process.env.NO_COLOR && process.stdout.isTTY;
const today = () => new Date().toISOString().slice(0, 10);
const rel = (root, f) => path.relative(root, f).split(path.sep).join('/');

function setup() {
  const given = path.resolve(opts.root || process.cwd());
  if (!fs.existsSync(given)) die(`--root ${given} does not exist`);
  const root = fs.realpathSync(given);
  const overrides = {};
  if (opts.max != null) {
    const max = Number(opts.max);
    if (!Number.isInteger(max) || max < 1) die(`--max must be a positive integer, got "${opts.max}"`);
    overrides.fix = { maxFixes: max };
  }
  const config = loadConfig({ root, configPath: opts.config, overrides });
  const target = opts.target || config.target || path.basename(root);
  const runsDir = resolveFrom(config, config.runsDir);
  const reportDir = opts['report-dir'] ? path.resolve(opts['report-dir']) : resolveFrom(config, config.reportDir);
  return { root, config, target, runsDir, reportDir };
}

function problemsOrDie(root) {
  const problems = preflight(root);
  if (problems.length) {
    process.stderr.write(`${printPreflight(problems)}\n`);
    process.exit(2);
  }
}

function build(root, config) {
  log(`cwv: building (${config.build.command})`);
  const r = spawnSync(config.build.command, { cwd: root, shell: true, stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new CwvError(`build failed: ${config.build.command}`);
}

function distOrDie(root, config) {
  const dist = findDist(root, config.build.distDir);
  if (!dist) throw new CwvError(`no build output found under ${root} (looked for dist, build, out, .output/public with an index.html). Build the site, pass --build, or set build.distDir in cwv.config.json.`);
  return dist;
}

function profileNames(config) {
  const sel = opts.profile || config.defaultProfile;
  const names = sel === 'both' ? Object.keys(config.profiles) : [sel];
  for (const n of names) if (!config.profiles[n]) die(`unknown profile "${n}" (available: ${Object.keys(config.profiles).join(', ')}, both)`);
  return names;
}
const forProfile = (config, name) => ({ ...config, profileName: name, profile: config.profiles[name] });

const ignoreList = ({ root, runsDir, reportDir }, dist) => [runsDir, reportDir, dist, path.join(root, 'node_modules'), path.join(root, '.astro')];

const runFile = dir => path.join(dir, 'run.json');
const loadRun = () => {
  if (!opts.run) die('--run <dir> is required');
  const dir = path.resolve(opts.run);
  if (!fs.existsSync(runFile(dir))) die(`no run found at ${dir}`);
  return { dir, run: readJson(runFile(dir)) };
};
const saveRun = (dir, run) => fs.writeFileSync(runFile(dir), JSON.stringify(run, null, 2));

async function withBrowser(dist, config, fn) {
  const server = await serveDist(dist);
  const session = new Session(config.profile);
  try {
    session.open();
    return await fn(session, server.origin);
  } finally {
    session.close();
    await server.close();
  }
}

function printOut(text) {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function cleanArtifacts(dir) {
  for (const d of ['traces', 'insights', 'snapshot']) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------------

async function cmdMeasure() {
  const ctx = setup();
  const { root, config } = ctx;
  problemsOrDie(root);
  if (opts.build || opts.fix) build(root, config);
  let dist = findDist(root, config.build.distDir);
  if (!dist) { build(root, config); dist = distOrDie(root, config); }

  if (opts.fix) {
    const dirty = dirtyFiles(root, ignoreList(ctx, dist));
    if (dirty.length) {
      die(`refusing to start a fix run: ${dirty.length} uncommitted file(s) under ${root}, so a rejected fix could not be undone cleanly:\n${dirty.slice(0, 8).map(f => `  ${rel(root, f)}`).join('\n')}\nCommit or stash them first.`);
    }
  }

  const names = profileNames(config);
  if (opts.fix && names.length > 1) die('--fix works on one profile at a time: pass --profile mobile or --profile desktop');
  const classification = loadClassification(config);
  const pages = discoverPages(dist, { full: opts.full, maxPages: config.pages.maxPages, include: config.pages.include });
  const date = today();
  let anyFail = false;
  let lastRun = null;

  for (const name of names) {
    const pc = forProfile(config, name);
    const runDir = path.join(ctx.runsDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${name}`);
    fs.mkdirSync(runDir, { recursive: true });
    log(`cwv: ${name}: ${pages.length} page(s) to trace`);
    const { results, proposals, origin } = await withBrowser(dist, pc, async (session, origin) => {
      const results = measureAll({ session, origin, pages, config: pc, runDir, classification, log });
      return { results, proposals: buildProposals(results, pc, origin, classification), origin };
    });

    const view = { target: ctx.target, config: pc, date, pages: results, proposals };
    fs.writeFileSync(path.join(runDir, 'report.txt'), renderReport(view, { color: false }));
    const current = Object.fromEntries(results.map(p => [p.path, { lcpMs: p.lcpMs, cls: p.cls }]));
    saveRun(runDir, {
      root, target: ctx.target, date, distDir: dist, origin, mode: opts.fix ? 'fix' : 'measure', profileName: name,
      pages, baseline: results, current, proposals, fixLog: [], consecutiveReverts: 0, active: null,
      needsRebuild: false, reportDir: ctx.reportDir, runsDir: ctx.runsDir, config: pc,
    });
    if (opts.json) printOut(JSON.stringify({ profile: name, runDir, summary: results.map(p => ({ path: p.path, lcpMs: p.lcpMs, cls: p.cls, status: p.status })), proposals }, null, 2));
    else printOut(renderReport(view, { color: useColor() }));
    if (!opts.fix && !opts['keep-artifacts']) fs.rmSync(runDir, { recursive: true, force: true });
    else lastRun = runDir;
    anyFail = anyFail || results.some(p => p.status === 'fail');
  }
  if (lastRun) log(`cwv: run ${lastRun}`);
  else try { fs.rmdirSync(ctx.runsDir); } catch { /* other runs remain */ }
  process.exit(anyFail ? 1 : 0);
}

function cmdNext() {
  const { dir, run } = loadRun();
  const cfg = run.config;
  const stop = reason => { printOut(JSON.stringify({ stop: reason })); process.exit(0); };
  const done = run.fixLog.filter(f => f.status === 'kept' || f.status === 'reverted' || f.status === 'vetoed').length;
  if (cfg.fix.maxFixes != null && done >= cfg.fix.maxFixes) stop(`reached the fix limit (${cfg.fix.maxFixes})`);
  if (run.consecutiveReverts >= cfg.fix.maxConsecutiveReverts) stop(`${run.consecutiveReverts} consecutive reverts: the remaining proposals are not paying off`);
  if (run.active) die(`proposal ${run.active} is still active: run \`verify\` or \`skip\` first`);
  const p = run.proposals.fixes.find(f => f.status === 'pending');
  if (!p) stop('no proposals left');

  run.manifest = snapshot(dirtyFiles(run.root, ignoreList(run, run.distDir)), path.join(dir, 'snapshot'));
  p.status = 'active';
  run.active = p.id;
  saveRun(dir, run);
  printOut(JSON.stringify({
    id: p.id, insight: p.insight, fix: p.fix, cls: p.cls, estimateMs: p.estimateMs, pages: p.pages, evidence: p.evidence,
    recipes: [path.join(PLUGIN_ROOT, 'recipes', 'default.md'), ...(cfg.recipes || []).map(r => resolveFrom(cfg, r))],
    protectedGlobs: cfg.protectedGlobs,
    root: run.root,
  }, null, 2));
}

function cmdSkip() {
  const { dir, run } = loadRun();
  const p = run.proposals.fixes.find(f => f.id === opts.id);
  if (!p) die(`unknown proposal ${opts.id}`);
  let files = [];
  let leftUntracked = [];
  if (run.active === p.id) {
    const changed = changedSince(run.root, ignoreList(run, run.distDir), run.manifest);
    const left = revert(run.root, changed, run.manifest, path.join(dir, 'snapshot'));
    leftUntracked = left.map(f => rel(run.root, f));
    files = changed.filter(f => !left.includes(f)).map(f => rel(run.root, f));
    run.active = null;
    run.needsRebuild = run.needsRebuild || files.length > 0;
  }
  p.status = 'skipped';
  p.note = opts.reason || 'skipped';
  run.fixLog.push({ id: p.id, insight: p.insight, fix: p.fix, status: 'skipped', estimateMs: p.estimateMs, gainMs: null, files: [], note: p.note });
  saveRun(dir, run);
  printOut(JSON.stringify({ id: p.id, status: 'skipped', revertedFiles: files, leftUntracked }));
}

async function cmdVerify() {
  const { dir, run } = loadRun();
  const cfg = run.config;
  const th = cfg.thresholds;
  const p = run.proposals.fixes.find(f => f.id === run.active);
  if (!p) die('no active proposal: run `next` first');
  const root = run.root;
  const ignore = ignoreList(run, run.distDir);
  const snapDir = path.join(dir, 'snapshot');
  const changed = changedSince(root, ignore, run.manifest);
  const result = { id: p.id, files: changed.map(f => rel(root, f)) };
  const finish = (status, note, gainMs = null, extra = {}) => {
    p.status = status;
    run.active = null;
    run.fixLog.push({ id: p.id, insight: p.insight, fix: p.fix, status: status === 'noop' ? 'skipped' : status, estimateMs: p.estimateMs, gainMs, files: result.files, note });
    run.consecutiveReverts = status === 'kept' ? 0 : status === 'noop' ? run.consecutiveReverts : run.consecutiveReverts + 1;
    saveRun(dir, run);
    printOut(JSON.stringify({ ...result, ...extra, status, gainMs, note }, null, 2));
    process.exit(0);
  };
  const undo = () => {
    const left = revert(root, changed, run.manifest, snapDir);
    run.needsRebuild = true;
    return { leftUntracked: left.map(f => rel(root, f)) };
  };

  if (changed.length === 0) finish('noop', 'no files changed');
  const bad = protectedHits(root, changed, cfg.protectedGlobs);
  if (bad.length) finish('vetoed', `protected path edited: ${bad.map(f => rel(root, f)).join(', ')}`, null, undo());

  let fresh;
  try {
    build(root, cfg);
    const affected = run.baseline.filter(b => p.pages.includes(b.path)).sort((a, b) => b.lcpMs - a.lcpMs).slice(0, 6);
    const dist = distOrDie(root, cfg);
    fresh = await withBrowser(dist, cfg, (session, origin) => {
      const tdir = path.join(dir, 'traces');
      return affected.map(b => {
        log(`  verifying ${b.path}`);
        return measurePage(session, origin, { path: b.path, template: b.template }, cfg.traces.confirm, tdir, `v${p.id}`);
      });
    });
  } catch (e) {
    finish('reverted', `the edit broke the build or the trace: ${String(e.message).split('\n')[0].slice(0, 160)}`, null, undo());
  }

  const gains = [];
  let clsFixed = false;
  let clsGain = 0;
  let clsBroken = false;
  for (const f of fresh) {
    const cur = run.current[f.path];
    gains.push(cur.lcpMs - f.lcpMs);
    clsGain = Math.max(clsGain, cur.cls - f.cls);
    if (cur.cls >= th.clsMax && f.cls < th.clsMax) clsFixed = true;
    if (f.cls >= th.clsMax && f.cls - cur.cls > th.keepMinClsGain) clsBroken = true;
  }
  const medianGain = median(gains) ?? 0;
  const worsened = gains.some(g => g < -th.keepMinGainMs);
  const clsBetter = clsFixed || (p.cls && clsGain >= th.keepMinClsGain);
  const keep = !worsened && !clsBroken && (medianGain >= th.keepMinGainMs || clsBetter);
  result.pagesMeasured = fresh.length;

  if (keep) {
    for (const f of fresh) run.current[f.path] = { lcpMs: f.lcpMs, cls: f.cls };
    finish('kept', clsBetter ? 'CLS improved' : '', medianGain);
  }
  finish('reverted', worsened ? 'LCP got worse on a page' : clsBroken ? 'CLS got worse' : `gain ${medianGain} ms is under ${th.keepMinGainMs} ms`, medianGain, undo());
}

async function cmdFinish() {
  const { dir, run } = loadRun();
  const cfg = run.config;
  const root = run.root;
  if (run.active) die(`proposal ${run.active} is still active: run \`verify\` or \`skip\` first`);
  const kept = run.fixLog.some(f => f.status === 'kept');
  let after = run.baseline;
  // A kept fix may sit in a shared layout, so every page is measured again; with nothing kept the tree equals the baseline.
  if (kept || run.needsRebuild) build(root, cfg);
  if (kept) {
    const dist = distOrDie(root, cfg);
    const classification = loadClassification(cfg);
    after = await withBrowser(dist, cfg, (session, origin) => measureAll({
      session, origin, pages: run.pages, config: cfg, runDir: dir, classification, log, withDetails: false,
    }));
  }
  const proposals = { fixes: run.proposals.fixes.filter(f => f.status === 'pending' || f.status === 'skipped'), flags: run.proposals.flags };
  const view = { target: run.target, config: cfg, date: run.date, before: run.baseline, after, fixLog: run.fixLog, proposals };

  fs.mkdirSync(run.reportDir, { recursive: true });
  let file = path.join(run.reportDir, `improvements-${run.date}-${run.profileName}.md`);
  for (let n = 2; fs.existsSync(file); n++) file = path.join(run.reportDir, `improvements-${run.date}-${run.profileName}-${n}.md`);
  fs.writeFileSync(file, renderMarkdown(view));

  const hist = path.join(run.reportDir, 'history.json');
  const history = fs.existsSync(hist) ? readJson(hist) : { target: run.target, runs: [] };
  const summarize = ps => ({ pass: ps.filter(p => p.status === 'pass').length, risk: ps.filter(p => p.status === 'risk').length, fail: ps.filter(p => p.status === 'fail').length, medianLcpMs: median(ps.map(p => p.lcpMs)), pages: ps.length });
  history.runs.push({
    date: run.date,
    profile: run.profileName,
    thresholds: cfg.thresholds,
    before: summarize(run.baseline),
    after: summarize(after),
    fixes: run.fixLog.map(f => ({ insight: f.insight, fix: f.fix, status: f.status, estimateMs: f.estimateMs, gainMs: f.gainMs })),
  });
  fs.writeFileSync(hist, `${JSON.stringify(history, null, 2)}\n`);

  printOut(renderFinal(view, { color: useColor() }));
  log(`cwv: wrote ${file} and ${hist}`);
  if (!opts['keep-artifacts']) {
    fs.rmSync(dir, { recursive: true, force: true });
    try { fs.rmdirSync(path.dirname(dir)); } catch { /* other runs remain */ }
  }
  process.exit(after.some(p => p.status === 'fail') ? 1 : 0);
}

function cmdReport() {
  const { dir } = loadRun();
  printOut(fs.readFileSync(path.join(dir, 'report.txt'), 'utf8'));
}

function cmdClean() {
  const { runsDir } = setup();
  if (!fs.existsSync(runsDir)) return log('cwv: nothing to clean');
  const days = opts.days == null ? 0 : Number(opts.days);
  if (!Number.isFinite(days) || days < 0) die(`--days must be a number of days, got "${opts.days}"`);
  const cutoff = Date.now() - days * 864e5;
  let n = 0;
  for (const d of fs.readdirSync(runsDir)) {
    const p = path.join(runsDir, d);
    const live = fs.existsSync(runFile(p)) && readJson(runFile(p)).active;
    if (live) { log(`cwv: kept ${d}: a proposal is still active`); continue; }
    if (fs.statSync(p).mtimeMs <= cutoff) { fs.rmSync(p, { recursive: true, force: true }); n++; }
  }
  log(`cwv: removed ${n} run folder(s) from ${runsDir}`);
}

function cmdPreflight() {
  problemsOrDie(setup().root);
  printOut('cwv: ready (npx, chrome-devtools CLI, Chrome and git are available)');
}

const commands = { preflight: cmdPreflight, measure: cmdMeasure, next: cmdNext, skip: cmdSkip, verify: cmdVerify, finish: cmdFinish, report: cmdReport, clean: cmdClean };
if (!commands[command]) die(`usage: cwv <${Object.keys(commands).join('|')}> [--root <dir>] [--config <file>] [--full] [--fix] [--run <dir>] ... (unknown command: ${command ?? 'none'})`);
Promise.resolve(commands[command]()).catch(e => die(e instanceof CwvError ? e.message : e.stack || e.message));

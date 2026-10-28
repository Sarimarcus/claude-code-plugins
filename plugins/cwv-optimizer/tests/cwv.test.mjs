import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import zlib from 'node:zlib';
import { loadConfig } from '../lib/config.mjs';
import { measureAll, measurePage, statusOf } from '../lib/measure.mjs';
import { renderReport } from '../lib/report.mjs';
import { discoverPages } from '../lib/pages.mjs';
import { buildProposals, classifyInsight, loadClassification } from '../lib/proposals.mjs';
import { serveDist } from '../lib/serve.mjs';
import { changedSince, dirtyFiles, protectedHits, revert, snapshot } from '../lib/state.mjs';
import { clsFromTrace, median, parseSummary } from '../lib/trace.mjs';

const dirs = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cwv-test-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
const config = loadConfig({ root: tmp() });
const classification = loadClassification(config);

const SUMMARY = `## Summary of Performance trace findings:
## insight set id: NAVIGATION_0
Metrics (lab / observed):
  - LCP: 2,808 ms, event: (eventKey: r-1), nodeId: 56
  - LCP breakdown:
    - TTFB: 6 ms, bounds: {min: 1µs}
    - Load delay: 1,119 ms, bounds: {min: 1µs}
    - Load duration: 592 ms, bounds: {min: 1µs}
    - Render delay: 1,091 ms, bounds: {min: 1µs}
  - CLS: 0.00, event: (eventKey: s-1)
Available insights:
  - insight name: RenderBlocking
    estimated metric savings: FCP 625 ms, LCP 120 ms
  - insight name: LegacyJavaScript
    estimated metric savings: FCP 0 ms, LCP 0 ms
    estimated wasted bytes: 8.7 kB
`;

test('parseSummary reads LCP, breakdown and insights', () => {
  const p = parseSummary(SUMMARY);
  assert.equal(p.setId, 'NAVIGATION_0');
  assert.equal(p.lcpMs, 2808);
  assert.deepEqual(p.breakdown, { ttfb: 6, loadDelay: 1119, loadDuration: 592, renderDelay: 1091 });
  assert.equal(p.insights.length, 2);
  assert.deepEqual(p.insights[0], { name: 'RenderBlocking', lcpSavingsMs: 120, fcpSavingsMs: 625, wastedBytes: 0 });
  assert.equal(p.insights[1].wastedBytes, 8700);
});

test('clsFromTrace takes the worst session window and ignores shifts after input', () => {
  const ev = (ts, score, input = false) => ({ name: 'LayoutShift', ts, args: { data: { score, had_recent_input: input, is_main_frame: true } } });
  const events = [ev(1e6, 0.004), ev(1.5e6, 0.003), ev(9e6, 0.02), ev(9.5e6, 0.5, true)];
  const file = path.join(tmp(), 't.json.gz');
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ traceEvents: events })));
  assert.equal(clsFromTrace(file), 0.02);
  assert.equal(clsFromTrace(path.join(tmp(), 'missing.json')), null);
});

test('the gate: CLS strictly under 0.01, LCP at most 2500, 20% margin is at risk', () => {
  const th = config.thresholds;
  assert.equal(statusOf({ lcpMs: 1500, cls: 0.004 }, th), 'pass');
  assert.equal(statusOf({ lcpMs: 2100, cls: 0 }, th), 'risk');
  assert.equal(statusOf({ lcpMs: 2500, cls: 0.009 }, th), 'risk');
  assert.equal(statusOf({ lcpMs: 2501, cls: 0 }, th), 'fail');
  assert.equal(statusOf({ lcpMs: 1000, cls: 0.01 }, th), 'fail');
});

test('median of an even list takes the lower middle, nulls are dropped', () => {
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([]), null);
});

test('vetoes keep framework CSS and third-party scripts out of the fix list', () => {
  const origin = 'http://localhost:1';
  const text = urls => `allUrls = [${urls.join(', ')}]\n## External resources:\n- https://web.dev/articles/lcp`;
  const css = classifyInsight('RenderBlocking', text([`${origin}/_astro/Layout.abc.css`, `${origin}/`]), origin, `${origin}/`, classification);
  assert.deepEqual([css.class, css.flag], ['flag', 'architecture']);
  const tp = classifyInsight('RenderBlocking', text(['https://cdn.example.com/a.js']), origin, `${origin}/`, classification);
  assert.deepEqual([tp.class, tp.flag], ['flag', 'third-party-script']);
  const own = classifyInsight('RenderBlocking', text([`${origin}/app.js`]), origin, `${origin}/`, classification);
  assert.deepEqual([own.class, own.fix], ['fix', 'defer-or-async']);
});

test('proposals order: CLS first, then estimated LCP gain, then page count', () => {
  const dir = tmp();
  const detail = name => { const f = path.join(dir, `${name}.md`); fs.writeFileSync(f, 'allUrls = [http://localhost:1/app.js]'); return f; };
  const page = (p, lcpMs, cls, insights) => ({ path: p, status: 'fail', lcpMs, cls, breakdown: { loadDelay: 0, loadDuration: 0, renderDelay: 0 }, insights });
  const ins = (name, lcp) => ({ name, lcpSavingsMs: lcp, fcpSavingsMs: 0, detailFile: detail(name) });
  const pages = [
    page('/a', 4000, 0.05, [ins('RenderBlocking', 700), ins('CLSCulprits', 0), ins('LCPDiscovery', 300), ins('ImageDelivery', 900)]),
    page('/b', 3000, 0, [ins('RenderBlocking', 500)]),
  ];
  const { fixes, flags } = buildProposals(pages, config, 'http://localhost:1', classification);
  assert.deepEqual(fixes.map(f => f.insight), ['CLSCulprits', 'RenderBlocking', 'LCPDiscovery']);
  assert.equal(fixes[1].estimateMs, 600);
  assert.deepEqual(fixes[1].pages, ['/a', '/b']);
  assert.equal(flags[0].insight, 'ImageDelivery');
});

test('discoverPages: one page per template, static pages grouped, quick is the homepage only', () => {
  const dist = tmp();
  for (const f of ['index.html', 'about.html', 'privacy.html', 'monuments.html', 'monument/a.html', 'monument/b.html', '404.html']) {
    fs.mkdirSync(path.dirname(path.join(dist, f)), { recursive: true });
    fs.writeFileSync(path.join(dist, f), '<html></html>');
  }
  assert.deepEqual(discoverPages(dist, { full: false, maxPages: 40 }), [{ path: '/', template: 'home' }]);
  const t = discoverPages(dist, { full: true, maxPages: 40 }).map(p => p.template);
  assert.deepEqual(t, ['home', 'monument/*', 'monuments', 'static']);
});

test('serveDist resolves clean URLs, compresses text, caches hashed assets, serves the 404 page', async () => {
  const dist = tmp();
  fs.mkdirSync(path.join(dist, '_astro'));
  fs.writeFileSync(path.join(dist, 'index.html'), '<html>home</html>');
  fs.writeFileSync(path.join(dist, 'about.html'), `<html>${'about '.repeat(300)}</html>`);
  fs.writeFileSync(path.join(dist, '404.html'), '<html>nope</html>');
  fs.writeFileSync(path.join(dist, '_astro', 'app.abcd1234.css'), 'a{}');
  const s = await serveDist(dist);
  try {
    const about = await fetch(`${s.origin}/about`);
    assert.equal(about.status, 200);
    assert.match(about.headers.get('cache-control'), /must-revalidate/);
    assert.ok(['br', 'gzip'].includes(about.headers.get('content-encoding')));
    assert.match(await about.text(), /about about/);
    const css = await fetch(`${s.origin}/_astro/app.abcd1234.css`);
    assert.match(css.headers.get('cache-control'), /immutable/);
    const miss = await fetch(`${s.origin}/missing`);
    assert.equal(miss.status, 404);
    assert.match(await miss.text(), /nope/);
  } finally {
    await s.close();
  }
});

test('snapshot, changedSince and revert only touch what the fix changed, and never delete a new file', () => {
  const root = tmp();
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  git('init', '-q');
  fs.writeFileSync(path.join(root, 'a.txt'), 'a1');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b1');
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b-mine');
  const snap = path.join(tmp(), 'snap');
  const manifest = snapshot(dirtyFiles(root), snap);
  fs.writeFileSync(path.join(root, 'a.txt'), 'a-fix');
  fs.writeFileSync(path.join(root, 'b.txt'), 'b-fix');
  fs.writeFileSync(path.join(root, 'new.txt'), 'n');
  const changed = changedSince(root, [], manifest);
  assert.deepEqual(changed.map(f => path.basename(f)), ['a.txt', 'b.txt', 'new.txt']);
  const left = revert(root, changed, manifest, snap);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'a1');
  assert.equal(fs.readFileSync(path.join(root, 'b.txt'), 'utf8'), 'b-mine');
  assert.deepEqual(left.map(f => path.basename(f)), ['new.txt']);
  assert.equal(fs.existsSync(path.join(root, 'new.txt')), true, 'a new untracked file may be another session\'s: reported, never deleted');
});

test('protected globs match nested and root paths', () => {
  const root = '/p';
  assert.deepEqual(protectedHits(root, ['/p/package.json', '/p/src/a.astro', '/p/node_modules/x/y.js', '/p/dist/a/b.html'], config.protectedGlobs),
    ['/p/package.json', '/p/node_modules/x/y.js', '/p/dist/a/b.html']);
  assert.deepEqual(protectedHits('/p', ['/p/astro.config.mjs', '/p/src/a/layout.astro', '/p/src/layout.astro'], ['astro.config.*', 'src/**/layout.astro']),
    ['/p/astro.config.mjs', '/p/src/a/layout.astro', '/p/src/layout.astro']);
});

const CLI = path.join(import.meta.dirname, '..', 'bin', 'cwv.mjs');
const cli = (...args) => { try { return { code: 0, out: execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: 'pipe' }) }; } catch (e) { return { code: e.status, err: e.stderr }; } };

test('the CLI refuses unknown flags, a bad --max and an unknown command with exit 2', () => {
  for (const args of [['preflight', '--bogus'], ['measure', '--max', 'x'], ['nope']]) {
    const r = cli(...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, /^cwv: /);
  }
});

test('measurePage fetches each insight detail once and keeps the evidence on the largest estimate', () => {
  const dir = tmp();
  const trace = (lcp, rbLcp) => `Metrics (lab / observed):\n  - LCP: ${lcp} ms, event: (eventKey: r-1), nodeId: 1\n  - LCP breakdown:\n    - TTFB: 1 ms, bounds: {}\n    - Load delay: 1 ms, bounds: {}\n    - Load duration: 1 ms, bounds: {}\n    - Render delay: 1 ms, bounds: {}\n  - CLS: 0.00, event: (eventKey: s-1)\n## insight set id: NAVIGATION_0\nAvailable insights:\n  - insight name: RenderBlocking\n    estimated metric savings: FCP 0 ms, LCP ${rbLcp} ms\n`;
  const texts = [trace(3000, 100), trace(3100, 400), trace(3200, 200)];
  let calls = 0;
  let details = 0;
  const session = { trace: () => texts[calls++], insight: () => { details++; return 'allUrls = []'; } };
  const m = measurePage(session, 'http://x', { path: '/', template: 'home' }, 3, dir, 'm', { dir: path.join(dir, 'ins'), classification });
  assert.equal(details, 1);
  assert.equal(m.insights[0].lcpSavingsMs, 400);
  assert.ok(m.insights[0].detailFile);
});

test('report bars take their color from the gate status, CLS included', () => {
  const page = { path: '/', status: 'fail', lcpMs: 1000, cls: 0.05, breakdown: {} };
  const out = renderReport({ target: 't', date: 'd', config: { ...config, profileName: 'mobile', profile: config.profiles.mobile }, pages: [page], proposals: { fixes: [], flags: [] } }, { color: true });
  assert.match(out, /\x1b\[31m█/);
});

test('a failing page costs `confirm` traces in total: the first trace is sample one', () => {
  const dir = tmp();
  const text = `## insight set id: NAVIGATION_0\nMetrics (lab / observed):\n  - LCP: 4,000 ms, event: (eventKey: r-1), nodeId: 1\n  - CLS: 0.00, event: (eventKey: s-1)\nAvailable insights:\n`;
  let traces = 0;
  const session = { trace: () => { traces++; return text; }, insight: () => '' };
  const [m] = measureAll({ session, origin: 'http://x', pages: [{ path: '/', template: 'home' }], config, runDir: dir, classification });
  assert.equal(traces, config.traces.confirm);
  assert.equal(m.samples.length, config.traces.confirm);
  assert.equal(m.status, 'fail');
});

import fs from 'node:fs';
import path from 'node:path';
import { clsFromTrace, median, medianIndex, parseSummary } from './trace.mjs';

export function slugOf(p) {
  return p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').replace(/\//g, '__');
}

export function statusOf(m, th) {
  if (m.lcpMs > th.lcpMaxMs || m.cls >= th.clsMax) return 'fail';
  const m2 = 1 - th.atRiskMargin;
  if (m.lcpMs > th.lcpMaxMs * m2 || m.cls >= th.clsMax * m2) return 'risk';
  return 'pass';
}

const weight = x => x.lcpSavingsMs * 1000 + x.fcpSavingsMs;

/**
 * `n` more cold throttled traces of one page. With `details`, each actionable insight's detail is fetched once, from
 * the first trace that lists it (the daemon only keeps the latest trace) and written under details.dir.
 */
function collectRuns(session, origin, page, n, dir, tag, details = null) {
  const runs = [];
  const fetched = new Set();
  for (let i = 0; i < n; i++) {
    const file = path.join(dir, `${slugOf(page.path)}.${tag}${i + 1}.json.gz`);
    const parsed = parseSummary(session.trace(origin + page.path, file));
    const cls = clsFromTrace(file) ?? parsed.clsReported ?? 0;
    if (parsed.lcpMs == null) throw new Error(`no LCP in trace of ${page.path}`);
    if (details) fetchDetails(session, parsed, path.join(details.dir, slugOf(page.path)), `${tag}${i + 1}`, details.classification, fetched);
    runs.push({ ...parsed, cls });
  }
  return runs;
}

/**
 * The page's result from its traces: the trace with the median LCP represents it. DevTools lists a different set of
 * insights from one trace to the next, so insights are the union over all traces (largest estimate wins).
 */
function summarizeRuns(page, runs) {
  const sorted = [...runs].sort((a, b) => a.lcpMs - b.lcpMs);
  const rep = sorted[medianIndex(sorted.length)];
  const union = new Map();
  for (const r of runs) {
    for (const ins of r.insights) {
      const cur = union.get(ins.name);
      const best = !cur || weight(ins) > weight(cur) ? ins : cur;
      union.set(ins.name, { ...best, detailFile: best.detailFile ?? ins.detailFile ?? cur?.detailFile });
    }
  }
  return {
    path: page.path,
    template: page.template,
    lcpMs: rep.lcpMs,
    cls: median(runs.map(r => r.cls)),
    breakdown: rep.breakdown,
    setId: rep.setId,
    insights: [...union.values()],
    samples: runs.map(r => ({ lcpMs: r.lcpMs, cls: r.cls })),
    spreadMs: sorted[sorted.length - 1].lcpMs - sorted[0].lcpMs,
  };
}

export function measurePage(session, origin, page, n, dir, tag = 'm', details = null) {
  return summarizeRuns(page, collectRuns(session, origin, page, n, dir, tag, details));
}

/**
 * Measure every page once, then re-measure the failing and at-risk ones `confirm` times (with insight details),
 * so every proposal rests on the median of several traces.
 */
export function measureAll({ session, origin, pages, config, runDir, classification, log = () => {}, withDetails = true }) {
  const th = config.thresholds;
  const tdir = path.join(runDir, 'traces');
  const results = [];
  for (const page of pages) {
    log(`  tracing ${page.path}`);
    const runs = collectRuns(session, origin, page, config.traces.initial, tdir, 'a');
    let m = summarizeRuns(page, runs);
    m.status = statusOf(m, th);
    if (m.status !== 'pass') {
      log(`  re-tracing ${page.path} (${m.status})`);
      const more = Math.max(config.traces.confirm - runs.length, 1);
      runs.push(...collectRuns(session, origin, page, more, tdir, 'b', withDetails ? { dir: path.join(runDir, 'insights'), classification } : null));
      m = summarizeRuns(page, runs);
      m.status = statusOf(m, th);
    }
    results.push(m);
  }
  return results;
}

function fetchDetails(session, parsed, dir, tag, classification, fetched) {
  fs.mkdirSync(dir, { recursive: true });
  for (const ins of parsed.insights) {
    const base = classification.insights[ins.name];
    if (!base || base.class !== 'fix' || fetched.has(ins.name)) continue;
    fetched.add(ins.name);
    const file = path.join(dir, `${ins.name}.${tag}.md`);
    fs.writeFileSync(file, session.insight(parsed.setId, ins.name));
    ins.detailFile = file;
  }
}

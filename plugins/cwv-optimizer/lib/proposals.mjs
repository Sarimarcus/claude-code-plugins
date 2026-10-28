import fs from 'node:fs';
import path from 'node:path';
import { PLUGIN_ROOT, deepMerge, readJson, resolveFrom } from './config.mjs';

export function loadClassification(config) {
  const base = readJson(path.join(PLUGIN_ROOT, 'data', 'classification.json'));
  if (!config.classification) return base;
  const extra = readJson(resolveFrom(config, config.classification));
  const merged = deepMerge({ ...base, vetoes: [] }, { ...extra, vetoes: [] });
  merged.vetoes = [...(extra.vetoes || []), ...base.vetoes];
  return merged;
}

function urlsIn(text, pageUrl) {
  text = text.split('## External resources')[0];
  const urls = [...new Set(text.match(/https?:\/\/[^\s,\]\)"'<>]+/g) || [])];
  return urls.filter(u => u.replace(/\/$/, '') !== pageUrl.replace(/\/$/, ''));
}

/** Class of one insight on one page, after the data-driven vetoes. */
export function classifyInsight(name, detailText, origin, pageUrl, classification) {
  const base = classification.insights[name] || { class: 'flag', flag: 'unclassified' };
  if (base.class !== 'fix' || !detailText) return { ...base };
  const urls = urlsIn(detailText, pageUrl);
  for (const v of classification.vetoes) {
    if (v.insight !== name && v.insight !== '*') continue;
    if (urls.length === 0) continue;
    const hit = v.when === 'allThirdParty'
      ? urls.every(u => { try { return new URL(u).origin !== origin; } catch { return false; } })
      : v.when === 'allUrlsMatch' && urls.every(u => new RegExp(v.pattern).test(u));
    if (hit) return { ...v.becomes, vetoedFrom: base.fix, reason: v.reason };
  }
  return { ...base };
}

function dominantSubpart(b) {
  const parts = ['loadDelay', 'loadDuration', 'renderDelay'].map(k => [k, b[k] || 0]).sort((a, c) => c[1] - a[1]);
  return parts[0][1] > 0 ? parts[0] : null;
}

const mean = xs => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

/**
 * Group what the failing and at-risk pages share into proposals. Order: CLS culprits first (CLS must stay
 * under its limit), then estimated LCP gain, then number of pages affected.
 */
export function buildProposals(pages, config, origin, classification) {
  const th = config.thresholds;
  const margin = 1 - th.atRiskMargin;
  const groups = new Map();
  const add = (key, entry) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  };

  for (const p of pages) {
    if (p.status === 'pass') continue;
    const lcpRelevant = p.lcpMs > th.lcpMaxMs * margin;
    const clsRelevant = p.cls >= th.clsMax * margin;
    const seen = new Set();
    for (const ins of p.insights) {
      const detail = ins.detailFile && fs.existsSync(ins.detailFile) ? fs.readFileSync(ins.detailFile, 'utf8') : '';
      const c = classifyInsight(ins.name, detail, origin, origin + p.path, classification);
      if (c.class === 'info') continue;
      if (c.cls ? !clsRelevant : !lcpRelevant) continue;
      const tag = c.fix || c.flag;
      seen.add(tag);
      add(`${ins.name}|${tag}`, { page: p.path, insight: ins.name, c, estimateMs: ins.lcpSavingsMs, fcpMs: ins.fcpSavingsMs, evidence: ins.detailFile });
    }
    const dom = lcpRelevant ? dominantSubpart(p.breakdown) : null;
    if (dom) {
      const c = classification.lcpSubpart[dom[0]];
      const tag = c.fix || c.flag;
      if (c.class !== 'info' && !seen.has(tag)) add([...groups.keys()].find(k => k.endsWith(`|${tag}`)) ?? `LCPBreakdown:${dom[0]}|${tag}`, { page: p.path, insight: `LCPBreakdown:${dom[0]}`, c, estimateMs: dom[1], fcpMs: 0 });
      else if (seen.has(tag)) {
        for (const [k, list] of groups) for (const e of list) if (e.page === p.path && k.endsWith(`|${tag}`) && !e.estimateMs && !e.fcpMs) e.estimateMs = dom[1];
      }
    }
  }

  const all = [...groups.values()].map(entries => {
    const c = entries[0].c;
    return {
      insight: entries[0].insight,
      class: c.class,
      fix: c.fix || null,
      flag: c.flag || null,
      cls: Boolean(c.cls),
      reason: c.reason || null,
      vetoedFrom: c.vetoedFrom || null,
      estimateMs: mean(entries.map(e => e.estimateMs)),
      fcpMs: mean(entries.map(e => e.fcpMs)),
      pages: entries.map(e => e.page),
      evidence: entries.map(e => e.evidence).filter(Boolean),
    };
  });
  const order = (a, b) => Number(b.cls) - Number(a.cls) || b.estimateMs - a.estimateMs || b.fcpMs - a.fcpMs || b.pages.length - a.pages.length;
  const fixes = all.filter(x => x.class === 'fix').sort(order).map((x, i) => ({ id: `p${i + 1}`, status: 'pending', ...x }));
  const flags = all.filter(x => x.class === 'flag').sort(order);
  return { fixes, flags };
}

import fs from 'node:fs';
import zlib from 'node:zlib';

const num = s => Number(String(s).replace(/,/g, ''));

/** Pull LCP, its breakdown, the insight set id and the firing insights out of the DevTools summary text. */
export function parseSummary(text) {
  const lcp = /- LCP:\s*([\d,.]+)\s*ms/.exec(text);
  const grab = label => {
    const m = new RegExp(`- ${label}:\\s*([\\d,.]+)\\s*ms`).exec(text);
    return m ? num(m[1]) : null;
  };
  const cls = /- CLS:\s*([\d.]+)/.exec(text);
  const setId = /insight set id:\s*(\S+)/.exec(text);
  const insights = [];
  const block = text.split('Available insights:')[1] || '';
  for (const part of block.split(/\n\s*- insight name:\s*/).slice(1)) {
    const name = part.split('\n')[0].trim();
    const lcpSave = /estimated metric savings:[^\n]*LCP\s*([\d,.]+)\s*ms/.exec(part);
    const fcpSave = /estimated metric savings:[^\n]*FCP\s*([\d,.]+)\s*ms/.exec(part);
    const bytes = /estimated wasted bytes:\s*([\d,.]+)\s*(kB|MB|B)/.exec(part);
    insights.push({
      name,
      lcpSavingsMs: lcpSave ? num(lcpSave[1]) : 0,
      fcpSavingsMs: fcpSave ? num(fcpSave[1]) : 0,
      wastedBytes: bytes ? Math.round(num(bytes[1]) * ({ B: 1, kB: 1e3, MB: 1e6 })[bytes[2]]) : 0,
    });
  }
  return {
    setId: setId ? setId[1] : 'NAVIGATION_0',
    lcpMs: lcp ? num(lcp[1]) : null,
    clsReported: cls ? Number(cls[1]) : null,
    breakdown: {
      ttfb: grab('TTFB'),
      loadDelay: grab('Load delay'),
      loadDuration: grab('Load duration'),
      renderDelay: grab('Render delay'),
    },
    insights,
  };
}

/**
 * Exact CLS from the saved trace (the DevTools summary rounds to two decimals): layout shifts without recent
 * input, grouped in session windows of at most 5 s with gaps under 1 s, largest window wins.
 */
export function clsFromTrace(file) {
  let events;
  try {
    const raw = fs.readFileSync(file);
    const txt = (file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8');
    const parsed = JSON.parse(txt);
    events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  } catch {
    return null;
  }
  const shifts = (events || [])
    .filter(e => e.name === 'LayoutShift' && e.args?.data && !e.args.data.had_recent_input && e.args.data.is_main_frame !== false)
    .map(e => ({ ts: e.ts, score: Number(e.args.data.score) || 0 }))
    .sort((a, b) => a.ts - b.ts);
  let best = 0;
  let sum = 0;
  let start = 0;
  let last = 0;
  for (const s of shifts) {
    if (sum === 0 || s.ts - last > 1e6 || s.ts - start > 5e6) { sum = 0; start = s.ts; }
    sum += s.score;
    last = s.ts;
    best = Math.max(best, sum);
  }
  return Number(best.toFixed(4));
}

/** Index of the median of `n` sorted values: the lower middle for an even count. */
export const medianIndex = n => Math.floor((n - 1) / 2);

export function median(values) {
  const v = values.filter(x => x != null).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[medianIndex(v.length)];
}

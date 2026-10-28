import { statusOf } from './measure.mjs';

const ANSI = { green: 32, amber: 33, red: 31, cyan: 36, magenta: 35, gray: 90, bold: 1 };

function painter(on) {
  const p = {};
  for (const [name, code] of Object.entries(ANSI)) p[name] = s => (on ? `\x1b[${code}m${s}\x1b[0m` : s);
  return p;
}

const STATUS = { pass: ['✓', 'green'], risk: ['⚠', 'amber'], fail: ['✗', 'red'] };
const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

/** Horizontal bar of `width` cells; `markAt` draws the threshold line. */
export function bar(value, max, width, markAt, paint, color) {
  const filled = Math.max(0, Math.min(width, Math.round((value / max) * width)));
  const mark = markAt == null ? -1 : Math.min(width - 1, Math.round((markAt / max) * width));
  let out = '';
  for (let i = 0; i < width; i++) {
    if (i === mark) out += paint.gray('│');
    else out += i < filled ? paint[color]('█') : paint.gray('░');
  }
  return out;
}

const colorOf = (m, th) => STATUS[m.status ?? statusOf(m, th)][1];
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const fit = (p, width) => (p.length > width ? `…${p.slice(-(width - 1))}` : p);
const nameWidth = (paths, min = 0) => Math.min(30, Math.max(min, ...paths.map(p => p.length)));
const estimate = f => (f.estimateMs ? `~${f.estimateMs} ms` : f.fcpMs ? `~${f.fcpMs} ms FCP` : '–');

const fmtCls = c => (c == null ? 'n/a' : c === 0 ? '0' : c.toFixed(3));

function pagesBlock(pages, th, paint, width = 26) {
  const name = nameWidth(pages.map(p => p.path), 4);
  const max = th.lcpMaxMs * 2;
  return pages.map(p => {
    const [sym, c] = STATUS[p.status];
    return `  ${pad(fit(p.path, name), name)}  ${bar(p.lcpMs, max, width, th.lcpMaxMs, paint, colorOf(p, th))}  ${rpad(p.lcpMs, 5)} ms  CLS ${pad(fmtCls(p.cls), 6)} ${paint[c](sym)}`;
  });
}

function breakdownBlock(pages, paint, width = 44) {
  const rows = pages.filter(p => p.status !== 'pass' && p.breakdown?.loadDelay != null).slice(0, 6);
  if (rows.length === 0) return [];
  const parts = [['ttfb', 'gray', 'TTFB'], ['loadDelay', 'cyan', 'load delay'], ['loadDuration', 'magenta', 'load duration'], ['renderDelay', 'amber', 'render delay']];
  const lines = ['', paint.bold('Where the LCP time goes'), `  ${parts.map(([, c, l]) => paint[c]('█') + ' ' + l).join('   ')}`];
  const name = nameWidth(rows.map(p => p.path));
  for (const p of rows) {
    const total = parts.reduce((s, [k]) => s + (p.breakdown[k] || 0), 0) || 1;
    let used = 0;
    let line = '';
    parts.forEach(([k, c], i) => {
      const n = i === parts.length - 1 ? width - used : Math.round(((p.breakdown[k] || 0) / total) * width);
      used += n;
      line += paint[c]('█'.repeat(Math.max(0, n)));
    });
    lines.push(`  ${pad(fit(p.path, name), name)}  ${line}  ${p.breakdown.loadDelay}/${p.breakdown.loadDuration}/${p.breakdown.renderDelay} ms`);
  }
  return lines;
}

function proposalsBlock({ fixes, flags }, paint, pages) {
  const lines = [''];
  const open = pages.filter(p => p.status !== 'pass').length;
  if (fixes.length === 0 && flags.length === 0) {
    return [...lines, open ? paint.amber(`${open} page(s) fail or are at risk, but the traces showed no actionable insight. Re-run, or trace the page by hand with the chrome-devtools CLI.`) : paint.green('No fixes to propose.')];
  }
  const gain = f => f.estimateMs || f.fcpMs;
  const max = Math.max(1, ...fixes.map(gain), ...flags.map(gain));
  if (fixes.length) {
    lines.push(paint.bold('Proposed fixes') + paint.gray('  (CLS first, then estimated LCP gain)'));
    fixes.forEach((f, i) => {
      lines.push(`  ${rpad(i + 1, 2)}. ${bar(gain(f), max, 16, null, paint, f.cls ? 'magenta' : 'green')}  ${pad(f.cls ? 'CLS' : estimate(f), 14)} ${f.insight} → ${paint.bold(f.fix)}  ${paint.gray(plural(f.pages.length, 'page'))}`);
    });
  }
  if (flags.length) {
    lines.push('', paint.bold('Needs a human') + paint.gray('  (not mechanical, or outside site-owned code)'));
    for (const f of flags) {
      const why = f.reason ? paint.gray(` — ${f.reason}`) : '';
      lines.push(`  ⚑ ${pad(f.insight, 22)} → ${f.flag}  ${paint.gray(`${estimate(f)} · ${plural(f.pages.length, 'page')}`)}${why}`);
    }
  }
  return lines;
}

function summaryLine(pages, paint) {
  const n = s => pages.filter(p => p.status === s).length;
  return `${paint.green(`${n('pass')} pass`)}  ${paint.amber(`${n('risk')} at risk`)}  ${paint.red(`${n('fail')} fail`)}  ·  ${plural(pages.length, 'page')}`;
}

function header({ target, config, date }, paint) {
  const th = config.thresholds;
  const p = config.profile;
  return [
    paint.bold(`CWV report — ${target} — ${config.profileName}`) + paint.gray(`  ${date}`),
    paint.gray(`  ${config.profileName} · ${p.cpuThrottlingRate}× CPU · ${p.networkConditions} · LCP ≤ ${th.lcpMaxMs} ms · CLS < ${th.clsMax} · keep a fix at ≥ ${th.keepMinGainMs} ms`),
    '',
  ];
}

export function renderReport(ctx, { color = false } = {}) {
  const paint = painter(color);
  const { pages, proposals } = ctx;
  return [
    ...header(ctx, paint),
    ...pagesBlock(pages, ctx.config.thresholds, paint),
    '',
    `  ${summaryLine(pages, paint)}`,
    ...breakdownBlock(pages, paint),
    ...proposalsBlock(proposals, paint, pages),
    '',
  ].join('\n');
}

export function renderFinal(ctx, { color = false } = {}) {
  const paint = painter(color);
  const th = ctx.config.thresholds;
  const max = th.lcpMaxMs * 2;
  const name = nameWidth(ctx.after.map(p => p.path), 4);
  const lines = [...header(ctx, paint), paint.bold('Before → after') + paint.gray('  (median LCP)')];
  for (const a of ctx.after) {
    const b = ctx.before.find(x => x.path === a.path);
    const label = fit(a.path, name);
    const delta = b ? a.lcpMs - b.lcpMs : 0;
    const dc = delta < 0 ? 'green' : delta > 0 ? 'red' : 'gray';
    lines.push(`  ${pad(label, name)}  ${b ? bar(b.lcpMs, max, 26, th.lcpMaxMs, paint, colorOf(b, th)) : ''}  ${rpad(b?.lcpMs ?? '', 5)} ms`);
    lines.push(`  ${pad('', name)}  ${bar(a.lcpMs, max, 26, th.lcpMaxMs, paint, colorOf(a, th))}  ${rpad(a.lcpMs, 5)} ms  ${paint[dc](`${delta > 0 ? '+' : ''}${delta} ms`)}  CLS ${fmtCls(b?.cls)} → ${fmtCls(a.cls)}  ${paint[STATUS[a.status][1]](STATUS[a.status][0])}`);
  }
  lines.push('', `  before: ${summaryLine(ctx.before, paint)}`, `  after:  ${summaryLine(ctx.after, paint)}`, '', paint.bold('Fixes'));
  const max2 = Math.max(1, ...ctx.fixLog.map(f => Math.abs(f.gainMs || 0)), ...ctx.fixLog.map(f => f.estimateMs || 0));
  for (const f of ctx.fixLog) {
    const c = f.status === 'kept' ? 'green' : f.status === 'reverted' || f.status === 'vetoed' ? 'red' : 'gray';
    lines.push(`  ${paint[c](pad(f.status, 8))} ${bar(Math.max(0, f.gainMs || 0), max2, 14, null, paint, 'green')}  ${rpad(f.gainMs ?? '–', 5)} ms measured · ~${f.estimateMs} ms est.  ${f.insight} → ${f.fix}${f.note ? paint.gray(` — ${f.note}`) : ''}`);
  }
  if (ctx.proposals.flags.length) {
    lines.push('', paint.bold('Left for a human'));
    for (const f of ctx.proposals.flags) lines.push(`  ⚑ ${f.insight} → ${f.flag}  ${paint.gray(plural(f.pages.length, 'page'))}`);
  }
  return [...lines, ''].join('\n');
}

/** Markdown improvements file: the plain report in a fence, plus a fix table. */
export function renderMarkdown(ctx) {
  const rows = ctx.fixLog.map(f => `| ${f.status} | ${f.insight} | ${f.fix || ''} | ${f.estimateMs} | ${f.gainMs ?? ''} | ${(f.files || []).join(', ')} | ${f.note || ''} |`);
  return [
    `# CWV improvements — ${ctx.target} — ${ctx.date}`,
    '',
    '```text',
    renderFinal(ctx, { color: false }).trimEnd(),
    '```',
    '',
    '| Status | Insight | Fix | Est. ms | Measured ms | Files | Note |',
    '| --- | --- | --- | ---: | ---: | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function sitemapPaths(dist) {
  const files = fs.readdirSync(dist).filter(f => /^sitemap.*\.xml$/.test(f));
  const seen = new Set();
  const urls = [];
  const visit = file => {
    if (seen.has(file) || !fs.existsSync(path.join(dist, file))) return;
    seen.add(file);
    const xml = fs.readFileSync(path.join(dist, file), 'utf8');
    for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
      let u;
      try { u = new URL(m[1]); } catch { continue; }
      if (u.pathname.endsWith('.xml')) visit(path.basename(u.pathname));
      else urls.push(u.pathname);
    }
  };
  files.forEach(visit);
  return urls;
}

function htmlPaths(dist) {
  return walk(dist)
    .filter(f => f.endsWith('.html'))
    .map(f => `/${path.relative(dist, f).split(path.sep).join('/')}`)
    .filter(p => !/^\/(404|500)\.html$/.test(p) && !/^\/(_astro|_next|assets)\//.test(p))
    .map(p => p.replace(/\/index\.html$/, '/').replace(/\.html$/, ''));
}

/** A listing `/monuments` sits above items at `/monument/<slug>`: compare the segment with its likely singulars. */
const singulars = seg => [seg, seg.replace(/ies$/, 'y'), seg.replace(/es$/, ''), seg.replace(/s$/, '')];

/** Template key: first segment; a one-segment page is a listing only when other pages live under it, else "static". */
function templateOf(pathname, parents) {
  const segs = pathname.split('/').filter(Boolean);
  if (segs.length === 0) return 'home';
  if (segs.length > 1) return `${segs[0]}/*`;
  return singulars(segs[0]).some(x => parents.has(x)) ? segs[0] : 'static';
}

/** One page per template, the homepage first. `quick` keeps only the homepage. */
export function discoverPages(dist, { full, maxPages, include = [] }) {
  if (!full) return [{ path: '/', template: 'home' }];
  const all = [...new Set([...sitemapPaths(dist), ...htmlPaths(dist)].map(p => (p === '' ? '/' : p)))]
    .filter(p => !/\/page\/\d+\/?$/.test(p) && !/\/\d+\/?$/.test(p))
    .sort();
  const parents = new Set(all.map(p => p.split('/').filter(Boolean)).filter(s => s.length > 1).map(s => s[0]));
  const picked = new Map();
  for (const p of all) {
    const t = templateOf(p, parents);
    if (!picked.has(t)) picked.set(t, { path: p, template: t });
  }
  const pages = [...picked.values()];
  pages.sort((a, b) => (a.template === 'home' ? -1 : b.template === 'home' ? 1 : a.template.localeCompare(b.template)));
  const extra = include.filter(p => !pages.some(x => x.path === p)).map(p => ({ path: p, template: 'included' }));
  return [...pages.slice(0, Math.max(0, maxPages - extra.length)), ...extra];
}

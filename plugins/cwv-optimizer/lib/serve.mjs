import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import zlib from 'node:zlib';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.xml', '.txt', '.webmanifest']);
const HASHED = /(^|\/)(_astro|_next\/static|assets)\/|[.-][A-Za-z0-9_-]{8,}\.(css|js|mjs|woff2?|webp|avif|png|jpe?g)$/;

/**
 * Serve a build folder on a free port the way a CDN would: /x -> x.html or x/index.html, brotli/gzip for text,
 * long immutable caching for hashed assets, revalidation for HTML. Returns { port, origin, close }.
 */
export function createDistServer(distDir) {
  const root = path.resolve(distDir);
  const cache = new Map();

  const compress = (file, buf, encoding) => {
    const key = `${file}:${encoding}`;
    if (!cache.has(key)) {
      cache.set(key, encoding === 'br'
        ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
        : zlib.gzipSync(buf, { level: 6 }));
    }
    return cache.get(key);
  };

  const server = http.createServer((req, res) => {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    const base = path.join(root, rel);
    if (base !== root && !base.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    const file = [base, `${base}.html`, path.join(base, 'index.html')]
      .find(f => fs.existsSync(f) && fs.statSync(f).isFile());
    const status = file ? 200 : 404;
    const target = file || path.join(root, '404.html');
    if (!fs.existsSync(target)) { res.writeHead(404, { 'content-type': 'text/plain' }).end('not found'); return; }

    const ext = path.extname(target);
    const headers = { 'content-type': MIME[ext] || 'application/octet-stream', vary: 'Accept-Encoding' };
    headers['cache-control'] = HASHED.test(rel) ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate';
    let body = fs.readFileSync(target);
    const accept = String(req.headers['accept-encoding'] || '');
    if (COMPRESSIBLE.has(ext) && body.length > 512) {
      const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
      if (enc) { body = compress(target, body, enc); headers['content-encoding'] = enc; }
    }
    headers['content-length'] = body.length;
    res.writeHead(status, headers).end(body);
  });

  return server;
}

/** Runs the server in a worker thread: the runner blocks its own thread while the browser loads pages. */
export function serveDist(distDir) {
  const worker = new Worker(new URL('./serve-worker.mjs', import.meta.url), { workerData: { dist: path.resolve(distDir) } });
  return new Promise((resolve, reject) => {
    worker.once('error', reject);
    worker.once('message', ({ port }) => resolve({
      port,
      origin: `http://localhost:${port}`,
      close: () => worker.terminate(),
    }));
  });
}

const DIST_CANDIDATES = ['dist', 'build', 'out', '.output/public'];

/** The configured build folder, else the first usual one holding an index.html. */
export function findDist(root, configured) {
  const list = configured ? [configured] : DIST_CANDIDATES;
  for (const d of list) {
    const p = path.resolve(root, d);
    if (fs.existsSync(path.join(p, 'index.html'))) return p;
  }
  return null;
}

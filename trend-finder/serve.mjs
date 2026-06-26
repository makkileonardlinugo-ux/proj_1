/**
 * serve.mjs — Trend Finder Phase 2 Node server
 * Port: 3002
 *
 * Responsibilities:
 *   1. Serve static files from this directory (trend-finder/)
 *      Falls back to parent directory for shared assets (brand_assets/, images/)
 *   2. /proxy/image?url=ENCODED — fetch and pipe remote images (bypasses CORS)
 *   3. /api/*                   — proxy to Flask at localhost:5001
 */

import http  from 'node:http';
import https from 'node:https';
import fs    from 'node:fs';
import path  from 'node:path';
import { URL }          from 'node:url';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT    = path.dirname(__dirname);
const PORT      = 3002;
const FLASK     = 'http://localhost:5001';

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.webp':  'image/webp',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
  '.txt':   'text/plain; charset=utf-8',
};

// ─── Static file handler ────────────────────────────────────────────────────

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type':  MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache, no-store' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

function staticHandler(req, res, rawPath) {
  // Default route → Trend Finder.html
  let pathname = rawPath === '/' || rawPath === '' ? '/Trend Finder.html' : rawPath;

  // Decode and normalise to prevent path traversal
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { decoded = pathname; }
  const normalised = path.normalize(decoded);

  const tfPath     = path.join(__dirname, normalised);
  const parentPath = path.join(PARENT,    normalised);

  // Security: must stay within one of our two allowed roots
  const inTf     = tfPath.startsWith(__dirname + path.sep) || tfPath === __dirname;
  const inParent = parentPath.startsWith(PARENT + path.sep) || parentPath === PARENT;

  if (!inTf && !inParent) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  // Try trend-finder/ directory first, then parent (for shared brand assets, images, etc.)
  if (fs.existsSync(tfPath) && fs.statSync(tfPath).isFile()) {
    serveFile(res, tfPath);
  } else if (fs.existsSync(parentPath) && fs.statSync(parentPath).isFile()) {
    serveFile(res, parentPath);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end(`404 Not Found: ${pathname}`);
  }
}

// ─── Image proxy ────────────────────────────────────────────────────────────

function imageProxy(req, res, searchParams) {
  const rawUrl = searchParams.get('url');
  if (!rawUrl) { res.writeHead(400); res.end('Missing ?url='); return; }

  let target;
  try {
    target = new URL(decodeURIComponent(rawUrl));
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Bad protocol');
  } catch {
    res.writeHead(400); res.end('Invalid URL'); return;
  }

  const lib = target.protocol === 'https:' ? https : http;

  const imgReq = lib.get(
    target.href,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':    target.origin,
        'Accept':     'image/*,*/*',
      },
      timeout: 8000,
    },
    (imgRes) => {
      const ct = imgRes.headers['content-type'] || 'image/jpeg';
      res.writeHead(imgRes.statusCode || 200, {
        'Content-Type':                ct,
        'Cache-Control':               'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      });
      imgRes.pipe(res);
    },
  );

  imgReq.on('timeout', () => {
    imgReq.destroy();
    if (!res.headersSent) { res.writeHead(504); res.end('Image proxy timeout'); }
  });
  imgReq.on('error', () => {
    if (!res.headersSent) { res.writeHead(502); res.end('Image proxy error'); }
  });
}

// ─── API proxy → Flask:5001 ─────────────────────────────────────────────────

function apiProxy(req, res, reqUrl) {
  const flaskTarget = new URL(FLASK);

  const options = {
    hostname: flaskTarget.hostname,
    port:     parseInt(flaskTarget.port, 10) || 5001,
    path:     reqUrl.pathname + reqUrl.search,
    method:   req.method,
    headers:  { ...req.headers, host: `localhost:5001` },
  };

  const proxyReq = http.request(options, (proxyRes) => {
    const headers = {
      ...proxyRes.headers,
      'Access-Control-Allow-Origin': '*',
    };
    res.writeHead(proxyRes.statusCode || 200, headers);
    proxyRes.pipe(res);
  });

  proxyReq.setTimeout(35000, () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Request timed out after 35 s.' }));
    }
  });

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error:   'Flask server is not running. Start it with: python server.py',
      }));
    }
  });

  req.pipe(proxyReq);
}

// ─── Main server ────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // Always set CORS header
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    res.end(); return;
  }

  let reqUrl;
  try { reqUrl = new URL(req.url, `http://localhost:${PORT}`); }
  catch { res.writeHead(400); res.end('Bad Request'); return; }

  const { pathname, searchParams } = reqUrl;

  if (pathname.startsWith('/proxy/image')) {
    imageProxy(req, res, searchParams);
  } else if (pathname.startsWith('/api/')) {
    apiProxy(req, res, reqUrl);
  } else {
    staticHandler(req, res, pathname);
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('  Trend Finder v2  (Phase 2)');
  console.log(`  http://localhost:${PORT}/Trend%20Finder.html`);
  console.log(`  Image proxy:  http://localhost:${PORT}/proxy/image?url=...`);
  console.log(`  API proxy  :  http://localhost:${PORT}/api/trending?q=...`);
  console.log('');
});

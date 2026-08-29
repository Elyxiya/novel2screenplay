// web-host.mjs
// Point 3 · two-host demo static server.
//   - http://localhost:3002 : eslint b web host (direct-embed + iframe-host pages), same-origin /api/agent proxy.
//   - http://localhost:3003 : the panel document served as a *different origin* for the iframe host.
// Business rule (restrained-rework-3-points §3.3): the iframe panel (3003) is a different origin than the
// host page (3002), so postMessage origin whitelist is a live, exercised guarantee — not a dead code path.
// The UMD bundle is streamed from packages/agent-workbench/dist via /lib/ for both origins.
//
// Run:  node apps/embed-hosts/web/web-host.mjs        (or: npm run start -w <dir that owns this file>)
// Static only: no Next, no build tooling, no dependencies beyond node:*. Bundle is rebuilt with `npm run build -w @novel/agent-workbench`.
import http from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// here = apps/embed-hosts/web → ../../.. = repo 根 → packages/agent-workbench/dist
const DIST = resolve(here, '../../..', 'packages/agent-workbench/dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Serve a static directory, with a special /lib/* route that streams the UMD bundle from the dist folder. */
function makeServer(root) {
  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let pathname = url.pathname;

    // Bundle streamed from the shared dist (both origins get the exact same file).
    if (pathname === '/lib/agent-workbench.umd.js' || pathname === '/lib/agent-workbench.umd.js.map') {
      const file = join(DIST, pathname.replace('/lib/', ''));
      if (!existsSync(file)) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('agent-workbench bundle not built. Run: npm run build -w @novel/agent-workbench');
        return;
      }
      const ctype = MIME[extname(file)] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': ctype, 'cache-control': 'no-cache' });
      res.end(readFileSync(file));
      return;
    }

    // Otherwise serve a regular file under root; default to index.html, falling back to panel.html
    // (the panel entry page) for directory paths.
    if (pathname === '/') pathname = existsSync(join(root, 'index.html')) ? '/index.html' : '/panel.html';
    let file = normalize(join(root, pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ctype = MIME[extname(file)] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': ctype, 'cache-control': 'no-cache' });
    res.end(readFileSync(file));
  };
}

const PORT_WEB = Number(process.env.PORT_WEB ?? 3004);
const PORT_PANEL = Number(process.env.PORT_PANEL ?? 3003);
const WEB_ROOT = resolve(here, '.');
const PANEL_ROOT = resolve(here, '../panel');

http.createServer(makeServer(WEB_ROOT)).listen(PORT_WEB, () => {
  console.log(`[embed-hosts] web host  → http://localhost:${PORT_WEB}/  (3002 is the running Next dev server, so the demo host uses a free port)`);
  console.log(`[embed-hosts]   direct-embed: http://localhost:${PORT_WEB}/          (same-origin, self postMessage)`);
  console.log(`[embed-hosts]   iframe host : http://localhost:${PORT_WEB}/iframe-host.html  (embeds panel from :${PORT_PANEL})`);
});
http.createServer(makeServer(PANEL_ROOT)).listen(PORT_PANEL, () => {
  console.log(`[embed-hosts] panel       → http://localhost:${PORT_PANEL}/  (origin ${PORT_PANEL} — different origin from host :${PORT_WEB})`);
});
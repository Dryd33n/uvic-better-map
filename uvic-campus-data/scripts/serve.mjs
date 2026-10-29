#!/usr/bin/env node
// Tiny static server for local development, with CORS so apps on other ports can read dist/.
//   npm run serve                 http://localhost:8080
//   npm run serve -- --port 3000
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, normalize } from 'node:path';
import { ROOT, parseArgs } from './_node.mjs';

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.geojson': 'application/geo+json', '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ts': 'text/plain',
};

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const url = new URL(req.url, 'http://x');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    let full = resolve(ROOT, p);
    if (!full.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if ((await stat(full)).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(301, { Location: url.pathname + '/' }).end(); return; }
      full = join(full, 'index.html');
    }
    const body = await readFile(full);
    res.writeHead(200, { 'Content-Type': TYPES[extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(port, () => {
  console.log(`Serving ${ROOT} with CORS at http://localhost:${port}/`);
  console.log(`  3D viewer    http://localhost:${port}/templates/three-viewer/`);
  console.log(`  2D map       http://localhost:${port}/templates/leaflet-map/`);
  console.log(`  Room finder  http://localhost:${port}/templates/room-finder/`);
  console.log(`  Dataset      http://localhost:${port}/dist/manifest.json`);
});

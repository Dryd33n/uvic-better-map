// Node-only helpers shared by the scripts.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function fetchJson(url, { tries = 4 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      return await r.json();
    } catch (e) {
      if (attempt >= tries) throw new Error(`Couldn't fetch ${url}\n  ${e.cause?.code || e.cause?.message || e.message}`);
      await new Promise((s) => setTimeout(s, 500 * attempt));
    }
  }
}

// readJson for the geojson loader: URLs are fetched, paths resolve against the config file's folder.
export function readJsonFrom(baseDir) {
  return async (p) => (/^https?:/i.test(p) ? fetchJson(p) : JSON.parse(await readFile(resolve(baseDir, p), 'utf8')));
}

export async function loadConfig(path = 'config/sources.mjs') {
  const abs = resolve(ROOT, path);
  const mod = await import(pathToFileURL(abs).href);
  return { config: mod.default, dir: dirname(abs) };
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      out[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
    } else out._.push(a);
  }
  return out;
}

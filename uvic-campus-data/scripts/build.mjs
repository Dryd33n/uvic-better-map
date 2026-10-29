#!/usr/bin/env node
// Build the dataset.
//   npm run build                         everything, into dist/
//   npm run build -- --only buildings,food   just those layers (buildings always included for floors)
//   npm run build -- --no-indoor          skip floor plans
//   npm run build -- --formats geojson    only GeoJSON output
//   npm run build -- --out public/data --config config/my-sources.mjs
import { mkdir, rm, writeFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { buildDataset } from '../src/pipeline.mjs';
import { renderOutputs } from '../src/output.mjs';
import { ROOT, fetchJson, readJsonFrom, loadConfig, parseArgs } from './_node.mjs';

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  console.log(`npm run build -- [--out dir] [--only key,key] [--no-indoor] [--formats geojson,local] [--config path]`);
  process.exit(0);
}
let writing = false;
process.on('unhandledRejection', fail);
process.on('uncaughtException', fail);
function fail(e) {
  console.error(`\nBuild failed: ${e.message}`);
  if (/fetch/i.test(e.message)) console.error('Check your internet connection and that the ArcGIS service is up (npm run audit lists every source URL).');
  console.error(writing ? 'It failed while writing files, so the output folder may be incomplete. Fix the cause and build again.' : 'Nothing was written; any existing output is untouched.');
  process.exit(1);
}
const { config, dir } = await loadConfig(args.config);
if (args.formats) config.output = { ...config.output, formats: String(args.formats).split(',') };
const outDir = resolve(ROOT, args.out || config.output?.dir || 'dist');

const t0 = Date.now();
const ds = await buildDataset(config, {
  fetchJson,
  readJson: readJsonFrom(dir),
  log: (m) => console.log(m),
  only: args.only ? String(args.only).split(',') : null,
  indoor: !args['no-indoor'],
});
const { files, manifest } = renderOutputs(ds);

writing = true;
// Only clear a folder this tool made (it has a manifest.json); never wipe anything else.
const exists = async (p) => access(p).then(() => true, () => false);
if (await exists(outDir)) {
  const entries = await readdir(outDir);
  if (entries.length && !entries.includes('manifest.json')) {
    console.error(`\n${outDir} has files but no manifest.json, so it doesn't look like a dataset folder. Pick another --out.`);
    process.exit(1);
  }
  await rm(outDir, { recursive: true, force: true });
}

let bytes = 0;
for (const [path, data] of Object.entries(files)) {
  const full = join(outDir, path);
  await mkdir(dirname(full), { recursive: true });
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  bytes += text.length;
  await writeFile(full, text);
}
const indoor = manifest.indoor ? `, ${Object.keys(manifest.indoor.buildings).length} buildings with floor plans, ${manifest.rooms.count} named rooms` : '';
console.log(`\n${Object.keys(manifest.layers).length} layers${indoor}`);
console.log(`wrote ${Object.keys(files).length} files (${(bytes / 1048576).toFixed(1)} MB) to ${outDir} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (manifest.warnings?.length) console.log(`warnings:\n  ${manifest.warnings.join('\n  ')}`);

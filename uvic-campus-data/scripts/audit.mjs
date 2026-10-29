#!/usr/bin/env node
// Compare config/sources.mjs with the live ArcGIS web map behind the UVic app.
// Lists map layers the config doesn't pull and real fields it leaves out.
//   npm run audit
import { auditAgainstWebmap } from '../src/audit.mjs';
import { fetchJson, loadConfig, parseArgs } from './_node.mjs';

const args = parseArgs(process.argv.slice(2));
const { config } = await loadConfig(args.config);
const r = await auditAgainstWebmap(config, { fetchJson });

console.log(`Web map "${r.webmap.title}" has ${r.webmap.layers} layers; the config pulls ${r.configured} ArcGIS sources.\n`);
if (r.missing.length) {
  console.log(`In the map but not in the config (${r.missing.length}):`);
  for (const m of r.missing) console.log(`  ${m.title}\n    ${m.url}`);
} else console.log('Every layer in the map is in the config.');
console.log('');
if (r.unmapped.length) {
  console.log('Source fields the config leaves out (CAD and system fields hidden):');
  for (const u of r.unmapped) console.log(`  ${u.where}: ${u.error ? `could not read (${u.error})` : u.fields.join(', ')}`);
} else console.log('No unmapped fields beyond CAD and system ones.');

#!/usr/bin/env node
// Check a built dataset: every file the manifest lists exists and parses, counts match,
// GeoJSON is valid RFC 7946 (closed rings, right-hand winding, in bounds), ids are unique,
// and rooms point at real buildings. Exits 1 on errors.
//   npm run validate            checks dist/
//   npm run validate -- public/data
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { validateDataset } from '../src/validate.mjs';
import { ROOT, parseArgs } from './_node.mjs';

const args = parseArgs(process.argv.slice(2));
const dir = resolve(ROOT, args._[0] || 'dist');
const report = await validateDataset(async (p) => JSON.parse(await readFile(join(dir, p), 'utf8')));

console.log(`${report.stats.files} files, ${report.stats.features} features (${report.stats.rooms} rooms) checked in ${dir}`);
for (const w of report.warnings) console.log(`warning: ${w}`);
for (const e of report.errors) console.log(`error:   ${e}`);
console.log(report.ok ? 'OK' : `${report.errors.length} error(s)`);
process.exit(report.ok ? 0 : 1);

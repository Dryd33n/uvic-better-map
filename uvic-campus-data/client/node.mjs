// Node-only helpers for the client. Kept out of uvic-campus.mjs so browser bundlers never see node: imports.
//   import { openCampusFromDir } from 'uvic-campus-data/client/node';
//   const campus = await openCampusFromDir('dist');
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { openCampus } from './uvic-campus.mjs';

/** Loader that reads dataset files from a folder instead of over HTTP. */
export function fileLoader(dir) {
  const root = resolve(dir);
  return async (path) => JSON.parse(await readFile(join(root, path), 'utf8'));
}

/** Open a dataset folder on disk. */
export function openCampusFromDir(dir = 'dist') {
  return openCampus(dir, { load: fileLoader(dir) });
}

export * from './uvic-campus.mjs';

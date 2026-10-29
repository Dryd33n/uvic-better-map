#!/usr/bin/env node
// Using the dataset from Node: no server, no browser. Run after `npm run build`:
//   npm run example
// Patterns here carry over to an API route, a bot, a static-site build step, etc.
import { openCampusFromDir } from '../client/node.mjs';
import { fileURLToPath } from 'node:url';

const campus = await openCampusFromDir(fileURLToPath(new URL('../dist/', import.meta.url)));
const m = campus.manifest;

console.log(`Dataset built ${m.builtAt}: ${Object.keys(m.layers).length} layers, ${m.rooms?.count ?? 0} rooms\n`);

// 1. Look up a room and say where it is.
const room = await campus.room('ECS 125');
if (room) {
  const level = campus.levels.find((l) => l.id === room.level);
  console.log(`${room.name}: ${room.typeName} on ${level.label} of ${room.buildingName}`);
  console.log(`  directions: ${campus.directionsUrl(room.labelPoint)}\n`);
}

// 2. Accessible washrooms per building, from the room index.
const accessible = (await campus.rooms()).filter((r) => r.washroom && /accessible/i.test(r.washroom.access || '') && !/not/i.test(r.washroom.access || ''));
const byBuilding = Object.groupBy ? Object.groupBy(accessible, (r) => r.buildingName) : accessible.reduce((a, r) => ((a[r.buildingName] ??= []).push(r), a), {});
console.log('Accessible washrooms:');
for (const [b, list] of Object.entries(byBuilding).sort()) console.log(`  ${b}: ${list.map((r) => r.name).join(', ')}`);

// 3. Nearest food to a building, by straight-line distance.
const ecs = await campus.building('ECS');
if (ecs) {
  const food = (await campus.features('food'))
    .map((f) => ({ name: f.properties.name, metres: Math.round(campus.distance(ecs.properties.labelPoint, f.geometry.coordinates)) }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, 3);
  console.log(`\nClosest food to ${ecs.properties.name}:`);
  for (const f of food) console.log(`  ${f.name}: ${f.metres} m`);
}

// 4. Which building is a point in?
const here = [-123.3112, 48.4631];
console.log(`\n${here.join(', ')} is in: ${(await campus.buildingAt(here))?.properties.name ?? 'no building'}`);

// 5. Room counts by type for one building.
const plan = await campus.floorPlan('CLE');
if (plan) {
  const counts = {};
  for (const f of plan.features) counts[f.properties.typeName || 'Unknown'] = (counts[f.properties.typeName || 'Unknown'] || 0) + 1;
  console.log(`\nClearihue rooms by type: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
}

# uvic-campus-data

The University of Victoria campus map as a reusable dataset: buildings, paths, parking,
amenities and indoor floor plans with about 8,000 rooms. It's built from the public ArcGIS
layers behind UVic's [General Web Map App](https://experience.arcgis.com/experience/3d2e1b22083940f59f5b6292870e1969),
written out as standard GeoJSON plus a compact metre-based format for 3D, with a small
client library and three app templates on top.

```
npm run build      # pull from ArcGIS and write dist/ (about 20 s, ~11 MB)
npm run validate   # check dist/ is consistent and valid GeoJSON
npm run serve      # local server with CORS, http://localhost:8080
```

Node 18 or newer. No dependencies to install.

## What you get

`dist/` after a build:

| Path | What it is | Use it for |
| --- | --- | --- |
| `manifest.json` | Index of everything: layers, fields, counts, files, levels, room types, extent | Start here. Apps read it first. |
| `layers/<key>.geojson` | One GeoJSON FeatureCollection per layer (WGS84, RFC 7946) | Leaflet, MapLibre, deck.gl, OpenLayers, QGIS, PostGIS, Turf |
| `floors/<BUILDING>.geojson` | Every room in one building, all levels, `properties.level` on each | Indoor maps, room lookup |
| `rooms.json` | Flat index of every named room: building, level, type, centre point | Search, autocomplete, bots |
| `layers/<key>.local.json`, `floors/<BUILDING>.local.json` | Same data in metres east/north of a campus origin | three.js, Babylon, Unity, game engines |
| `campus.local.json` | All outdoor layers in the local format, one file | The 3D template |

33 layers: buildings, wings, roads, general/reserved/short-term parking, lot labels, walkways,
paths, chip trails, forest, sports fields and their line markings, fountains, construction,
campus land, and amenity points (food, microwaves, showers, washrooms, elevators, AEDs,
naloxone kits, emergency phones, smoking areas, bike racks, the bike centre, motorcycle and
accessible parking, EV charging, ATMs, bus stops, accessibility features). Indoor plans cover
33 buildings across levels 00, 0, 1, M and 2 to 6. Full schemas are in [docs/DATA.md](docs/DATA.md).

`npm run audit` checks this against the live web map. As of the last build it reports every
one of the map's 55 layers covered and no real fields left out.

## Using it in an app

**Any map library, no client needed.** Point it at a GeoJSON file:

```js
map.addSource('buildings', { type: 'geojson', data: 'https://your.host/dist/layers/buildings.geojson' }); // MapLibre
L.geoJSON(await (await fetch('/dist/layers/food.geojson')).json()).addTo(map);                         // Leaflet
```

**With the client** (`client/uvic-campus.mjs`, one file, no dependencies, browser or Node):

```js
import { openCampus } from './uvic-campus.mjs';
const campus = await openCampus('/dist/');

await campus.building('ECS');                      // GeoJSON feature, by code, number or name
await campus.floorPlan('ECS', { level: '2' });     // rooms on Level 2
await campus.room('ECS 125');                      // { building, level, type, labelPoint, ... }
await campus.search('microwave elliott');          // ranked buildings, rooms, amenities
await campus.buildingAt([-123.3115, 48.4610]);     // which building is this point in?
```

Full API in [docs/CLIENT.md](docs/CLIENT.md). TypeScript types ship in `client/uvic-campus.d.ts`.
In Node, `import { openCampusFromDir } from './client/node.mjs'` reads straight from a folder.

## Templates

Run `npm run serve`, then open:

| Template | Shows | Built on |
| --- | --- | --- |
| [`templates/three-viewer/`](templates/three-viewer/) | 3D campus; click a building to see its floors and rooms | three.js + local format |
| [`templates/leaflet-map/`](templates/leaflet-map/) | 2D map with layer toggles, floor switcher, room search | Leaflet + GeoJSON + client |
| [`templates/room-finder/`](templates/room-finder/) | Search box and room details, no map at all | client only |
| [`examples/node-query.mjs`](examples/node-query.mjs) | Server-side queries: accessible washrooms, nearest food | client in Node (`npm run example`) |

Each one is a single HTML file meant to be copied and changed. They expect the dataset at
`../../dist/`; change the one `DATA` constant at the top when you host it elsewhere.

## Extending it

Everything the dataset contains is defined in [`config/sources.mjs`](config/sources.mjs).
Add an ArcGIS layer, your own GeoJSON file, a field, a computed property, a join with
another source, or a new output format (CSV, SQLite, vector tiles) there.
[docs/EXTENDING.md](docs/EXTENDING.md) has a recipe for each. The build can also be driven
from code: `import { buildDataset, renderOutputs } from 'uvic-campus-data'`.

## Hosting

`dist/` is static files, so any static host works (GitHub Pages, Netlify, Cloudflare Pages, S3,
your own site). If apps on other domains will read it, serve it with
`Access-Control-Allow-Origin: *`. The data changes rarely; rebuilding monthly or each term is plenty.

## Things to know

- **Heights are estimates.** The source has no building heights. Buildings with floor plans
  get `height` from their floor count at 4 m per storey (the source's own 3D layers use 4 m);
  others have none, and the 3D template falls back to 15 m (main) or 9 m (secondary).
- **No routing graph.** Walkways are filled polygons, not a line network, so turn-by-turn
  routing would need a network derived from them. The templates link to Google Maps.
- **Room-to-building matching** uses the room number prefix, then the building footprint,
  then the building name. 148 rooms match nothing and are skipped; nearly all are blank shapes
  on Level 00 with no name, type or building.
- **The data is UVic's.** This package only reshapes publicly served layers. Check UVic's terms
  before republishing it publicly or building something commercial on it, and credit the source.

## Layout

```
config/sources.mjs     what the dataset contains (edit this)
src/                   build pipeline: loaders, geometry, enrichers, writers, validator, audit
scripts/               build, validate, audit, serve
client/                uvic-campus.mjs (+ .d.ts) for apps, node.mjs for Node
templates/             three-viewer, leaflet-map, room-finder
examples/              node-query.mjs
docs/                  DATA.md, CLIENT.md, EXTENDING.md
dist/                  build output (created by npm run build)
```

# Client library

`client/uvic-campus.mjs` reads a built dataset. One ES module, no dependencies, works in
browsers, bundlers (Vite, webpack, esbuild) and Node 18+. Files load on first use and are cached.

```js
import { openCampus } from 'uvic-campus-data/client'; // or copy the file: './uvic-campus.mjs'
const campus = await openCampus('https://your.host/dist/');
```

In Node, read from a folder instead of HTTP:

```js
import { openCampusFromDir } from 'uvic-campus-data/client/node';
const campus = await openCampusFromDir('dist');
```

## Opening

**`openCampus(base = './dist/', { load }?) → Promise<Campus>`**
`base` is the folder holding `manifest.json`. Relative URLs resolve against the page.
Pass `load: (path) => Promise<object>` to read files some other way (IndexedDB cache, a zip, a test fixture).

## Metadata

| Member | Returns |
| --- | --- |
| `campus.manifest` | The parsed manifest (see DATA.md) |
| `campus.levels` | `[{ id, label, elev }]`, bottom to top |
| `campus.roomTypes` | `{ 1: 'Classroom', ... }` |
| `campus.bbox` | `[west, south, east, north]` |
| `campus.layerKeys({ group?, kind? })` | Layer keys, e.g. `layerKeys({ group: 'amenities' })` |
| `campus.layerInfo(key)` | `{ label, kind, group, geometry, count, fields, files }` |
| `campus.url(path)` / `campus.layerUrl(key)` | Absolute URL of a file, for libraries that take URLs |
| `campus.buildingsWithFloors()` | Ids of buildings that have floor plans |
| `campus.buildingLevels(id)` | That building's levels, bottom to top |

## Layers and buildings

| Method | Returns |
| --- | --- |
| `layer(key, { format: 'geojson' \| 'local' })` | The layer file |
| `features(key)` | GeoJSON features of a layer |
| `buildings()` | All building features |
| `building(query)` | First building matching id, code (`'ecs'`), number (`'233'`), name, or part of a name. `null` if none |
| `buildingAt([lon, lat])` | The building containing the point (holes respected), or `null` |

## Rooms

| Method | Returns |
| --- | --- |
| `floorPlan(id, { level?, format? })` | The building's floor file; with `level`, only that level's rooms |
| `rooms()` | The room index (`rooms.json`) |
| `room(query)` | One index entry by number, ignoring case and spaces (`'ecs125'`), or by id |
| `roomFeature(query)` | The room's full GeoJSON feature, polygon included |

## Search

**`search(query, { limit = 10, kinds = ['building', 'room', 'point'], layers? })`**

Every word in the query must match. Exact names and codes rank first, then prefix matches,
then substring matches; main buildings rank ahead of secondary ones, then rooms, then amenities.

```js
const results = await campus.search('ecs 125');
// [{ kind: 'room', label: 'ECS 125', detail: 'Engineering and Computer Science Building · Level 1 · Classroom',
//    building: 'ECS', level: '1', room: { ...index entry } }]
```

Results carry `building` and `level` for rooms, `building` and `feature` for buildings,
`layer` and `feature` for points.

## Coordinates and links

| Method | Does |
| --- | --- |
| `toLocal([lon, lat])` | → `[x, y]` metres in the local frame |
| `toLngLat([x, y])` | → `[lon, lat]` |
| `distance(a, b)` | Straight-line metres between two `[lon, lat]` points |
| `directionsUrl([lon, lat], mode = 'walking')` | Google Maps directions link |

`pointInGeometry([lon, lat], geometry)` is also exported for your own GeoJSON polygons.

## Recipes

**MapLibre with floor switching**

```js
map.addSource('rooms', { type: 'geojson', data: campus.url(campus.manifest.indoor.buildings.ECS.files.geojson) });
map.addLayer({ id: 'rooms', type: 'fill', source: 'rooms', filter: ['==', ['get', 'level'], '2'],
  paint: { 'fill-color': ['match', ['get', 'type'], 1, '#9fc6d4', 2, '#8fb0dc', 3, '#eab08a', 4, '#c4c7c1', '#d5dedb'] } });
// switch floors: map.setFilter('rooms', ['==', ['get', 'level'], '3'])
```

**Autocomplete for a form field**

```js
input.oninput = async () => render(await campus.search(input.value, { kinds: ['room'], limit: 6 }));
```

**"Which building am I in?" with geolocation**

```js
navigator.geolocation.getCurrentPosition(async ({ coords }) => {
  const b = await campus.buildingAt([coords.longitude, coords.latitude]);
});
```

**three.js from the local format**

```js
const plan = await campus.floorPlan('ECS', { format: 'local', level: '2' });
const toPoints = (flat) => { const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1])); return pts; };
for (const room of plan.floors[0].rooms) {
  const shape = new THREE.Shape(toPoints(room.polys[0][0]));
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), material);
  mesh.position.y = plan.floors[0].elev; // north is -z after the rotation
}
```

**An API route** (any Node framework):

```js
const campus = await openCampusFromDir('dist');
app.get('/rooms/:q', async (req, res) => res.json(await campus.search(req.params.q, { kinds: ['room'] })));
```

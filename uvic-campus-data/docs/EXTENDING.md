# Extending the dataset

Everything lives in `config/sources.mjs`. After any change: `npm run build && npm run validate`.

The pipeline runs in this order:

```
layers  →  indoor (rooms → buildings)  →  enrichers  →  writers  →  manifest.json, rooms.json
```

## Add an ArcGIS layer

Find the service (`npm run audit` lists any map layer the config doesn't pull, with its URL),
then add an entry to `layers`:

```js
{ key: 'printers', label: 'Printers', kind: 'point', group: 'amenities',
  source: agol('UVIC_Printers'),            // agol(serviceName, layerIndex = 0)
  fields: { building: 'Building', level: 'Level_', colour: 'IsColour' } },
```

- `key` becomes the file name and the client's layer key. Don't rename it once apps use it.
- `kind`: `area` and `building` need polygons, `line` needs polylines, `point` and `label` take
  points (or polygons, which become their centre point).
- A layer from another ArcGIS server: `source: { type: 'arcgis', url: 'https://.../FeatureServer/3' }`.
- Only some rows: `source: agol('X', 0, { where: "Status = 'Open'" })`.

## Add your own data

Any GeoJSON file or URL works as a source, so you can add things UVic doesn't publish:

```js
{ key: 'studySpots', label: 'Study spots', kind: 'point', group: 'amenities',
  source: { type: 'geojson', file: '../my-data/study-spots.geojson' },   // relative to config/
  fields: '*' },                                                          // keep every property
```

Draw the file in [geojson.io](https://geojson.io) or QGIS. It goes through the same cleanup,
ids, validation and outputs as everything else.

## Fields

`fields` maps output names to source attributes:

```js
fields: {
  name: 'Name',                                     // copy one attribute
  phone: ['Phone', 'PhoneNumber'],                  // first one that has a value
  open24h: (a) => a.Hours === '24/7',               // computed from the source row
  floor: (a) => a.Level_?.replace('Level ', ''),    // cleaned up
}
fields: '*'                                         // everything except ArcGIS system fields
```

Blank strings and nulls are dropped, strings are trimmed, so properties are either meaningful or absent.

## Filter, transform or set ids

```js
{ key: 'publicElevators', ..., source: agol('Elevators_mar_cm'),
  filter: (f) => f.props.access === 'Public',
  transform: (f) => ({ ...f, props: { ...f.props, accessible: /accessible/i.test(f.props.category) } }),
  id: (props, raw) => `EL-${props.number}` },
```

Make ids stable: apps link to them (`#b-ECS`, room ids, saved favourites).

## Enrichers

Enrichers run after everything is loaded and can change any feature. Two are general purpose:

```js
import { joinByField, computeField } from '../src/enrichers.mjs';

enrich: [
  // Attach attributes from another source by matching a key.
  joinByField({ target: 'buildings', on: 'code', source: { type: 'geojson', file: '../my-data/hours.geojson' },
                sourceKey: 'code', fields: { hours: 'hours', phone: 'phone' }, into: 'contact' }),

  // Derive a property from the dataset itself. `target: 'rooms'` works too.
  computeField({ target: 'buildings', name: 'hasFood',
                 value: (b, ds) => ds.layers.food.features.some((f) => f.props.building === b.props.name) }),
]
```

Or write your own, `(dataset, ctx) => void`. The dataset shape is documented at the top of
`src/pipeline.mjs`:

```js
function elevatorCount(ds) {
  const byName = new Map();
  for (const e of ds.layers.elevators.features) byName.set(e.props.building, (byName.get(e.props.building) || 0) + 1);
  for (const b of ds.layers.buildings.features) {
    const n = byName.get(b.props.name) || byName.get(b.props.fullName);
    if (n) b.props.elevators = n;
  }
}
// enrich: [..., elevatorCount]
```

An enricher can also publish a separate file: `ds.extras.openingHours = {...}` is written to
`extras/openingHours.json` and listed in the manifest.

## Indoor levels

Each entry in `indoor.levels` is a room layer at one elevation:

```js
{ id: '7', label: 'Level 7', elev: 24, source: agol('level7_uvic') },
```

Keep the list bottom to top. Rooms are matched to buildings by the code at the start of the
room number (`indoor.codePattern`), then by footprint, then by the source's building name.

## Output formats

A writer is a function returning files. This one adds a CSV of rooms:

```js
function roomsCsv(ds, { roomIndex }) {
  const rows = roomIndex(ds).map((r) => [r.name, r.building, r.level, r.typeName, ...r.labelPoint]);
  const csv = ['name,building,level,type,lon,lat', ...rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  return { files: { 'rooms.csv': csv }, bundles: { rooms: 'rooms.csv' } };
}
roomsCsv.formatName = 'csv';

output: { formats: ['geojson', 'local', roomsCsv] }
```

Return `layers: { key: path }` or `floors: { buildingId: path }` too, and the manifest records
them under that format, so apps can find them. The same pattern covers SQLite, FlatGeobuf,
vector tiles (run `tippecanoe` on the GeoJSON afterwards) or a search index.

Only need GeoJSON? `npm run build -- --formats geojson`.

## Other knobs

- `origin`: the local frame's `[lon, lat]`. Change it only before apps depend on local coordinates.
- `output.precision`: `{ lngLat: 7, metres: 1 }` decimals. Lower means smaller files.
- `npm run build -- --only buildings,food` for a quick partial build (buildings are always included).
- `npm run build -- --out ../my-site/public/campus` to build straight into another project.
- `npm run build -- --config config/other.mjs` to keep several configs side by side.

## New loaders

Something that isn't ArcGIS or GeoJSON (a CSV with lat/lon columns, an internal API):
pass `loaders` to `buildDataset`, or add a function to `src/loaders.mjs`. It returns raw records:

```js
loaders.csvPoints = async (src, ctx) => {
  const text = await (await fetch(src.url)).text();
  const [head, ...lines] = text.trim().split('\n').map((l) => l.split(','));
  return lines.map((cols, i) => {
    const attrs = Object.fromEntries(head.map((h, j) => [h, cols[j]]));
    return { id: i + 1, attrs, geometry: { type: 'point', coords: [Number(attrs.lon), Number(attrs.lat)] } };
  });
};
// source: { type: 'csvPoints', url: 'https://...' }
```

## Keeping up with the source

`npm run audit` compares the config with the live web map and lists map layers you don't pull and
source fields you don't map (CAD and system fields hidden; `audit.ignoreFields` in the config
lists ones checked by hand and deliberately skipped). Run it when you rebuild.

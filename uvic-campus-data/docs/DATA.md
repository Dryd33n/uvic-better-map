# Data reference

Schema version 1. Everything here describes `dist/` after `npm run build` with the default
`config/sources.mjs`. Changing the config changes the layers and fields; the file shapes stay the same.

## Coordinates

| Format | Coordinates | Notes |
| --- | --- | --- |
| GeoJSON (`*.geojson`, `rooms.json`, `labelPoint`) | `[longitude, latitude]`, WGS84 (EPSG:4326), 7 decimals | RFC 7946: rings closed, outer rings counter-clockwise, holes clockwise |
| Local (`*.local.json`) | `[x, y]` metres, x east, y north of `manifest.crs.local.origin`, 0.1 m | Equirectangular around the origin; error is centimetres across campus |

Converting: `x = (lon - lon0) * 111320 * cos(lat0)`, `y = (lat - lat0) * 110574`. The client's
`toLocal` / `toLngLat` do this. For three.js use `(x, height, -y)` so north is `-z`.

## manifest.json

Shape below; dates and counts in it are examples, not real figures.

```jsonc
{
  "name": "uvic-campus-data",
  "schemaVersion": 1,
  "builtAt": "2026-10-29T08:41:02.113Z",
  "source": { "title": "...", "url": "https://experience.arcgis.com/...", "webmap": "ffc52085..." },
  "crs": {
    "lngLat": "EPSG:4326, [longitude, latitude] (GeoJSON, RFC 7946)",
    "local": { "origin": [-123.3117, 48.4634], "units": "metres", "axes": "x east, y north", "projection": "..." }
  },
  "bbox": [west, south, east, north],
  "formats": ["geojson", "local"],
  "layers": {
    "buildings": {
      "label": "Buildings", "kind": "building", "group": "buildings", "geometry": "Polygon", "count": 106,
      "fields": [{ "name": "code", "type": "string" }, { "name": "levels", "type": "array" }, ...],
      "files": { "geojson": "layers/buildings.geojson", "local": "layers/buildings.local.json" }
    }
  },
  "indoor": {
    "buildingsLayer": "buildings",
    "storey": 4,
    "levels": [{ "id": "00", "label": "Level 00", "elev": -8 }, { "id": "0", ... }, { "id": "1", "label": "Level 1", "elev": 0 }, { "id": "M", "label": "Mezzanine", "elev": 2 }, ...],
    "roomTypes": { "0": "Corridor", "1": "Classroom", "2": "Washroom", "3": "Food service", "4": "Stair or lift", "5": "Other" },
    "roomFields": [...],
    "buildings": { "ECS": { "name": "Engineering and Computer Science Building", "levels": ["1","2","3","4","5","6"], "rooms": 250, "files": { "geojson": "floors/ECS.geojson", "local": "floors/ECS.local.json" } } }
  },
  "rooms": { "count": 8086, "file": "rooms.json" },
  "bundles": { "local": { "campus": "campus.local.json" } },
  "extras": {}
}
```

- `kind` is `area`, `building`, `line`, `point` or `label` (a point meant as a map label).
- `group` is for UIs: `base`, `buildings`, `green`, `paths`, `water`, `transport`, `parking`, `amenities`, `safety`.
- `fields` is generated from the data, so it always matches what's in the files.
- Levels are listed bottom to top. `elev` is metres relative to Level 1. Treat level ids as strings: `"0"` and `"00"` are different levels.

## Layers

Every GeoJSON feature has `id` (also in `properties.id`). Polygons and lines also have
`properties.labelPoint` (`[lon, lat]`, inside the shape) and a `bbox`.

| Key | Kind | Count* | Properties |
| --- | --- | --- | --- |
| `boundary` | area | 7 | `name` |
| `forest` | area | 16 | `name` |
| `fields` | area | 12 | `name`, `sport`, `code` |
| `fieldLines` | line | 291 | (markings only) |
| `roads` | area | 200 | `name` |
| `parking` | area | 53 | `name` (lot label) |
| `reserved` | area | 21 | `lot` |
| `shortParking` | area | 21 | |
| `walkways`, `paths`, `trails` | area | 397, 79, 78 | |
| `fountains` | area | 12 | |
| `construction` | area | 1 | `name`, `about` |
| `buildings` | building | 106 | `name`, `fullName`, `code`, `type` (Main/Secondary), `number`, `link`, `photo`, `about`, `levels`, `height` |
| `wings` | label | 26 | `name` |
| `lots` | label | 21 | `name` |
| `food` | point | 12 | `name`, `building`, `where`, `about` |
| `microwaves` | point | 14 | `building`, `level`, `where` |
| `showers` | point | 18 | `building`, `level`, `room`, `about` |
| `washrooms` | point | 323 | `building`, `level`, `room`, `gender`, `access`, `features` |
| `elevators` | point | 74 | `category` (Elevator, Accessible Lift...), `building`, `access` (Public...), `number` |
| `access` | point | 37 | `kind`, `about` |
| `aed` | point | 48 | `building`, `buildingNumber`, `level`, `where` |
| `naloxone` | point | 20 | `building`, `buildingNumber`, `level`, `where` |
| `phones` | point | 14 | `link` |
| `smoking` | point | 18 | `substance` |
| `bikes` | point | 53 | |
| `bikeCentre` | point | 1 | `name`, `about`, `link` |
| `motorcycle`, `accessibleParking` | point | 16, 33 | `lot` |
| `ev` | point | 7 | `lot` |
| `atms` | point | 6 | `bank` |
| `bus` | point | 14 | |

\* Counts from the October 2026 build. `manifest.json` has the real numbers for yours.

Building ids are their codes (`ECS`, `CLE`, `SUB`); buildings without a code use `N` plus the
building number (`N209`). Other layers use the source's object id.

## Floor plans: floors/&lt;BUILDING&gt;.geojson

A FeatureCollection of every room in the building, with two extra top-level members:
`building` (id) and `levels` (ids present, bottom to top). Each room:

```jsonc
{
  "type": "Feature",
  "id": "ECS:1:ECS_125",
  "properties": {
    "id": "ECS:1:ECS_125",
    "name": "ECS 125",              // absent for unnamed spaces
    "type": 1, "typeName": "Classroom",
    "label": "...",                 // map label from the source, when it differs from name
    "note": "...", "link": "https://...",
    "washroom": { "gender": "Women", "access": "Accessible", "features": "..." },  // washrooms only
    "building": "ECS", "buildingName": "Engineering and Computer Science Building",
    "level": "1", "levelLabel": "Level 1", "elev": 0,
    "labelPoint": [-123.31, 48.46]
  },
  "geometry": { "type": "Polygon", "coordinates": [...] },
  "bbox": [...]
}
```

Room ids are `BUILDING:LEVEL:ROOM_NUMBER`, stable across rebuilds as long as the source keeps
the room number. Unnamed spaces use the source object id instead (`ECS:1:oid4411`).

## rooms.json

Every named room, sorted by name, without geometry:

```jsonc
[{ "id": "ECS:1:ECS_125", "name": "ECS 125", "building": "ECS", "buildingName": "...",
   "level": "1", "type": 1, "typeName": "Classroom", "labelPoint": [-123.3114, 48.4611],
   "label": "...", "washroom": { ... } }]
```

## Local format

`layers/<key>.local.json`:

```jsonc
{ "key": "buildings", "label": "Buildings", "kind": "building", "group": "buildings",
  "features": [{ "id": "ECS", "props": { ... },
                 "polys": [[[x0, y0, x1, y1, ...], [hole...]]],   // polygons: flat rings, not closed
                 "lines": [[x0, y0, ...]],                         // lines
                 "at": [x, y], "bbox": [x0, y0, x1, y1] }] }
```

Building props here also carry `floors` (same as `levels`) and `floorKey` (the floor file id),
which the 3D template reads.

`floors/<BUILDING>.local.json` uses short keys to stay small:

```jsonc
{ "building": "ECS", "name": "...",
  "floors": [{ "id": "1", "label": "Level 1", "elev": 0,
               "rooms": [{ "id": "...", "n": "ECS 125", "t": 1, "polys": [...], "at": [x, y],
                           "lbl": "...", "note": "...", "link": "...", "wash": { ... } }] }] }
```

`campus.local.json` bundles every `layers/*.local.json` under `layers`, plus `origin`,
`roomTypes`, `storey`, `floorList` and `rooms` as `[name, building, level, type]` tuples
(corridors and stairs left out).

## Validating

`npm run validate` checks that every file in the manifest exists and parses, feature counts
match, GeoJSON rings are closed with the right winding and inside the extent, ids are unique,
floor files belong to real buildings, and every room in `rooms.json` points at a real building.

@AGENTS.md

# UVic Better Map

An interactive three.js map of the University of Victoria campus: terrain, 3D buildings, and
indoor floor plans you can cut into floor by floor. One page (`app/page.tsx`) rendering
`app/campus/campus-viewer.tsx`.

## Layout

- `app/campus/campus-viewer.tsx`: the whole 3D scene (client component, one `useEffect` owns it).
  The UI reaches the scene through the `sceneApi` ref.
- `app/campus/search.tsx`: the search box (rooms and buildings, from the bundle's `rooms` index).
- `app/campus/debug-panel.tsx`: the debug panel (` key or the Debug button).
- `app/campus/types.ts`: shapes of the files in `public/campus`.
- `uvic-campus-data/`: the data package. It pulls UVic's public ArcGIS layers plus NRCan lidar
  and writes the dataset. Its own README covers layers, fields and the terrain source.
- `public/campus/`: the built dataset the app serves (copied from the package's build output).

## Rebuilding the data

Building straight into `public/campus` fails with EBUSY while `next dev` is running (the folder is
locked). Build to the package's `dist/` (gitignored), copy it over, remove files the build no
longer makes, then validate:

```sh
cd uvic-campus-data
npm install            # once: clipper-lib, geotiff, proj4
npm run build          # ~50 s, needs network (ArcGIS + the NRCan S3 GeoTIFF)
cp -r dist/. ../public/campus/
diff -rq dist ../public/campus | grep "Only in ../public"   # stale files: delete them
npm run validate -- ../public/campus
```

What goes into the dataset is defined in `uvic-campus-data/config/sources.mjs` (layers and the
enrich list). The 3D-specific steps are custom enrichers:

- `massing()` (`src/enrichers.mjs`) → `extras/massing.json`: each storey only where that floor
  has rooms, merged into bands. Replaced the older `overhangs()` (still exported, not used).
- `floorOutlines()` → `extras/floorOutlines.json`: each level's outline, for the floor plate.
- `groundLines()` → `extras/groundLines.json`: ground layer outlines, unioned per group.
- `foodOutlets()` names each food outlet's room (label + link) and tags the outlet with `room`/`level`;
  `rooms: { Starbucks: 'CSR 050' }` sets one by hand. Art's Place and University Club have no
  room: they show as a pinned spot on their building's ground floor.
- `terrain()` (`src/terrain.mjs`) → `extras/terrain.json` (4 m heightfield) and `ground` on
  every building (Level 1 in metres above sea level), plus `grounds` per polygon for plan-less
  buildings that are several separate structures. `overrides: { CODE: metres }` sets one by hand.
- Polygon booleans go through `src/clip.mjs` (Clipper, mm integers).

## Scene conventions

- Local metres: x east, y north of the dataset origin. Scene is `(x, height, -y)`, heights
  relative to `terrain.ref` (ground at the origin). Storey = 4 m; level elevations come from the
  data (00 = -8, 0 = -4, 1 = 0, M = 2, 2 = 4, ...).
- Look: high-tech and monochrome, dark by default with a light mode (`THEMES` in `app/campus/theme.ts`;
  panels use a class-based `dark:` variant from `app/globals.css`). White buildings with edge
  lines, one accent (cyan) for hover and selection, rooms as outlines (stairs and lifts filled).
- The ground: the terrain mesh carries a texture with only the campus land (redrawn on a theme
  change); every other fill (roads, paths, forest, ...) is real geometry cut along the terrain's own
  triangles (`drapeGeometry`), so edges stay sharp at any zoom. The user rejected the texture-painted
  fills' jagged edges. On top: the layers' outlines as lines (`extras/groundLines.json`, unioned per
  group by `groundLines()`, so no seams) and a grid in the shader (spacing and angle in the theme).
  A separate footprint mask texture cuts holes under buildings in the terrain and the fills alike,
  so uphill ground can't poke through floor plans. Outlines lie exactly on the terrain too
  (`drapeLines`, cut at the terrain's triangle edges) and win over the fills by a depth bias
  (`nearer`), not by floating: the user found lifted lines off-putting.
- The map has an edge (`withClip`): a rounded rectangle just inside the terrain that ground, lines
  and buildings fade into the sky towards and are cut off beyond (`EDGE_INSET/RADIUS/FADE`).
- Shader tweaks chain through `onBeforeCompile` and each sets `customProgramCacheKey`, so variants
  don't share a compiled program.
- Each building is one mesh with two material groups: body (0) and foundation (1). It stands at
  `ground` + `PLINTH` (0.4 m); the foundation runs down below the lowest ground or level.
- Selecting a building shows its ground floor; a clipping plane cuts it at the shown floor
  (+ `CUT_SLACK`), with a cap, floor plate and rooms on top. When the cut is below the ground
  beside it, the pit walls are the building's inside wall faces (vertical only, `wallsOf`).
- A basement (a level below 1) reaching past the footprint (CLE's D wing under the plaza) is dug
  out while shown: its outline is added to the terrain's footprint mask (a separate alpha texture,
  so holes never bleed into the ground colours) and earth walls run from it up to the ground (`dig`).

## Decisions the user made (keep them)

- No visible seams between shapes. Outlines are unioned (Clipper) rather than drawn as abutting
  pieces; faint lines between rooms or blocks were rejected.
- Skyways must stay open underneath (Cornett, MacLaurin).
- Ground floors read as sitting slightly up on a solid foundation, never sunk.
- Level 1 sits at the **median** of the ground just outside the footprint. The 10th percentile
  sank McPherson; the 75th floated hillside buildings like David Turpin on tall foundations.
- David Turpin has a hand override (`DTB` in `config/sources.mjs`): the user placed Level 2
  at grade from a surveyed point. Prefer the median; override only where the DEM can't tell.
  15 more buildings were set by eye in the debug panel (Oct 2026); those overrides are the user's call.
- Buildings with floor plans are only as tall as their floors reach (massing), not the tallest
  part extruded across the whole footprint.
- No pits in roofs: an upper storey's holes are filled wherever the ground storey is under them.
  Courtyards over open ground (Clearihue, Cornett) stay open. Strips under 2 m wide are dropped
  from upper storeys.
- Flat roofs over gaps in the plans: a storey only steps in where the dropped piece is a real
  setback. Pieces the storey walls in on over 60% of their edge (wells, unmapped rooms) and
  slots under 8 m wide stay solid (ECS was two towers with a well between).
- A room whose name points to a building over 30 m away goes to the building it actually lies in
  (the source draws BEC's level-2 corridors as BWC rooms).

## Checking changes in the browser

The user runs `next dev` on http://localhost:3000; use that rather than starting another server.
A view link restores camera, selected building and floor:
`http://localhost:3000/#view=camX,camY,camElev,tgtX,tgtY,tgtElev&b=CODE&l=LEVEL&r=ROOM` (local metres,
elevations above sea level). Open the debug panel to read coordinates, then **Copy link** or
**Copy report**. The user will paste reports from it when filing issues.

With a building selected, the panel can move it up or down (live preview, kept in localStorage).
**Copy adjustments** gives `CODE: metres` lines for `terrain({ overrides })` in
`config/sources.mjs`; the user pastes them here to make them permanent (then rebuild the data).
The panel's theme editor (`theme-editor.tsx`) edits both themes live; colours are per theme, numbers
(grid strength, spacing and angle, selected room fill) apply to both; scene and lighting numbers are per theme. **Copy theme changes** gives `dark.areas.roads: "#.." -> "#.."`
lines for `THEMES` in `app/campus/theme.ts`.

Run `npx tsc --noEmit -p .` and `npx eslint app/campus` after changes.

## Open threads

- Only 33 of 106 buildings have floor plans; the rest are footprints at estimated heights.
- Floor plans have markers over the canvas (`addMarkers`): icons for washrooms (gender, accessible),
  elevators, stairs, food, AEDs, naloxone, showers, microwaves (`app/campus/icons.ts`), then room
  names and numbers. Ranked and decluttered every frame. Rooms are selectable (click on the shown
  floor, or search): highlighted, with their own info panel; `&r=CLE+A101` in a view link.
- Stairs and lifts (room type 4, `S3`/`L57` repeat across levels) get icons but aren't linked
  between levels yet.
- Info panels have an emergency section (`app/campus/emergency.tsx`): nearest AED, naloxone kit and
  emergency phone
  (map distance + 25 m per floor), each a link to it. No exits yet: UVic publishes no building
  entrance data (checked every web map layer and their ArcGIS org, Oct 2026); the user chose to
  skip exits rather than infer them.
- Parking lot names (`lots` layer) are labels on the ground; floor plan markers win where they collide.
- The lidar (Open Government Licence – Canada) needs an attribution line in the app before it's
  public; it's only in the data README so far.
- NRCan also publishes a 1 m surface model (DSM) in the same bucket: real building heights could
  come from it instead of the 4 m-per-storey estimate.
- Gaps in floor data now show as lower roof (unmapped space reads as missing storey).

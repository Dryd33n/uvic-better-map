// ─────────────────────────────────────────────────────────────────────────────
// uvic-campus-data · sources config
//
// This file is the one place you edit to change what the dataset contains.
// Add a layer, add a field, pull from your own GeoJSON, add an enricher or an
// output format: see docs/EXTENDING.md for recipes.
// ─────────────────────────────────────────────────────────────────────────────
import { washroomDetails, heightsFromFloors } from '../src/enrichers.mjs';

const ARCGIS = 'https://services2.arcgis.com/qRqOFxxnwUHOSocZ/arcgis/rest/services';
// Shorthand for an ArcGIS Online feature layer in UVic's org.
const agol = (service, layer = 0, extra = {}) => ({ type: 'arcgis', url: `${ARCGIS}/${encodeURIComponent(service)}/FeatureServer/${layer}`, ...extra });

export default {
  name: 'uvic-campus-data',
  source: {
    title: 'UVic General Web Map App (ArcGIS Online)',
    url: 'https://experience.arcgis.com/experience/3d2e1b22083940f59f5b6292870e1969',
    // The web map behind the app. `npm run audit` compares this config against it.
    webmap: 'ffc52085df27493395d7938d49f8bd5a',
  },

  // Local metric frame used by the `local` output (and handy for 3D).
  // x = metres east, y = metres north of this [lon, lat].
  origin: [-123.3117, 48.4634],

  // ── Outdoor layers ─────────────────────────────────────────────────────────
  // key      stable id used in file names and by the client (never rename casually)
  // kind     'area' (polygon) | 'building' (polygon, one per building) | 'line' | 'point' | 'label' (point used as a map label)
  // group    free-form grouping for UIs
  // source   where features come from (see loaders in src/loaders.mjs)
  // fields   output property -> source attribute | [fallbacks...] | (attrs, raw) => value | '*' to copy everything
  // id       optional (props, raw) => stable feature id (default: source object id)
  // filter   optional (feature) => boolean
  layers: [
    { key: 'boundary', label: 'Campus land', kind: 'area', group: 'base', source: agol('LegalArea_Training_3'), fields: { name: 'Name' } },
    { key: 'forest', label: 'Forest', kind: 'area', group: 'green', source: agol('Forest_Training_3'), fields: { name: 'Name' } },
    { key: 'fields', label: 'Sports fields', kind: 'area', group: 'green', source: agol('SportsFields_Training_3'), fields: { name: 'SportTitle', sport: 'SportType', code: 'SportCode' } },
    { key: 'fieldLines', label: 'Sport field lines', kind: 'line', group: 'green', source: agol('Sport_Field_Lines', 1), fields: {} },
    { key: 'roads', label: 'Roads', kind: 'area', group: 'transport', source: agol('Roads_Training_3'), fields: { name: ['RdName', 'RoadName'] } },
    { key: 'parking', label: 'General parking', kind: 'area', group: 'parking', source: agol('GeneralParking_Training_3'), fields: { name: 'Text' } },
    { key: 'reserved', label: 'Reserved parking', kind: 'area', group: 'parking', source: agol('ReservedParking_Training_3'), fields: { lot: 'LotNum' } },
    { key: 'shortParking', label: 'Short-term parking', kind: 'area', group: 'parking', source: agol('short_parking'), fields: {} },
    { key: 'walkways', label: 'Walkways', kind: 'area', group: 'paths', source: agol('Walkways_Training_3'), fields: {} },
    { key: 'paths', label: 'Paths', kind: 'area', group: 'paths', source: agol('Paths_Training_3'), fields: {} },
    { key: 'trails', label: 'Chip trails', kind: 'area', group: 'paths', source: agol('ChipTrails_Training_3'), fields: {} },
    { key: 'fountains', label: 'Fountains', kind: 'area', group: 'water', source: agol('Fountains_Training_3'), fields: {} },
    { key: 'construction', label: 'Construction', kind: 'area', group: 'base', source: agol('UVIC_ConstructionAreas'), fields: { name: 'Name', about: 'About' } },
    {
      key: 'buildings', label: 'Buildings', kind: 'building', group: 'buildings', source: agol('Buildings_Training_3'),
      fields: { name: ['disp_name', 'name'], fullName: 'name', code: 'BuildingCode', type: 'BuildingType', number: 'BuildingNumber', link: 'Link', photo: 'picture', about: 'text' },
      // Building ids are their codes (ECS, CLE...), falling back to the building number.
      id: (p, raw) => String(p.code || (p.number ? `N${p.number}` : `ID${raw.id}`)).toUpperCase().replace(/[^A-Z0-9-]/g, ''),
    },
    { key: 'wings', label: 'Building wings', kind: 'label', group: 'buildings', source: agol('Building_wings_feb', 1), fields: { name: 'name' } },
    { key: 'lots', label: 'Lot numbers', kind: 'label', group: 'parking', source: agol('Parking Lots'), fields: { name: 'lot_num' } },
    { key: 'food', label: 'Food', kind: 'point', group: 'amenities', source: agol('FoodOutlets_Training_3'), fields: { name: 'Name', building: 'Building', where: 'Location', about: 'discription' } },
    { key: 'microwaves', label: 'Microwaves', kind: 'point', group: 'amenities', source: agol('UVIC_Microwaves'), fields: { building: 'Building', level: 'Level_', where: 'Location' } },
    { key: 'showers', label: 'Showers', kind: 'point', group: 'amenities', source: agol('UVic_Showers_FM'), fields: { building: 'Building', level: 'Floor_Level', room: 'Room', about: 'Features' } },
    { key: 'aed', label: 'AEDs', kind: 'point', group: 'safety', source: agol('AED_uvic_feb'), fields: { building: 'Building', buildingNumber: 'BuildindNumber', level: 'Level_', where: 'Location' } }, // sic: source field is misspelled
    { key: 'naloxone', label: 'Naloxone kits', kind: 'point', group: 'safety', source: agol('Naloxone_uvic_feb'), fields: { building: 'Building', buildingNumber: 'BuildingNumber', level: 'Level_', where: 'Location' } },
    { key: 'phones', label: 'Emergency phones', kind: 'point', group: 'safety', source: agol('emergency_phone_feb'), fields: { link: 'Link' } },
    { key: 'smoking', label: 'Smoking areas', kind: 'point', group: 'safety', source: agol('uvic_smoking_areas'), fields: { substance: 'Substance' } },
    { key: 'bikes', label: 'Bike racks', kind: 'point', group: 'transport', source: agol('BikeRacks_Training_3'), fields: {} },
    { key: 'bikeCentre', label: 'Campus Bike Centre', kind: 'point', group: 'transport', source: agol('uvic_bike_centre'), fields: { name: 'Name', about: 'About', link: 'Link' } },
    { key: 'motorcycle', label: 'Motorcycle parking', kind: 'point', group: 'parking', source: agol('uvic_motorcycle_feb3'), fields: { lot: 'LotNum' } },
    { key: 'accessibleParking', label: 'Accessible parking', kind: 'point', group: 'parking', source: agol('uvic_handicap_parking_cm'), fields: { lot: 'LotNum' } },
    { key: 'ev', label: 'EV charging', kind: 'point', group: 'transport', source: agol('uvic_ev_charging_feb'), fields: { lot: 'LotNum' } },
    { key: 'atms', label: 'ATMs', kind: 'point', group: 'amenities', source: agol('ATMs_uvic'), fields: { bank: 'bank' } },
    { key: 'bus', label: 'Bus stops', kind: 'point', group: 'transport', source: agol('Bus_Stops_feb'), fields: {} },
    { key: 'access', label: 'Accessibility', kind: 'point', group: 'amenities', source: agol('Accessibility_Training_3'), fields: { kind: 'Kind', about: 'Notes' } },
    { key: 'elevators', label: 'Elevators and lifts', kind: 'point', group: 'amenities', source: agol('Elevators_mar_cm'), fields: { category: 'Category', building: 'Building', access: 'Avaliability', number: 'FMNumber' } }, // sic
    { key: 'washrooms', label: 'Washrooms', kind: 'point', group: 'amenities', source: agol('UVIC_Washrooms_cm'), fields: { building: 'Building', level: 'Level_', room: (a) => String(a.Room || '').replace(/\s+/g, ' ').trim() || undefined, gender: 'Gender', access: 'Accessibility', features: 'Features' } },

    // Your own data works the same way. Uncomment to add a layer from a local GeoJSON file:
    // { key: 'study-spots', label: 'Study spots', kind: 'point', group: 'amenities',
    //   source: { type: 'geojson', file: '../my-data/study-spots.geojson' }, fields: '*' },
  ],

  // ── Indoor floor plans ─────────────────────────────────────────────────────
  // Each level is a polygon layer of rooms. Rooms are assigned to a building of
  // `indoor.buildingsLayer` by: the code at the start of the room name (ECS 125 → ECS),
  // then the footprint that contains the room, then the building-name attribute.
  indoor: {
    buildingsLayer: 'buildings',
    storey: 4, // metres per storey; the source's own *_3d layers use 4
    levels: [
      { id: '00', label: 'Level 00', elev: -8, source: agol('level00_uvic') },
      { id: '0', label: 'Level 0', elev: -4, source: agol('level0_uvic') },
      { id: '1', label: 'Level 1', elev: 0, source: agol('level1_2_uvic') }, // "1_2" is Level 1 in the source
      { id: 'M', label: 'Mezzanine', elev: 2, source: agol('levelm_uvic') },
      { id: '2', label: 'Level 2', elev: 4, source: agol('level2_uvic') },
      { id: '3', label: 'Level 3', elev: 8, source: agol('level3_uvic') },
      { id: '4', label: 'Level 4', elev: 12, source: agol('level4_uvic') },
      { id: '5', label: 'Level 5', elev: 16, source: agol('level5_uvic') },
      { id: '6', label: 'Level 6', elev: 20, source: agol('level6_uvic') },
    ],
    fields: {
      name: (a) => String(a.dispname || a.disp_name_temp || '').replace(/\s+/g, ' ').trim() || undefined,
      type: (a) => (a.type == null ? undefined : Number(a.type)),
      label: 'temp',
      note: 'Notables',
      link: (a) => { const l = String(a.Link ?? a.Links ?? '').trim(); return /^https?:/i.test(l) ? l : undefined; },
      buildingName: ['Building', 'Buildings'],
    },
    // From the source web map's legend for the `type` field.
    roomTypes: { 0: 'Corridor', 1: 'Classroom', 2: 'Washroom', 3: 'Food service', 4: 'Stair or lift', 5: 'Other' },
    codePattern: /^([A-Za-z]{2,6})[\s_-]/,
  },

  // ── Enrichers ──────────────────────────────────────────────────────────────
  // Functions run after everything is loaded. They can add fields, join other
  // sources, or attach extra datasets. Write your own: (dataset, ctx) => void.
  enrich: [
    washroomDetails({ source: agol('UVIC_Washrooms_cm'), roomField: 'Room', fields: { gender: 'Gender', access: 'Accessibility', features: 'Features' } }),
    heightsFromFloors({ roof: 0.5 }),
  ],

  // ── Audit ──────────────────────────────────────────────────────────────────
  // Source fields `npm run audit` should not flag. Checked by hand (Oct 2026): these hold the
  // same value on every row, are always empty, or repeat the geometry.
  audit: {
    ignoreFields: [
      'Item',                  // constant per layer: "Microwave", "AED", "Naloxone", "Parking"
      'Latitude', 'Longitude', // duplicates of the point geometry
      'Owner',                 // roads: always empty
      'Field',                 // naloxone: always empty
    ],
  },

  // ── Output ─────────────────────────────────────────────────────────────────
  output: {
    dir: 'dist',
    // 'geojson' = standard WGS84 GeoJSON per layer and per building floor plan
    // 'local'   = compact metre coordinates for 3D (what templates/three-viewer reads)
    // Add your own writer function here too, see docs/EXTENDING.md.
    formats: ['geojson', 'local'],
    precision: { lngLat: 7, metres: 1 },
  },
};

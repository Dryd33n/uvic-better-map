// Build-side API. Import this to run the pipeline from your own code:
//   import { buildDataset, renderOutputs } from 'uvic-campus-data';
// For reading a built dataset in an app, use 'uvic-campus-data/client' instead.
export { buildDataset, makeFeature, mapFields, cleanValue, featuresOf, normName, normRoom } from './pipeline.mjs';
export { renderOutputs, SCHEMA_VERSION } from './output.mjs';
export { loaders, loadSource } from './loaders.mjs';
export { writers, toGeoJSONFeature, toGeoJSONGeometry, toLocalFeature, toLocalRoom, roomIndex } from './writers.mjs';
export { joinByField, computeField, washroomDetails, heightsFromFloors } from './enrichers.mjs';
export { validateDataset } from './validate.mjs';
export { auditAgainstWebmap } from './audit.mjs';
export * as geometry from './geometry.mjs';

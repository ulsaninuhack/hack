import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN_INFERENCE_KEYS = new Set([
  'beneficiary',
  'beneficiary_id',
  'beneficiary_status',
  'inferred_beneficiary',
  'unserved',
  'unserved_count',
  'unserved_person_count',
  'non_recipient',
  'non_recipient_count',
  'care_gap',
  'care_gap_score',
  'potential_care_gap',
  'isolation_risk_score',
  'risk_score',
  'priority_score',
  'solitary_death_risk_score',
]);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertFeatureCollection(value, label) {
  assertObject(value, label);
  if (value.type !== 'FeatureCollection' || !Array.isArray(value.features)) {
    throw new Error(`${label} must be a GeoJSON FeatureCollection`);
  }
}

function assertUniqueFeatureKey(collection, propertyName, label) {
  const seen = new Set();
  for (const feature of collection.features) {
    const value = feature?.properties?.[propertyName];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${label} has a missing ${propertyName}`);
    }
    if (seen.has(value)) {
      throw new Error(`${label} has duplicate ${propertyName}: ${value}`);
    }
    seen.add(value);
  }
}

function assertNoInferenceFields(value, location = 'dataset') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoInferenceFields(item, `${location}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_INFERENCE_KEYS.has(key.toLowerCase())) {
      throw new Error(`Forbidden inferred field in ${location}: ${key}`);
    }
    assertNoInferenceFields(child, `${location}.${key}`);
  }
}

function sortedUnique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]
    .sort((left, right) => left.localeCompare(right, 'ko'));
}

export function createDataStore({ summary, zones, facilities, transit, validation }) {
  assertObject(summary, 'summary');
  assertObject(validation, 'validation');
  assertFeatureCollection(zones, 'zones');
  assertFeatureCollection(facilities, 'facilities');
  assertFeatureCollection(transit, 'transit');

  if (summary.schemaVersion !== 1) {
    throw new Error(`Unsupported summary schemaVersion: ${summary.schemaVersion}`);
  }
  if (validation.status !== 'pass') {
    throw new Error(`Curated data validation status is not pass: ${validation.status}`);
  }
  if (validation.checks && Object.values(validation.checks).some((result) => result !== true)) {
    throw new Error('Curated data contains a failed validation check');
  }

  assertUniqueFeatureKey(zones, 'geometry_zone_id', 'zones');
  assertUniqueFeatureKey(facilities, 'facility_id', 'facilities');
  assertUniqueFeatureKey(transit, 'place_id', 'transit');

  assertNoInferenceFields(summary, 'summary');
  assertNoInferenceFields(zones, 'zones');
  assertNoInferenceFields(facilities, 'facilities');
  assertNoInferenceFields(transit, 'transit');

  const zoneById = new Map(
    zones.features.map((feature) => [feature.properties.geometry_zone_id, feature]),
  );

  return Object.freeze({
    summary,
    validation,
    zones,
    facilities,
    transit,
    zoneById,
    options: Object.freeze({
      zoneDistricts: sortedUnique(
        zones.features.map((feature) => feature.properties.current_district_name_20260701),
      ),
      facilityDistricts: sortedUnique(
        facilities.features.map((feature) => feature.properties.district_scope_20260701),
      ),
      facilityCategories: sortedUnique(
        facilities.features.map((feature) => feature.properties.category_major),
      ),
      transitDistricts: sortedUnique(
        transit.features.map((feature) => feature.properties.district),
      ),
    }),
  });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

export async function loadDataStore(dataDirectory = process.env.DATA_DIR) {
  const defaultDirectory = fileURLToPath(new URL('../../public/data/', import.meta.url));
  const resolvedDirectory = path.resolve(dataDirectory || defaultDirectory);

  const [summary, zones, facilities, transit, validation] = await Promise.all([
    readJson(path.join(resolvedDirectory, 'summary.json')),
    readJson(path.join(resolvedDirectory, 'admin-dongs.geojson')),
    readJson(path.join(resolvedDirectory, 'facilities.geojson')),
    readJson(path.join(resolvedDirectory, 'transit-stops.geojson')),
    readJson(path.join(resolvedDirectory, 'validation.json')),
  ]);

  return createDataStore({ summary, zones, facilities, transit, validation });
}

export { FORBIDDEN_INFERENCE_KEYS };

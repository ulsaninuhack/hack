import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { createDataStore, FORBIDDEN_INFERENCE_KEYS, loadDataStore } from '../src/data-store.mjs';

function featureCollection(propertyName, values) {
  return {
    type: 'FeatureCollection',
    features: values.map((value, index) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [126.5 + index / 100, 37.5] },
      properties: {
        [propertyName]: value,
        current_district_name_20260701: index ? '부평구' : '제물포구',
        district_scope_20260701: index ? '부평구' : '제물포구',
        category_major: index ? '노인복지' : '지역복지',
        district: index ? '부평구' : '제물포구',
      },
    })),
  };
}

function validInput() {
  return {
    summary: { schemaVersion: 1 },
    zones: featureCollection('geometry_zone_id', ['zone:b', 'zone:a']),
    facilities: featureCollection('facility_id', ['fac:b', 'fac:a']),
    transit: featureCollection('place_id', ['bus:b', 'bus:a']),
    validation: { status: 'pass', checks: { one: true } },
  };
}

describe('curated data store startup validation', () => {
  test('indexes zones and derives endpoint allowlists', () => {
    const store = createDataStore(validInput());

    assert.equal(store.zoneById.get('zone:a').properties.geometry_zone_id, 'zone:a');
    assert.deepEqual(store.options.facilityCategories, ['노인복지', '지역복지']);
    assert.deepEqual(store.options.transitDistricts, ['부평구', '제물포구']);
  });

  test('loads and verifies the actual curated web export', async () => {
    const store = await loadDataStore();

    assert.equal(store.validation.status, 'pass');
    assert.equal(store.zones.features.length, 156);
    assert.equal(store.facilities.features.length, 3_061);
    assert.equal(store.transit.features.length, 6_231);
  });

  test('rejects unsupported schemas and failed validation', () => {
    const schema = validInput();
    schema.summary.schemaVersion = 2;
    assert.throws(() => createDataStore(schema), /Unsupported summary/);

    const status = validInput();
    status.validation.status = 'failed';
    assert.throws(() => createDataStore(status), /status is not pass/);

    const checks = validInput();
    checks.validation.checks.one = false;
    assert.throws(() => createDataStore(checks), /failed validation check/);
  });

  test('rejects malformed feature collections and missing or duplicate IDs', () => {
    const malformed = validInput();
    malformed.zones = { type: 'FeatureCollection', features: null };
    assert.throws(() => createDataStore(malformed), /GeoJSON FeatureCollection/);

    const missing = validInput();
    delete missing.facilities.features[0].properties.facility_id;
    assert.throws(() => createDataStore(missing), /missing facility_id/);

    const duplicate = validInput();
    duplicate.transit.features[1].properties.place_id = 'bus:b';
    assert.throws(() => createDataStore(duplicate), /duplicate place_id/);
  });

  test('refuses future data exports containing inferred-person fields', () => {
    for (const field of FORBIDDEN_INFERENCE_KEYS) {
      const input = validInput();
      input.zones.features[0].properties[field] = 99;
      assert.throws(() => createDataStore(input), /Forbidden inferred field/, field);
    }
  });

  test('rejects non-object top-level documents', () => {
    const summary = validInput();
    summary.summary = null;
    assert.throws(() => createDataStore(summary), /summary must be a JSON object/);

    const validation = validInput();
    validation.validation = [];
    assert.throws(() => createDataStore(validation), /validation must be a JSON object/);
  });
});

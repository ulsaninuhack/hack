import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import {
  buildStructuralContextDataset,
  calculateMidrankPercentiles,
  toContactTriageDongContext,
} from '../src/structural-context.mjs';

const FOUR_INDICATORS = 4;
const MAX_PER_INDICATOR = 12.5;

function zoneFeature({
  id,
  codes,
  population = 100,
  older = 20,
  households = 50,
  onePerson = 10,
  residentialValid = 20,
  residentialOld = 5,
}) {
  return {
    type: 'Feature',
    geometry: null,
    properties: {
      geometry_zone_id: id,
      geometry_base_date: '20250630',
      current_admin_reference_date: '20260701',
      current_admin_dong_codes_20260701: codes,
      current_admin_dong_names_20260701: codes.map((code) => `동-${code}`),
      current_admin_dong_count: codes.length,
      population_reference_date: '2026-06-30',
      household_reference_date: '2026-07-31',
      total_population: population,
      population_age_65_plus: older,
      total_households: households,
      one_person_households: onePerson,
      housing_residential_age_valid_records: residentialValid,
      housing_residential_age_30_plus_records: residentialOld,
      housing_age_data_as_of_date: '2026-08-05',
    },
  };
}

function welfareRow(code, olderLiving, assignable = true) {
  return {
    admin_dong_code_20260701: code,
    source_reference_date: '2024-12-31',
    mapping_status: assignable ? 'one_to_one_mapped' : 'one_to_many_split_unresolved',
    source_values_assignable_to_current_dong: assignable ? 'True' : 'False',
    recipient_count_living_age_65_plus: assignable ? String(olderLiving) : '',
  };
}

function buildFixture(zones, welfareRows) {
  return buildStructuralContextDataset({
    zones: { type: 'FeatureCollection', features: zones },
    welfareRows,
  });
}

describe('P7 frozen midrank percentile', () => {
  test('uses the frozen tie formula and excludes missing values from n', () => {
    const ranked = calculateMidrankPercentiles([
      { id: 'low', value: 1 },
      { id: 'tie-a', value: 2 },
      { id: 'tie-b', value: 2 },
      { id: 'high', value: 4 },
      { id: 'missing', value: null },
    ]);

    assert.equal(ranked.get('low').percentile_rank, 0);
    assert.equal(ranked.get('tie-a').percentile_rank, 0.5);
    assert.equal(ranked.get('tie-b').percentile_rank, 0.5);
    assert.equal(ranked.get('high').percentile_rank, 1);
    assert.deepEqual(ranked.get('missing'), {
      percentile_rank: null,
      comparable_geography_count: 4,
      missing: true,
    });
  });

  test('assigns the frozen 0.5 rank when only one value is observed', () => {
    const ranked = calculateMidrankPercentiles([
      { id: 'only', value: 7 },
      { id: 'missing', value: null },
    ]);

    assert.equal(ranked.get('only').percentile_rank, 0.5);
    assert.equal(ranked.get('only').comparable_geography_count, 1);
  });

  test('rejects malformed entries, duplicate IDs, and invalid observations', () => {
    assert.throws(() => calculateMidrankPercentiles(null), /entries must be an array/);
    assert.throws(() => calculateMidrankPercentiles([null]), /must have an id/);
    assert.throws(
      () => calculateMidrankPercentiles([{ id: '', value: 1 }]),
      /must have an id/,
    );
    assert.throws(
      () => calculateMidrankPercentiles([{ id: 'same', value: 1 }, { id: 'same', value: 2 }]),
      /duplicate rank entry id/,
    );
    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      assert.throws(
        () => calculateMidrankPercentiles([{ id: 'invalid', value }]),
        /finite non-negative numbers or null/,
      );
    }
  });
});

describe('P7 public structural context contract', () => {
  test('keeps all four equal 12.5 maxima and exposes raw evidence', () => {
    const dataset = buildFixture(
      [
        zoneFeature({ id: 'zone-low', codes: ['0000000001'], older: 10, onePerson: 5, residentialOld: 2 }),
        zoneFeature({ id: 'zone-high', codes: ['0000000002'], older: 40, onePerson: 25, residentialOld: 16 }),
      ],
      [welfareRow('0000000001', 1), welfareRow('0000000002', 12)],
    );

    const high = dataset.zones.find((zone) => zone.geometry_zone_id === 'zone-high');
    assert.equal(dataset.model_output_label, '[MODEL OUTPUT — UNVALIDATED]');
    assert.equal(dataset.indicator_count, FOUR_INDICATORS);
    assert.equal(high.score_0_50, 50);
    assert.equal(high.available_score_denominator, 50);
    assert.equal(high.completeness.available_indicator_count, FOUR_INDICATORS);
    assert.equal(high.completeness.ratio, 1);

    for (const indicator of Object.values(high.indicators)) {
      assert.equal(indicator.percentile_rank, 1);
      assert.equal(indicator.contribution, MAX_PER_INDICATOR);
      assert.equal(indicator.missing, false);
      assert.equal(typeof indicator.raw_value, 'number');
      assert.equal(typeof indicator.raw_numerator, 'number');
      assert.equal(typeof indicator.raw_denominator, 'number');
      assert.ok(indicator.reference_dates.numerator);
      assert.ok(indicator.reference_dates.denominator);
    }

    assert.equal(
      high.indicators.basic_livelihood_context_density.raw_value,
      12 / 40,
    );
    assert.deepEqual(
      high.indicators.basic_livelihood_context_density.reference_dates,
      { numerator: '2024-12-31', denominator: '2026-06-30' },
    );
    assert.equal(high.indicators.basic_livelihood_context_density.mixed_snapshot, true);
  });

  test('does not impute missing inputs and shows the available denominator', () => {
    const dataset = buildFixture(
      [
        zoneFeature({
          id: 'zone-complete',
          codes: ['0000000001'],
          residentialValid: 20,
          residentialOld: 10,
        }),
        zoneFeature({
          id: 'zone-missing',
          codes: ['0000000002'],
          residentialValid: 0,
          residentialOld: 0,
        }),
      ],
      [welfareRow('0000000001', 2), welfareRow('0000000002', 0, false)],
    );

    const missing = dataset.zones.find((zone) => zone.geometry_zone_id === 'zone-missing');
    // Both observed ratios are tied, so each receives the frozen 0.5 midrank.
    assert.equal(missing.score_0_50, 12.5);
    assert.equal(missing.available_score_denominator, 25);
    assert.deepEqual(missing.completeness, {
      available_indicator_count: 2,
      total_indicator_count: FOUR_INDICATORS,
      ratio: 0.5,
    });

    assert.deepEqual(missing.indicators.residential_building_30_plus_share, {
      code: 'residential_building_30_plus_share',
      label_ko: '30년 이상 주거용 건축물대장 레코드 비율',
      raw_value: null,
      raw_unit: 'ratio',
      raw_numerator: 0,
      raw_denominator: 0,
      percentile_rank: null,
      comparable_geography_count: 1,
      contribution: 0,
      maximum_contribution: MAX_PER_INDICATOR,
      missing: true,
      missing_reason: 'denominator_not_positive',
      reference_dates: { numerator: '2026-08-05', denominator: '2026-08-05' },
      mixed_snapshot: false,
    });
    assert.equal(missing.indicators.basic_livelihood_context_density.raw_value, null);
    assert.equal(missing.indicators.basic_livelihood_context_density.contribution, 0);
    assert.equal(
      missing.indicators.basic_livelihood_context_density.missing_reason,
      'welfare_current_dong_split_unresolved',
    );
  });

  test('rolls all current dongs into their real geometry zone without averaging ratios', () => {
    const dataset = buildFixture(
      [
        zoneFeature({ id: 'zone-aggregate', codes: ['0000000001', '0000000002'], older: 40 }),
        zoneFeature({ id: 'zone-other', codes: ['0000000003'], older: 20 }),
      ],
      [
        welfareRow('0000000001', 3),
        welfareRow('0000000002', 5),
        welfareRow('0000000003', 2),
      ],
    );

    const aggregate = dataset.zones.find((zone) => zone.geometry_zone_id === 'zone-aggregate');
    assert.equal(aggregate.current_admin_dong_count, 2);
    assert.deepEqual(aggregate.current_admin_dong_codes_20260701, ['0000000001', '0000000002']);
    assert.equal(aggregate.indicators.basic_livelihood_context_density.raw_numerator, 8);
    assert.equal(aggregate.indicators.basic_livelihood_context_density.raw_denominator, 40);
    assert.equal(aggregate.indicators.basic_livelihood_context_density.raw_value, 0.2);
  });

  test('provides a narrow adapter seam for the existing triage contract', () => {
    const dataset = buildFixture(
      [zoneFeature({ id: 'zone-only', codes: ['0000000001'] })],
      [welfareRow('0000000001', 2)],
    );

    const context = toContactTriageDongContext(dataset.zones[0], '0000000001');
    assert.deepEqual(Object.keys(context).sort(), [
      '기여내역',
      '기준일_메모',
      '점수',
      '지도구역_id',
      '현행_행정동_코드_20260701',
    ].sort());
    assert.equal(context.점수, 25);
    assert.deepEqual(context.기여내역.map(({ 코드 }) => 코드), [
      '고령비율',
      '1인가구비율',
      '노후주택',
      '기초수급_밀도',
    ]);
    assert.equal(context.기여내역.every(({ 출처 }) => 출처 === '공개_동단위_집계'), true);

    assert.throws(() => toContactTriageDongContext(null, '0000000001'), /zone must be an object/);
    assert.throws(
      () => toContactTriageDongContext(dataset.zones[0], '0000000002'),
      /does not belong to geometry zone/,
    );
  });

  test('accepts numeric source counts and marks a missing or malformed welfare count', () => {
    const numeric = buildFixture(
      [zoneFeature({ id: 'zone-numeric', codes: ['0000000001'] })],
      [{
        ...welfareRow('0000000001', 0),
        source_values_assignable_to_current_dong: true,
        recipient_count_living_age_65_plus: 2,
      }],
    );
    assert.equal(numeric.zones[0].indicators.basic_livelihood_context_density.raw_value, 0.1);

    for (const badCount of ['', '-1', 1.5]) {
      const missing = buildFixture(
        [zoneFeature({ id: `zone-missing-${String(badCount)}`, codes: ['0000000001'] })],
        [{ ...welfareRow('0000000001', 0), recipient_count_living_age_65_plus: badCount }],
      );
      assert.equal(missing.zones[0].indicators.basic_livelihood_context_density.raw_value, null);
      assert.equal(
        missing.zones[0].indicators.basic_livelihood_context_density.missing_reason,
        'living_benefit_age_65_plus_count_missing',
      );
    }
  });

  test('rejects inconsistent source dates instead of silently merging them', () => {
    assert.throws(() => buildFixture(
      [zoneFeature({ id: 'zone-date', codes: ['0000000001', '0000000002'] })],
      [
        welfareRow('0000000001', 1),
        { ...welfareRow('0000000002', 1), source_reference_date: '2023-12-31' },
      ],
    ), /source reference dates must match/);
  });

  test('fails visibly on malformed geography and duplicate mappings', () => {
    const validZone = zoneFeature({ id: 'zone-valid', codes: ['0000000001'] });
    const validWelfare = [welfareRow('0000000001', 1)];

    for (const zones of [null, {}, { type: 'FeatureCollection', features: null }]) {
      assert.throws(
        () => buildStructuralContextDataset({ zones, welfareRows: [] }),
        /GeoJSON FeatureCollection/,
      );
    }
    assert.throws(
      () => buildStructuralContextDataset({
        zones: { type: 'FeatureCollection', features: [] },
        welfareRows: null,
      }),
      /welfareRows must be an array/,
    );
    assert.throws(
      () => buildFixture([validZone], [{ admin_dong_code_20260701: 'bad' }]),
      /welfare current dong code must be 10 digits/,
    );
    assert.throws(
      () => buildFixture([validZone], [...validWelfare, ...validWelfare]),
      /duplicate welfare current dong code/,
    );

    assert.throws(() => buildFixture([{ type: 'Feature', properties: null }], []), /must have properties/);
    assert.throws(
      () => buildFixture([{ ...validZone, properties: { ...validZone.properties, geometry_zone_id: '' } }], validWelfare),
      /geometry_zone_id must be a non-empty string/,
    );
    assert.throws(
      () => buildFixture([{ ...validZone, properties: { ...validZone.properties, current_admin_dong_codes_20260701: [] } }], validWelfare),
      /must be a non-empty array/,
    );
    assert.throws(
      () => buildFixture([{ ...validZone, properties: { ...validZone.properties, current_admin_dong_codes_20260701: ['bad'] } }], []),
      /must contain 10 digits/,
    );
    assert.throws(
      () => buildFixture([{ ...validZone, properties: { ...validZone.properties, current_admin_dong_codes_20260701: ['0000000001', '0000000001'] } }], validWelfare),
      /must be unique within a zone/,
    );

    assert.throws(
      () => buildFixture([
        validZone,
        zoneFeature({ id: 'zone-valid', codes: ['0000000002'] }),
      ], [validWelfare[0], welfareRow('0000000002', 1)]),
      /geometry_zone_id values must be unique/,
    );
    assert.throws(
      () => buildFixture([
        validZone,
        zoneFeature({ id: 'zone-second', codes: ['0000000001'] }),
      ], validWelfare),
      /current admin dong may map to only one geometry zone/,
    );
  });

  test('uses explicit missing reasons without inventing values', () => {
    const invalidInputs = zoneFeature({
      id: 'zone-invalid-inputs',
      codes: ['0000000001'],
      population: 0,
      older: -1,
      households: 0,
      onePerson: -1,
    });
    delete invalidInputs.properties.current_admin_dong_names_20260701;
    delete invalidInputs.properties.geometry_base_date;
    delete invalidInputs.properties.current_admin_reference_date;
    delete invalidInputs.properties.population_reference_date;
    delete invalidInputs.properties.household_reference_date;
    delete invalidInputs.properties.housing_age_data_as_of_date;

    const dataset = buildFixture([invalidInputs], [welfareRow('0000000001', 1)]);
    const zone = dataset.zones[0];
    assert.deepEqual(zone.current_admin_dong_names_20260701, []);
    assert.equal(zone.geometry_base_date, '20250630');
    assert.equal(zone.current_admin_reference_date, '20260701');
    assert.equal(zone.indicators.older_population_share.raw_denominator, 0);
    assert.equal(zone.indicators.older_population_share.raw_numerator, null);
    assert.equal(zone.indicators.older_population_share.missing_reason, 'denominator_not_positive');
    assert.equal(zone.indicators.one_person_household_share.missing_reason, 'denominator_not_positive');
    assert.equal(zone.indicators.basic_livelihood_context_density.raw_denominator, null);
  });

  test('marks a missing welfare row as unresolved instead of imputing it', () => {
    const dataset = buildFixture(
      [zoneFeature({ id: 'zone-no-welfare', codes: ['0000000001'] })],
      [],
    );
    const indicator = dataset.zones[0].indicators.basic_livelihood_context_density;
    assert.equal(indicator.raw_value, null);
    assert.equal(indicator.missing_reason, 'welfare_current_dong_split_unresolved');
  });
});

describe('P7 actual data regression', () => {
  test('preserves the actual 162 current dongs mapped to 156 zones', async () => {
    const dataset = JSON.parse(await readFile(
      new URL('../../public/data/structural-context.json', import.meta.url),
      'utf8',
    ));

    assert.equal(dataset.zone_count, 156);
    assert.equal(dataset.current_admin_dong_count, 162);
    assert.equal(dataset.zones.length, 156);
    assert.equal(new Set(dataset.zones.map((zone) => zone.geometry_zone_id)).size, 156);
    assert.equal(
      new Set(dataset.zones.flatMap((zone) => zone.current_admin_dong_codes_20260701)).size,
      162,
    );
    assert.equal(dataset.source_validation.map_data_status, 'pass');
    assert.equal(dataset.source_validation.welfare_current_dongs, 162);
    assert.equal(dataset.source_validation.welfare_assignable_current_dongs, 158);

    const unresolved = dataset.zones.filter(
      (zone) => zone.indicators.basic_livelihood_context_density.missing,
    );
    assert.equal(unresolved.length, 2);
    assert.equal(unresolved.every((zone) => (
      zone.indicators.basic_livelihood_context_density.contribution === 0
    )), true);
  });
});

const MODEL_OUTPUT_LABEL = '[MODEL OUTPUT — UNVALIDATED]';
const MAXIMUM_CONTRIBUTION = 12.5;

const INDICATOR_DEFINITIONS = Object.freeze([
  Object.freeze({
    code: 'older_population_share',
    triageCode: '고령비율',
    labelKo: '65세 이상 인구 비율',
  }),
  Object.freeze({
    code: 'one_person_household_share',
    triageCode: '1인가구비율',
    labelKo: '1인세대 비율',
  }),
  Object.freeze({
    code: 'residential_building_30_plus_share',
    triageCode: '노후주택',
    labelKo: '30년 이상 주거용 건축물대장 레코드 비율',
  }),
  Object.freeze({
    code: 'basic_livelihood_context_density',
    triageCode: '기초수급_밀도',
    labelKo: '65세 이상 인구 대비 생계급여 자격 65세 이상 건수 맥락 밀도',
  }),
]);

function finiteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function ratioEvidence({
  code,
  labelKo,
  numerator,
  denominator,
  numeratorDate,
  denominatorDate,
  missingReason = null,
}) {
  const denominatorAvailable = finiteNonNegative(denominator) && denominator > 0;
  const numeratorAvailable = finiteNonNegative(numerator);
  const missing = missingReason !== null || !denominatorAvailable || !numeratorAvailable;

  return {
    code,
    label_ko: labelKo,
    raw_value: missing ? null : numerator / denominator,
    raw_unit: 'ratio',
    raw_numerator: numeratorAvailable ? numerator : null,
    raw_denominator: finiteNonNegative(denominator) ? denominator : null,
    percentile_rank: null,
    comparable_geography_count: 0,
    contribution: 0,
    maximum_contribution: MAXIMUM_CONTRIBUTION,
    missing,
    missing_reason: missing
      ? (missingReason || (!denominatorAvailable ? 'denominator_not_positive' : 'numerator_missing'))
      : null,
    reference_dates: {
      numerator: numeratorDate,
      denominator: denominatorDate,
    },
    mixed_snapshot: numeratorDate !== denominatorDate,
  };
}

function normalizeCodeList(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('current_admin_dong_codes_20260701 must be a non-empty array');
  }
  const codes = value.map(String);
  if (codes.some((code) => !/^\d{10}$/.test(code))) {
    throw new TypeError('current admin dong codes must contain 10 digits');
  }
  if (new Set(codes).size !== codes.length) {
    throw new TypeError('current admin dong codes must be unique within a zone');
  }
  return codes;
}

function parseWelfareCount(row) {
  const value = row?.recipient_count_living_age_65_plus;
  if (typeof value === 'number' && Number.isInteger(value) && finiteNonNegative(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function isWelfareAssignable(row) {
  return row?.source_values_assignable_to_current_dong === true
    || row?.source_values_assignable_to_current_dong === 'True';
}

function welfareEvidence(codes, welfareByCode, populationAge65Plus) {
  const rows = codes.map((code) => welfareByCode.get(code));
  if (rows.some((row) => !row || !isWelfareAssignable(row))) {
    return ratioEvidence({
      code: 'basic_livelihood_context_density',
      labelKo: INDICATOR_DEFINITIONS[3].labelKo,
      numerator: null,
      denominator: populationAge65Plus,
      numeratorDate: '2024-12-31',
      denominatorDate: '2026-06-30',
      missingReason: 'welfare_current_dong_split_unresolved',
    });
  }

  const counts = rows.map(parseWelfareCount);
  if (counts.some((count) => count === null)) {
    return ratioEvidence({
      code: 'basic_livelihood_context_density',
      labelKo: INDICATOR_DEFINITIONS[3].labelKo,
      numerator: null,
      denominator: populationAge65Plus,
      numeratorDate: rows[0]?.source_reference_date || '2024-12-31',
      denominatorDate: '2026-06-30',
      missingReason: 'living_benefit_age_65_plus_count_missing',
    });
  }

  const sourceDates = new Set(rows.map((row) => row.source_reference_date));
  if (sourceDates.size !== 1) {
    throw new Error('welfare source reference dates must match within a geometry zone');
  }

  return ratioEvidence({
    code: 'basic_livelihood_context_density',
    labelKo: INDICATOR_DEFINITIONS[3].labelKo,
    numerator: counts.reduce((sum, value) => sum + value, 0),
    denominator: populationAge65Plus,
    numeratorDate: rows[0].source_reference_date,
    denominatorDate: '2026-06-30',
  });
}

function zoneEvidence(feature, welfareByCode) {
  const properties = feature?.properties;
  if (!properties || typeof properties !== 'object') {
    throw new TypeError('zone feature must have properties');
  }
  if (typeof properties.geometry_zone_id !== 'string' || properties.geometry_zone_id.length === 0) {
    throw new TypeError('geometry_zone_id must be a non-empty string');
  }

  const codes = normalizeCodeList(properties.current_admin_dong_codes_20260701);
  const populationDate = properties.population_reference_date || '2026-06-30';
  const householdDate = properties.household_reference_date || '2026-07-31';
  const housingDate = properties.housing_age_data_as_of_date || null;

  return {
    geometry_zone_id: properties.geometry_zone_id,
    geometry_base_date: String(properties.geometry_base_date || '20250630'),
    current_admin_reference_date: String(properties.current_admin_reference_date || '20260701'),
    current_admin_dong_codes_20260701: codes,
    current_admin_dong_names_20260701: Array.isArray(properties.current_admin_dong_names_20260701)
      ? properties.current_admin_dong_names_20260701.map(String)
      : [],
    current_admin_dong_count: codes.length,
    score_0_50: 0,
    available_score_denominator: 0,
    completeness: null,
    indicators: {
      older_population_share: ratioEvidence({
        code: 'older_population_share',
        labelKo: INDICATOR_DEFINITIONS[0].labelKo,
        numerator: properties.population_age_65_plus,
        denominator: properties.total_population,
        numeratorDate: populationDate,
        denominatorDate: populationDate,
      }),
      one_person_household_share: ratioEvidence({
        code: 'one_person_household_share',
        labelKo: INDICATOR_DEFINITIONS[1].labelKo,
        numerator: properties.one_person_households,
        denominator: properties.total_households,
        numeratorDate: householdDate,
        denominatorDate: householdDate,
      }),
      residential_building_30_plus_share: ratioEvidence({
        code: 'residential_building_30_plus_share',
        labelKo: INDICATOR_DEFINITIONS[2].labelKo,
        numerator: properties.housing_residential_age_30_plus_records,
        denominator: properties.housing_residential_age_valid_records,
        numeratorDate: housingDate,
        denominatorDate: housingDate,
      }),
      basic_livelihood_context_density: welfareEvidence(
        codes,
        welfareByCode,
        properties.population_age_65_plus,
      ),
    },
  };
}

export function calculateMidrankPercentiles(entries) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  const ids = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new TypeError('each rank entry must have an id');
    }
    if (ids.has(entry.id)) throw new TypeError(`duplicate rank entry id: ${entry.id}`);
    ids.add(entry.id);
    if (entry.value !== null && !finiteNonNegative(entry.value)) {
      throw new TypeError('rank values must be finite non-negative numbers or null');
    }
  }

  const observed = entries.filter((entry) => entry.value !== null);
  const comparableCount = observed.length;
  const result = new Map();

  for (const entry of entries) {
    if (entry.value === null) {
      result.set(entry.id, {
        percentile_rank: null,
        comparable_geography_count: comparableCount,
        missing: true,
      });
      continue;
    }

    const lower = observed.filter((candidate) => candidate.value < entry.value).length;
    const equal = observed.filter((candidate) => candidate.value === entry.value).length;
    const percentile = comparableCount === 1
      ? 0.5
      : (lower + 0.5 * (equal - 1)) / (comparableCount - 1);
    result.set(entry.id, {
      percentile_rank: percentile,
      comparable_geography_count: comparableCount,
      missing: false,
    });
  }

  return result;
}

export function buildStructuralContextDataset({ zones, welfareRows, sourceValidation = {} }) {
  if (zones?.type !== 'FeatureCollection' || !Array.isArray(zones.features)) {
    throw new TypeError('zones must be a GeoJSON FeatureCollection');
  }
  if (!Array.isArray(welfareRows)) throw new TypeError('welfareRows must be an array');

  const welfareByCode = new Map();
  for (const row of welfareRows) {
    const code = String(row?.admin_dong_code_20260701 || '');
    if (!/^\d{10}$/.test(code)) throw new TypeError('welfare current dong code must be 10 digits');
    if (welfareByCode.has(code)) throw new TypeError(`duplicate welfare current dong code: ${code}`);
    welfareByCode.set(code, row);
  }

  const outputZones = zones.features.map((feature) => zoneEvidence(feature, welfareByCode));
  if (new Set(outputZones.map((zone) => zone.geometry_zone_id)).size !== outputZones.length) {
    throw new TypeError('geometry_zone_id values must be unique');
  }
  const currentCodes = outputZones.flatMap((zone) => zone.current_admin_dong_codes_20260701);
  if (new Set(currentCodes).size !== currentCodes.length) {
    throw new TypeError('a current admin dong may map to only one geometry zone');
  }

  for (const definition of INDICATOR_DEFINITIONS) {
    const ranked = calculateMidrankPercentiles(outputZones.map((zone) => ({
      id: zone.geometry_zone_id,
      value: zone.indicators[definition.code].raw_value,
    })));
    for (const zone of outputZones) {
      const indicator = zone.indicators[definition.code];
      const rank = ranked.get(zone.geometry_zone_id);
      indicator.percentile_rank = rank.percentile_rank;
      indicator.comparable_geography_count = rank.comparable_geography_count;
      indicator.contribution = rank.percentile_rank === null
        ? 0
        : MAXIMUM_CONTRIBUTION * rank.percentile_rank;
    }
  }

  for (const zone of outputZones) {
    const indicators = Object.values(zone.indicators);
    const availableCount = indicators.filter((indicator) => !indicator.missing).length;
    zone.score_0_50 = indicators.reduce((sum, indicator) => sum + indicator.contribution, 0);
    zone.available_score_denominator = availableCount * MAXIMUM_CONTRIBUTION;
    zone.completeness = {
      available_indicator_count: availableCount,
      total_indicator_count: INDICATOR_DEFINITIONS.length,
      ratio: availableCount / INDICATOR_DEFINITIONS.length,
    };
  }

  return {
    schema_version: 'structural-context-p7-v1',
    model_output_label: MODEL_OUTPUT_LABEL,
    interpretation: '검증되지 않은 지역 구조 맥락 후보이며 개인 취약도나 확률이 아님',
    score_range: { minimum: 0, maximum: 50 },
    indicator_count: INDICATOR_DEFINITIONS.length,
    equal_maximum_contribution: MAXIMUM_CONTRIBUTION,
    rank_method: 'midrank_percentile_over_nonmissing_comparable_geography',
    rank_formula: '(count_lower + 0.5 * (count_equal - 1)) / (n - 1); n=1 -> 0.5',
    missing_policy: 'no_imputation_no_points',
    welfare_density_definition: 'recipient_count_living_age_65_plus / population_age_65_plus',
    welfare_guardrail: '생계급여 자격 건수만 사용하며 의료·주거·교육 급여와 합산하지 않음',
    welfare_mixed_snapshot_warning: '분자 2024-12-31, 분모 2026-06-30의 혼합 시점이며 동시점 비율이 아님',
    zone_count: outputZones.length,
    current_admin_dong_count: new Set(currentCodes).size,
    source_validation: sourceValidation,
    zones: outputZones,
  };
}

export function toContactTriageDongContext(zone, currentAdminDongCode) {
  if (!zone || typeof zone !== 'object') throw new TypeError('zone must be an object');
  if (!zone.current_admin_dong_codes_20260701?.includes(currentAdminDongCode)) {
    throw new Error('current admin dong code does not belong to geometry zone');
  }

  const byCode = new Map(INDICATOR_DEFINITIONS.map((definition) => [
    definition.triageCode,
    zone.indicators[definition.code],
  ]));

  return {
    지도구역_id: zone.geometry_zone_id,
    현행_행정동_코드_20260701: currentAdminDongCode,
    점수: zone.score_0_50,
    기준일_메모: `${MODEL_OUTPUT_LABEL}; 인구 2026-06-30; 세대 2026-07-31; 주택 2026-08-05; 생계급여 자격 2024-12-31/65세 이상 인구 2026-06-30 혼합 시점; 결측 무배점`,
    기여내역: [...byCode].map(([code, indicator]) => ({
      코드: code,
      가산점: indicator.contribution,
      출처: '공개_동단위_집계',
    })),
  };
}

export {
  INDICATOR_DEFINITIONS,
  MAXIMUM_CONTRIBUTION,
  MODEL_OUTPUT_LABEL,
};

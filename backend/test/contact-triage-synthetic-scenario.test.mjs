import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { createContactOpsService } from '../src/contact-ops-service.mjs';
import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';
import {
  buildDemoPrecontactSeedRecords,
  buildPublicStructuralContext,
  buildSyntheticScenarioInput,
  buildSyntheticScenarioTriage,
  prepareSyntheticScenarioOverlayRecords,
} from '../src/contact-triage-synthetic-scenario.mjs';

const OBSERVATION_KEYS = [
  '관찰_6징후',
  '식사상태',
  '위생상태',
  '공과금_2개월_이상_체납',
  '최근_건강_정신_괴로움',
  '관계망_유무',
  '연락_빈도',
];

const SIGN_KEYS = [
  '우편물_고지서_적체',
  '악취_벌레',
  '쓰레기_술병',
  '인기척_없이_TV_불',
  '외출_없음',
  '연락_두절',
];

const fixture = JSON.parse(await readFile(
  new URL('../../public/data/synthetic-households.json', import.meta.url),
  'utf8',
));
const structuralContext = JSON.parse(await readFile(
  new URL('../../public/data/structural-context.json', import.meta.url),
  'utf8',
));

function record(household, triage = null) {
  return {
    synthetic: true,
    revision: triage === null ? 0 : 1,
    household: structuredClone(household),
    observations: {},
    triage: structuredClone(triage),
  };
}

function groupHouseholdsByDong(households) {
  const groups = new Map();
  for (const household of households) {
    const dongCode = household.location.current_admin_dong_code_20260701;
    groups.set(dongCode, [...(groups.get(dongCode) ?? []), household]);
  }
  return groups;
}

describe('deterministic synthetic scenario overlay', () => {
  test('builds a deterministic pre-contact seed for all 162 dongs without mutating the 5,869-case fixture', () => {
    const householdsBefore = structuredClone(fixture.households);
    const contextBefore = structuredClone(structuralContext);

    const first = buildDemoPrecontactSeedRecords(
      fixture.households,
      fixture.scenario_reference_date,
      structuralContext,
    );
    const second = buildDemoPrecontactSeedRecords(
      fixture.households,
      fixture.scenario_reference_date,
      structuralContext,
    );

    assert.equal(fixture.households.length, 5_869);
    assert.equal(first.length, 162);
    assert.equal(new Set(first.map(
      ({ household }) => household.location.current_admin_dong_code_20260701,
    )).size, 162);
    assert.deepEqual(second, first);
    assert.deepEqual(fixture.households, householdsBefore);
    assert.deepEqual(structuralContext, contextBefore);
    assert.equal(first.every(({ revision, updated_at: updatedAt }) => (
      revision === 1
      && updatedAt === `${fixture.scenario_reference_date}T00:00:00.000Z`
    )), true);

    const sourceById = new Map(fixture.households.map((household) => [household.id, household]));
    assert.equal(first.every(({ household }) => (
      sourceById.has(household.id) && household !== sourceById.get(household.id)
    )), true);
  });

  test('pre-contact seeds contain populated demo evidence and recommendation only, never approval', () => {
    const seeds = buildDemoPrecontactSeedRecords(
      fixture.households,
      fixture.scenario_reference_date,
      structuralContext,
    );

    assert.equal(seeds.every(({ household, observations, triage }) => (
      triage.급성도_점수 >= 55
      && triage.방문_승인_상태 === '권고'
      && household.workflow.visit_approval_status === 'recommended'
      && household.workflow.visit_decision === null
      && household.approved_visit_constraints === null
      && !Object.hasOwn(household.workflow, 'approved_by')
      && triage.기록_출처 === 'demo_precontact_record'
      && triage.프로필_버전 === 'demo-precontact-v1'
      && Object.keys(observations).toSorted().join('|') === OBSERVATION_KEYS.toSorted().join('|')
      && Object.values(observations).every((value) => value !== null)
      && Object.keys(observations.관찰_6징후).toSorted().join('|') === SIGN_KEYS.toSorted().join('|')
      && Object.values(observations.관찰_6징후).every((value) => typeof value === 'boolean')
    )), true);
  });

  test('avoids the minimum case ID in every dong that has another recommendation-eligible case', () => {
    const seeds = buildDemoPrecontactSeedRecords(
      fixture.households,
      fixture.scenario_reference_date,
      structuralContext,
    );
    const seedByDong = new Map(seeds.map(({ household }) => [
      household.location.current_admin_dong_code_20260701,
      household,
    ]));

    for (const [dongCode, households] of groupHouseholdsByDong(fixture.households)) {
      const sorted = households.toSorted((left, right) => left.id.localeCompare(right.id));
      const minimumId = sorted[0].id;
      const eligibleNonMinimum = sorted.some((household) => (
        household.id !== minimumId
        && buildSyntheticScenarioTriage(
          household,
          fixture.scenario_reference_date,
          structuralContext,
        ).급성도_점수 >= 55
      ));
      if (eligibleNonMinimum) {
        assert.notEqual(seedByDong.get(dongCode).id, minimumId, dongCode);
      }
    }

    const sinpoSeed = seeds.find(
      ({ household }) => household.location.current_admin_dong_name_20260701 === '신포동',
    );
    assert.notEqual(sinpoSeed.household.id, 'SYN-HH-2812551000-0001');
  });

  test('keeps the live Sinpo 0001 score 62 as the operations maximum over the lowest-score bootstrap', async () => {
    const seeds = buildDemoPrecontactSeedRecords(
      fixture.households,
      fixture.scenario_reference_date,
      structuralContext,
    );
    const sinpoSeed = seeds.find(
      ({ household }) => household.location.current_admin_dong_name_20260701 === '신포동',
    );
    assert.equal(sinpoSeed.household.id, 'SYN-HH-2812551000-0004');
    assert.equal(sinpoSeed.triage.급성도_점수, 62);

    const state = createMemoryContactOpsState({
      households: fixture.households,
      initialRecords: seeds,
    });
    const service = createContactOpsService({
      state,
      structuralContext,
      scenarioReferenceDate: fixture.scenario_reference_date,
    });
    const recorded = await service.recordContactResult({
      sessionId: 'sinpo-operations-regression',
      caseId: 'SYN-HH-2812551000-0001',
      expectedRevision: 0,
      contactDate: fixture.scenario_reference_date,
      contactResult: 'no_answer',
      observations: {
        관찰_6징후: {
          우편물_고지서_적체: true,
          악취_벌레: false,
          쓰레기_술병: false,
          인기척_없이_TV_불: false,
          외출_없음: false,
          연락_두절: false,
        },
        식사상태: '심각',
        위생상태: null,
        공과금_2개월_이상_체납: null,
        최근_건강_정신_괴로움: null,
        관계망_유무: null,
        연락_빈도: null,
      },
    });
    assert.equal(recorded.triage.급성도_점수, 62);

    const operationsMap = await service.getOperationsMap({
      sessionId: 'sinpo-operations-regression',
    });
    const zone = operationsMap.zones.find(
      ({ geometry_zone_id: id }) => id === recorded.household.location.geometry_zone_id,
    );
    assert.equal(zone.operations.acute_color_metric, 62);
    assert.equal(zone.operations.acute_max_case_id, 'SYN-HH-2812551000-0001');
  });

  test('fails visibly when the public-address case or structural evidence is malformed', () => {
    const household = fixture.households[0];
    const zone = structuralContext.zones.find(
      (item) => item.geometry_zone_id === household.location.geometry_zone_id,
    );

    assert.throws(
      () => buildPublicStructuralContext({ ...household, synthetic: false }, structuralContext),
      /valid synthetic household/,
    );
    assert.throws(
      () => buildPublicStructuralContext(household, { ...structuralContext, zones: null }),
      /dataset is invalid/,
    );
    assert.throws(
      () => buildPublicStructuralContext(household, { ...structuralContext, zones: [] }),
      /missing structural context/,
    );
    assert.throws(
      () => buildPublicStructuralContext(household, {
        ...structuralContext,
        zones: structuralContext.zones.map((item) => item === zone ? {
          ...item,
          indicators: { ...item.indicators, older_population_share: null },
        } : item),
      }),
      /indicator is invalid: older_population_share/,
    );
  });

  test('injects the frozen public structural context before any phone result exists', () => {
    const household = fixture.households[0];
    const zone = structuralContext.zones.find(
      (item) => item.geometry_zone_id === household.location.geometry_zone_id,
    );
    const input = buildSyntheticScenarioInput(
      household,
      fixture.scenario_reference_date,
      structuralContext,
    );

    assert.equal(input.동단위_구조취약도.점수, zone.score_0_50);
    assert.deepEqual(
      input.동단위_구조취약도.기여내역,
      [
        ['고령비율', 'older_population_share'],
        ['1인가구비율', 'one_person_household_share'],
        ['노후주택', 'residential_building_30_plus_share'],
        ['기초수급_밀도', 'basic_livelihood_context_density'],
      ].map(([코드, sourceCode]) => ({
        코드,
        가산점: zone.indicators[sourceCode].contribution,
        출처: '공개_동단위_집계',
      })),
    );
    assert.match(input.동단위_구조취약도.기준일_메모, /MODEL OUTPUT — UNVALIDATED/);
    assert.equal(input.연속_미응답_횟수 >= 0, true);
  });

  test('scores the same synthetic case deterministically without mutating household workflow', () => {
    const household = fixture.households[0];
    const before = structuredClone(household);

    const first = buildSyntheticScenarioTriage(household, fixture.scenario_reference_date, structuralContext);
    const second = buildSyntheticScenarioTriage(household, fixture.scenario_reference_date, structuralContext);

    assert.deepEqual(first, second);
    assert.equal(Number.isInteger(first.급성도_점수), true);
    assert.equal(Number.isFinite(first.취약도_점수), true);
    assert.equal(first.점수_기여내역.every(({ 축 }) => ['급성도', '취약도'].includes(축)), true);
    assert.deepEqual(household, before);
    assert.equal(household.workflow.visit_approval_status, null);
    assert.equal(household.approved_visit_constraints, null);
  });

  test('selects one stable scenario example per current dong while preserving every session score', () => {
    const records = fixture.households.map((household) => record(household));
    const firstCase = fixture.households[0];
    const sessionTriage = { ...buildSyntheticScenarioTriage(firstCase, fixture.scenario_reference_date, structuralContext), 급성도_점수: 1 };
    records[0] = record(firstCase, sessionTriage);

    const projected = prepareSyntheticScenarioOverlayRecords(records, fixture.scenario_reference_date, structuralContext);
    const scenario = projected.filter(({ score_source }) => score_source === 'synthetic_scenario');
    const session = projected.filter(({ score_source }) => score_source === 'session_recorded');
    const scored = projected.filter(({ triage }) => triage !== null);

    assert.equal(session.length, 1);
    assert.deepEqual(session[0].triage, sessionTriage);
    assert.equal(new Set(scored.map(({ household }) => household.location.current_admin_dong_code_20260701)).size, 162);
    assert.equal(new Set(scored.map(({ household }) => household.location.geometry_zone_id)).size, 156);
    assert.equal(scenario.length + session.length >= 162, true);
    assert.equal(projected.length, 5_869);
    assert.equal(records.filter(({ triage }) => triage !== null).length, 1);
  });

  test('keeps the one-example-per-dong map distribution visible instead of saturating every zone', () => {
    const projected = prepareSyntheticScenarioOverlayRecords(
      fixture.households.map((household) => record(household)),
      fixture.scenario_reference_date,
      structuralContext,
    ).filter(({ triage }) => triage !== null);
    const byZone = new Map();
    for (const item of projected) {
      const current = byZone.get(item.household.location.geometry_zone_id) || { acute: 0, vulnerability: 0 };
      current.acute = Math.max(current.acute, item.triage.급성도_점수);
      current.vulnerability = Math.max(current.vulnerability, item.triage.취약도_점수);
      byZone.set(item.household.location.geometry_zone_id, current);
    }

    assert.equal(byZone.size, 156);
    assert.equal(new Set([...byZone.values()].map(({ acute }) => acute)).size >= 6, true);
    assert.equal(new Set([...byZone.values()].map(({ vulnerability }) => vulnerability)).size >= 3, true);
    assert.equal([...byZone.values()].every(({ acute, vulnerability }) => acute >= 0 && vulnerability >= 0), true);
  });

  test('fills all 156 actual map zones while leaving non-example tasks explicitly unrecorded', async () => {
    const service = createContactOpsService({
      state: createMemoryContactOpsState({ households: fixture.households }),
      structuralContext,
      scenarioReferenceDate: fixture.scenario_reference_date,
    });

    const result = await service.getOperationsMap({ sessionId: 'scenario-map-contract' });
    const operations = result.zones.map(({ operations: item }) => item);

    assert.equal(result.geometry_zone_count, 156);
    assert.equal(result.current_admin_dong_count, 162);
    assert.equal(operations.every(({ acute_color_metric: acute }) => Number.isInteger(acute)), true);
    assert.equal(operations.every(({ vulnerability_size_metric: vulnerability }) => Number.isFinite(vulnerability)), true);
    assert.equal(operations.reduce((sum, item) => sum + item.scenario_scored_case_count, 0), 162);
    assert.equal(operations.reduce((sum, item) => sum + item.session_scored_case_count, 0), 0);
    assert.equal(operations.reduce((sum, item) => sum + item.unscored_case_count, 0), 5_869 - 162);
    assert.equal(new Set(operations.map(({ acute_color_metric: acute }) => acute)).size >= 6, true);

    assert.equal(Array.isArray(result.visit_review_points), true);
    assert.equal(result.visit_review_points.length > 0, true);
    assert.equal(result.visit_review_points.some(({ apartment_reference: apartment }) => apartment), true);
    assert.equal(result.visit_review_points.every((point) => (
      point.synthetic === true
      && point.displayMarker === '[합성]'
      && point.not_real_resident === true
      && point.visit_approval_status === '권고'
      && ['synthetic_scenario', 'session_recorded'].includes(point.score_source)
      && ['방문권고', '방문권고-우선'].includes(point.급성도_등급)
      && Number.isFinite(point.급성도_점수)
      && Number.isFinite(point.취약도_점수)
      && Number.isFinite(point.longitude)
      && Number.isFinite(point.latitude)
      && point.road_address.startsWith('인천광역시 ')
      && typeof point.building_name === 'string'
      && typeof point.reference_pnu === 'string'
      && point.reference_pnu.length === 19
    )), true);

    const sorted = result.visit_review_points.toSorted((left, right) => (
      right.급성도_점수 - left.급성도_점수
      || right.취약도_점수 - left.취약도_점수
      || left.case_id.localeCompare(right.case_id)
    ));
    assert.deepEqual(result.visit_review_points, sorted);
  });
});

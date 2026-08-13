import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { createContactOpsService } from '../src/contact-ops-service.mjs';
import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';
import {
  buildSyntheticScenarioTriage,
  prepareSyntheticScenarioOverlayRecords,
} from '../src/contact-triage-synthetic-scenario.mjs';

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

describe('deterministic synthetic scenario overlay', () => {
  test('scores the same synthetic case deterministically without mutating household workflow', () => {
    const household = fixture.households[0];
    const before = structuredClone(household);

    const first = buildSyntheticScenarioTriage(household, fixture.scenario_reference_date);
    const second = buildSyntheticScenarioTriage(household, fixture.scenario_reference_date);

    assert.deepEqual(first, second);
    assert.equal(Number.isInteger(first.급성도_점수), true);
    assert.equal(Number.isInteger(first.취약도_점수), true);
    assert.equal(first.점수_기여내역.every(({ 축 }) => ['급성도', '취약도'].includes(축)), true);
    assert.deepEqual(household, before);
    assert.equal(household.workflow.visit_approval_status, null);
    assert.equal(household.approved_visit_constraints, null);
  });

  test('selects one stable scenario example per current dong while preserving every session score', () => {
    const records = fixture.households.map((household) => record(household));
    const firstCase = fixture.households[0];
    const sessionTriage = { ...buildSyntheticScenarioTriage(firstCase, fixture.scenario_reference_date), 급성도_점수: 1 };
    records[0] = record(firstCase, sessionTriage);

    const projected = prepareSyntheticScenarioOverlayRecords(records, fixture.scenario_reference_date);
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
    assert.equal(operations.every(({ vulnerability_size_metric: vulnerability }) => Number.isInteger(vulnerability)), true);
    assert.equal(operations.reduce((sum, item) => sum + item.scenario_scored_case_count, 0), 162);
    assert.equal(operations.reduce((sum, item) => sum + item.session_scored_case_count, 0), 0);
    assert.equal(operations.reduce((sum, item) => sum + item.unscored_case_count, 0), 5_869 - 162);
    assert.equal(new Set(operations.map(({ acute_color_metric: acute }) => acute)).size >= 6, true);
  });
});

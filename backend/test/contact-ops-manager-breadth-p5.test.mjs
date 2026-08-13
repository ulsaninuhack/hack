import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { describe, test } from 'node:test';

import { applyManagerVisitDecision } from '../src/contact-ops.mjs';
import {
  buildManagerBreadth,
  haversineDistanceKm,
} from '../src/contact-ops-manager-breadth.mjs';
import { createContactOpsService } from '../src/contact-ops-service.mjs';
import { createMemoryContactOpsState } from '../src/contact-ops-state.mjs';
import { createApiServer } from '../src/app.mjs';
import { createDataStore } from '../src/data-store.mjs';

const fixtureUrl = new URL('../../public/data/synthetic-households.json', import.meta.url);

function runTriageReport() {
  const result = spawnSync(process.execPath, ['scripts/report-contact-triage.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function triage({ acute, vulnerability, elapsed = 3 }) {
  const acuteGrade = acute >= 75 ? '방문권고-우선'
    : acute >= 55 ? '방문권고'
      : acute >= 30 ? '주시' : '정상';
  return {
    급성도_점수: acute,
    급성도_등급: acuteGrade,
    취약도_점수: vulnerability,
    마지막_연결_후_경과일: elapsed,
    점수_기여내역: [
      { 축: '급성도', 코드: '테스트_급성', 근거: '합성 관리자 요약 테스트', 가산점: acute, 출처: '현장_관찰' },
      { 축: '취약도', 코드: '테스트_취약', 근거: '합성 관리자 요약 테스트', 가산점: vulnerability, 출처: '현장_관찰' },
    ],
  };
}

function approve(household, index) {
  const recommended = {
    ...structuredClone(household),
    workflow: {
      ...household.workflow,
      visit_approval_status: 'recommended',
      transfer_status: index < 2 ? 'recommended' : household.workflow.transfer_status,
    },
  };
  return applyManagerVisitDecision(recommended, {
    decision: 'approved',
    decided_by: '합성 담당자',
    decided_at: '2026-08-13T00:00:00Z',
    note: 'P5 관리자 폭 검증용 명시 승인',
    assigned_worker_ids: [`SYN-W-${household.location.current_admin_dong_code_20260701}-01`],
    max_route_distance_km: 5 + (index % 3),
  });
}

async function managerRecords() {
  const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
  return fixture.households.slice(0, 13).map((household, index) => ({
    schemaVersion: 1,
    synthetic: true,
    session_id: 'p5-manager-demo-session',
    revision: index + 1,
    household: approve(household, index),
    observations: {},
    triage: triage({
      acute: [82, 82, 62, 55, 45, 37, 29, 75, 54, 30, 74, 100, 12][index],
      vulnerability: [30, 70, 51, 26, 88, 41, 5, 77, 50, 25, 74, 100, 0][index],
      elapsed: index,
    }),
    updated_at: '2026-08-13T00:00:00Z',
  }));
}

function forbiddenCompositeKey(value) {
  if (Array.isArray(value)) return value.some(forbiddenCompositeKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => (
    /(종합|composite|combined|overall|sum)/i.test(key) || forbiddenCompositeKey(nested)
  ));
}

describe('P5 manager breadth projection', () => {
  test('serves the exact read-only manager-breadth path with session overlay and bounded queries', async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
    const service = createContactOpsService({
      state: createMemoryContactOpsState({ households: fixture.households.slice(0, 1) }),
      loadTuningReport: async () => runTriageReport(),
    });
    const store = createDataStore({ summary: { schemaVersion: 1 }, zones: { type: 'FeatureCollection', features: [] }, facilities: { type: 'FeatureCollection', features: [] }, transit: { type: 'FeatureCollection', features: [] }, validation: { status: 'pass' } });
    const server = createApiServer({ store, contactOpsService: service, rateLimitPerMinute: 0 });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'X-Demo-Session-ID': 'p5-manager-http-session' };
    const response = await fetch(`${origin}/api/v1/contact-ops/manager-breadth`, { headers });
    const body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.data.synthetic, true); assert.equal(body.data.displayMarker, '[합성]');
    assert.equal((await fetch(`${origin}/api/v1/contact-ops/manager-breadth?district=x`, { headers })).status, 400);
    await new Promise((resolve) => server.close(resolve));
  });
  test('reads the canonical deterministic report through the session-overlay service boundary', async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8'));
    const state = createMemoryContactOpsState({ households: fixture.households.slice(0, 1) });
    const service = createContactOpsService({ state, loadTuningReport: async () => runTriageReport() });
    const result = await service.getManagerBreadth({ sessionId: 'p5-manager-service-session' });

    assert.equal(result.synthetic, true);
    assert.equal(result.displayMarker, '[합성]');
    assert.equal(result.tuning_warning.current_mild_signal_count, runTriageReport().경증_누적_우선권고_건수);
    assert.equal(result.grade_distribution.not_yet_scored_case_count, 1);
  });
  test('derives the tuning warning from the deterministic report and keeps score axes separate', async () => {
    const records = await managerRecords();
    const tuningReport = runTriageReport();
    assert.equal(tuningReport.경증_누적_우선권고_건수, 647);

    const result = buildManagerBreadth({ records, tuningReport });

    assert.equal(result.synthetic, true);
    assert.equal(result.displayMarker, '[합성]');
    assert.deepEqual(result.grade_distribution.acute.grades, {
      정상: 2,
      주시: 4,
      방문권고: 3,
      '방문권고-우선': 4,
    });
    assert.deepEqual(result.grade_distribution.vulnerability.score_bands, {
      '0_24': 2,
      '25_49': 4,
      '50_74': 4,
      '75_100': 3,
    });
    assert.equal(result.tuning_warning.title, '합성 배점 튜닝 경고');
    assert.equal(result.tuning_warning.current_mild_signal_count, 647);
    assert.equal(result.tuning_warning.source_case_count, 5_869);
    assert.equal(forbiddenCompositeKey(result), false);
  });

  test('accepts a fractional vulnerability score from the public structural context', async () => {
    const records = (await managerRecords()).slice(0, 1);
    records[0] = {
      ...records[0],
      triage: {
        ...records[0].triage,
        취약도_점수: 37.602737968418836,
      },
    };

    const result = buildManagerBreadth({ records, tuningReport: runTriageReport() });

    assert.equal(result.grade_distribution.vulnerability.score_bands['25_49'], 1);
  });

  test('orders the transfer recommendation queue by acute then vulnerability and uses safe labels', async () => {
    const result = buildManagerBreadth({
      records: await managerRecords(),
      tuningReport: runTriageReport(),
    });

    assert.deepEqual(result.transfer_recommendations.map(({ case_id }) => case_id), [
      'SYN-HH-2812551000-0002',
      'SYN-HH-2812551000-0001',
    ]);
    assert.ok(result.transfer_recommendations.every(
      ({ status_label }) => status_label === '행정복지센터 이관 권고',
    ));
    assert.equal(JSON.stringify(result.transfer_recommendations).includes('no_answer'), false);
    assert.equal(JSON.stringify(result.transfer_recommendations).includes('recommended'), false);
  });

  test('returns all 13 approved visits as a deterministic nearest-order hint that is explicitly not VRP', async () => {
    const records = await managerRecords();
    const result = buildManagerBreadth({ records, tuningReport: runTriageReport() });
    const hint = result.approved_visit_hint;

    assert.equal(hint.approved_visit_count, 13);
    assert.match(hint.label, /VRP 아님/);
    assert.equal(hint.optimization_or_dispatch, false);
    assert.equal(hint.method_label, '단순 근접 순서 안내');
    assert.equal(hint.items.length, 13);
    assert.equal(new Set(hint.items.map(({ case_id }) => case_id)).size, 13);
    assert.equal(hint.items[0].case_id, 'SYN-HH-2812551000-0001');
    assert.equal(Object.hasOwn(hint.items[0], 'distance_from_previous_km'), false);

    const byId = new Map(records.map(({ household }) => [household.id, household]));
    for (let index = 1; index < hint.items.length; index += 1) {
      const previous = byId.get(hint.items[index - 1].case_id).location;
      const remaining = hint.items.slice(index).map(({ case_id }) => byId.get(case_id));
      const expected = remaining.toSorted((left, right) => (
        haversineDistanceKm(previous, left.location) - haversineDistanceKm(previous, right.location)
          || left.id.localeCompare(right.id)
      ))[0].id;
      assert.equal(hint.items[index].case_id, expected);
      assert.ok(hint.items[index].distance_from_previous_km >= 0);
    }
  });

  test('does not expose route constraints for a visit that lacks explicit approval', async () => {
    const records = await managerRecords();
    records[0] = {
      ...records[0],
      household: {
        ...records[0].household,
        approved_visit_constraints: null,
        workflow: {
          ...records[0].household.workflow,
          visit_approval_status: 'recommended',
        },
      },
    };

    const result = buildManagerBreadth({ records, tuningReport: runTriageReport() });

    assert.equal(result.approved_visit_hint.approved_visit_count, 12);
    assert.equal(JSON.stringify(result).includes(records[0].household.id), true);
    assert.equal(
      result.approved_visit_hint.items.some(({ case_id }) => case_id === records[0].household.id),
      false,
    );
  });

  test('rejects non-synthetic records, invalid report evidence, and malformed approved constraints', async () => {
    const records = await managerRecords();
    const report = runTriageReport();

    assert.throws(
      () => buildManagerBreadth({ records: [{ ...records[0], synthetic: false }], tuningReport: report }),
      /synthetic/,
    );
    assert.throws(
      () => buildManagerBreadth({ records, tuningReport: { ...report, 실제_개인_판정: true } }),
      /tuning report/,
    );
    assert.throws(
      () => buildManagerBreadth({
        records: [{
          ...records[0],
          household: { ...records[0].household, approved_visit_constraints: null },
        }],
        tuningReport: report,
      }),
      /approved visit constraints/,
    );
  });

  test('fails visibly for malformed score, contribution, location, and workflow evidence', async () => {
    const records = await managerRecords();
    const report = runTriageReport();
    const withRecord = (record) => buildManagerBreadth({ records: [record], tuningReport: report });
    const replaceTriage = (patch) => ({
      ...records[0],
      triage: { ...records[0].triage, ...patch },
    });

    for (const [record, message] of [
      [replaceTriage({ 급성도_점수: -1 }), /급성도_점수/],
      [replaceTriage({ 취약도_점수: 101 }), /취약도_점수/],
      [replaceTriage({ 급성도_등급: '정상' }), /급성도_등급/],
      [replaceTriage({ 점수_기여내역: null }), /contribution/],
      [replaceTriage({ 점수_기여내역: [{ 축: '종합' }] }), /contribution/],
      [{ ...records[0], household: { ...records[0].household, location: null } }, /location/],
      [{ ...records[0], household: { ...records[0].household, workflow: null } }, /workflow/],
    ]) {
      assert.throws(() => withRecord(record), message);
    }
  });

  test('rejects route constraints before approval and missing triage behind recommendation states', async () => {
    const records = await managerRecords();
    const report = runTriageReport();
    const base = records[0];

    assert.throws(() => buildManagerBreadth({
      records: [{
        ...base,
        household: {
          ...base.household,
          workflow: { ...base.household.workflow, visit_approval_status: 'recommended' },
        },
      }],
      tuningReport: report,
    }), /forbidden before explicit approval/);

    assert.throws(() => buildManagerBreadth({
      records: [{
        ...base,
        triage: null,
        household: {
          ...base.household,
          approved_visit_constraints: null,
          workflow: { ...base.household.workflow, visit_approval_status: 'recommended' },
        },
      }],
      tuningReport: report,
    }), /visit record requires triage/);

    assert.throws(() => buildManagerBreadth({
      records: [{
        ...base,
        triage: null,
        household: {
          ...base.household,
          approved_visit_constraints: null,
          workflow: {
            ...base.household.workflow,
            visit_approval_status: null,
            transfer_status: 'recommended',
          },
        },
      }],
      tuningReport: report,
    }), /transfer recommendation requires triage/);
  });

  test('rejects report values that cannot be traced to a complete deterministic distribution', async () => {
    const records = await managerRecords();
    const report = runTriageReport();
    const invalidReports = [
      null,
      { ...report, 자료_성격: 'observed_person_result' },
      { ...report, 전체_건수: 0 },
      { ...report, 전체_건수: 1.5 },
      { ...report, 경증_누적_우선권고_건수: -1 },
      { ...report, 경증_누적_우선권고_건수: report.전체_건수 + 1 },
      { ...report, 급성도_등급별_건수: null },
      {
        ...report,
        급성도_등급별_건수: { ...report.급성도_등급별_건수, 정상: 1.5 },
      },
      {
        ...report,
        급성도_등급별_건수: { ...report.급성도_등급별_건수, 정상: report.급성도_등급별_건수.정상 + 1 },
      },
    ];

    for (const tuningReport of invalidReports) {
      assert.throws(
        () => buildManagerBreadth({ records, tuningReport }),
        /tuning report/,
      );
    }
  });

  test('handles an empty manager session without inventing a visit or score', () => {
    const result = buildManagerBreadth({ records: [], tuningReport: runTriageReport() });

    assert.deepEqual(result.transfer_recommendations, []);
    assert.equal(result.grade_distribution.scored_case_count, 0);
    assert.equal(result.grade_distribution.not_yet_scored_case_count, 0);
    assert.equal(result.approved_visit_hint.approved_visit_count, 0);
    assert.deepEqual(result.approved_visit_hint.items, []);
  });

  test('uses elapsed days then case ID for tied transfer recommendations', async () => {
    const records = (await managerRecords()).slice(0, 4).map((record, index) => ({
      ...record,
      household: {
        ...record.household,
        workflow: { ...record.household.workflow, transfer_status: 'recommended' },
      },
      triage: triage({ acute: 62, vulnerability: 51, elapsed: index < 2 ? 9 : 4 }),
    }));
    const result = buildManagerBreadth({ records, tuningReport: runTriageReport() });

    assert.deepEqual(result.transfer_recommendations.map(({ case_id }) => case_id), [
      'SYN-HH-2812551000-0001',
      'SYN-HH-2812551000-0002',
      'SYN-HH-2812551000-0003',
      'SYN-HH-2812551000-0004',
    ]);
  });

  test('breaks equal-distance nearest-hint ties by stable synthetic case ID', async () => {
    const records = (await managerRecords()).slice(0, 3);
    const sharedLocation = structuredClone(records[0].household.location);
    const tied = records.map((record) => ({
      ...record,
      household: { ...record.household, location: structuredClone(sharedLocation) },
    }));
    const result = buildManagerBreadth({ records: tied, tuningReport: runTriageReport() });

    assert.deepEqual(result.approved_visit_hint.items.map(({ case_id }) => case_id), [
      'SYN-HH-2812551000-0001',
      'SYN-HH-2812551000-0002',
      'SYN-HH-2812551000-0003',
    ]);
    assert.deepEqual(
      result.approved_visit_hint.items.slice(1).map(({ distance_from_previous_km }) => distance_from_previous_km),
      [0, 0],
    );
  });

  test('requires an array of state records and bounded coordinates for distance hints', async () => {
    const report = runTriageReport();
    assert.throws(() => buildManagerBreadth({ records: null, tuningReport: report }), /records/);
    assert.throws(
      () => haversineDistanceKm(
        { current_district_name_20260701: '구', current_admin_dong_name_20260701: '동', latitude: 91, longitude: 0 },
        { current_district_name_20260701: '구', current_admin_dong_name_20260701: '동', latitude: 0, longitude: 0 },
      ),
      /location/,
    );
  });
});

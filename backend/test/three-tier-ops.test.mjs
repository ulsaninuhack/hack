import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  AI_SUMMARY_LABEL,
  MIXED_SNAPSHOT_WARNING,
  VIRTUAL_PHONE_LABEL,
  WELFARE_MIXED_SNAPSHOT_WARNING,
  buildAgencyRecommendations,
  buildAssignmentProposals,
  buildDistrictAggregates,
  buildDistrictAiSummaryInput,
  buildReportCard,
  buildStaffingReview,
  contactResultLabel,
  createDistrictAiSummaryAdapter,
  deriveCaseDisplayName,
  deriveVirtualPhone,
  renderAuthoredDistrictAiSummary,
  timeWindowsOverlap,
} from '../src/three-tier-ops.mjs';

const emptyObservations = () => ({
  관찰_6징후: {
    우편물_고지서_적체: false, 악취_벌레: false, 쓰레기_술병: false,
    인기척_없이_TV_불: false, 외출_없음: false, 연락_두절: false,
  },
  식사상태: null, 위생상태: null, 공과금_2개월_이상_체납: null,
  최근_건강_정신_괴로움: null, 관계망_유무: null, 연락_빈도: null,
});

function household(id, overrides = {}) {
  const dongCode = id.slice(7, 17);
  return {
    id,
    synthetic: true,
    location: {
      current_admin_dong_code_20260701: dongCode,
      current_admin_dong_name_20260701: dongCode === '2812551000' ? '신포동' : '삼산1동',
      current_district_name_20260701: dongCode === '2812551000' ? '제물포구' : '부평구',
      geometry_zone_id: dongCode === '2812551000' ? 'vworld_sgis_20250630:23010530' : 'vworld_sgis_20250630:23060110',
      latitude: 37.46, longitude: 126.61,
      ...overrides.location,
    },
    contact: {
      next_contact_date: '2026-08-12', preferred_contact_method: 'phone',
      contact_cadence_days: 7, last_contact_date: '2026-08-11',
      last_contact_result: 'no_answer', consecutive_no_answer_count: 1,
      ...overrides.contact,
    },
    visit_context: {
      preferred_visit_time_window: { start: '10:00', end: '13:00' },
      preferred_worker_gender: 'any', stairs_present: false,
      service_duration_minutes: 40, requires_two_person_team: false,
      requires_public_official_companion: false,
      ...overrides.visit_context,
    },
    workflow: {
      follow_up_deadline: null, follow_up_status: 'none',
      visit_approval_status: null, transfer_status: 'not_required', visit_decision: null,
      ...overrides.workflow,
    },
    management_entry: {
      synthetic: true,
      status: 'active_contact_management',
      intake_channel: 'family_request',
      intake_recorded_date: '2026-07-21',
      ongoing_contact_permission: { status: 'recorded', recorded_date: '2026-07-22', basis: 'synthetic_demo_scenario' },
      duplicate_service_check: {
        status: 'completed_no_overlapping_schedule', checked_date: '2026-07-23',
        scope: 'regular_wellbeing_contact_or_home_visit', interpretation: 'workflow_duplicate_check_not_welfare_eligibility',
      },
    },
    approved_visit_constraints: overrides.approved_visit_constraints ?? null,
  };
}

function worker(id, overrides = {}) {
  const dongCode = id.slice(6, 16);
  return {
    id,
    synthetic: true,
    display_name: `연결단원 ${id.slice(-6, -3)}`,
    role: 'neighbor_connector',
    location: {
      current_admin_dong_code_20260701: dongCode,
      current_admin_dong_name_20260701: dongCode === '2812551000' ? '신포동' : '삼산1동',
      current_district_name_20260701: dongCode === '2812551000' ? '제물포구' : '부평구',
      latitude: 37.47, longitude: 126.62,
    },
    constraints: {
      stairs_allowed: true,
      available_time_window: { start: '13:00', end: '17:00' },
      max_daily_approved_visits: 2,
      assigned_admin_dong_codes_20260701: [dongCode],
      travel_modes: ['walking'],
      ...overrides.constraints,
    },
  };
}

function record(householdValue, { revision = 0, triage = null, observations = emptyObservations() } = {}) {
  return {
    schemaVersion: 1, synthetic: true, session_id: 'three-tier-unit-session',
    revision, household: householdValue, observations, triage,
    updated_at: '2026-08-12T00:00:00.000Z',
  };
}

const sampleTriage = {
  급성도_점수: 62, 급성도_등급: '방문권고', 취약도_점수: 25, 권고_액션: '방문권고',
  방문_승인_상태: '권고',
  점수_기여내역: [
    { 축: '급성도', 코드: '연속_미응답', 근거: '연속 미응답 2회', 가산점: 25 },
    { 축: '급성도', 코드: '식사상태', 근거: '식사상태 심각', 가산점: 25 },
    { 축: '급성도', 코드: '관찰_6징후', 근거: '관찰 6징후 중 1개 확인', 가산점: 12 },
    { 축: '취약도', 코드: '관계망_없음', 근거: '관계망 없음', 가산점: 25 },
  ],
};

describe('three-tier virtual phone (INV15)', () => {
  test('derives a deterministic clearly-virtual number with the [가상] label', () => {
    const first = deriveVirtualPhone('SYN-HH-2812551000-0001');
    const second = deriveVirtualPhone('SYN-HH-2812551000-0001');
    assert.deepEqual(first, second);
    assert.match(first.display_number, /^010-0000-\d{4}$/);
    assert.equal(first.label, VIRTUAL_PHONE_LABEL);
    assert.equal(first.dialable, false);
    assert.notEqual(first.display_number, deriveVirtualPhone('SYN-HH-2812551000-0002').display_number);
  });

  test('rejects non-synthetic case identifiers', () => {
    assert.throws(() => deriveVirtualPhone('resident-001'), TypeError);
    assert.throws(() => deriveVirtualPhone(null), TypeError);
  });


  test('no real-looking phone pattern exists in served source (grep gate)', () => {
    const roots = [
      new URL('../src/', import.meta.url).pathname,
      new URL('../../src/', import.meta.url).pathname,
    ];
    const realPhone = /01[16789][-.\s]?\d{3,4}[-.\s]?\d{4}|010[-.\s]?(?!0000)\d{4}[-.\s]?\d{4}/;
    for (const root of roots) {
      for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !/\.(mjs|ts|tsx|css|html|json)$/.test(entry.name)) continue;
        const path = join(entry.parentPath, entry.name);
        const content = readFileSync(path, 'utf8');
        assert.equal(realPhone.test(content), false, `${path} must not contain a real-looking phone number`);
      }
    }
  });
});

describe('three-tier case display names', () => {
  test('maps internal case IDs to stable, natural Korean names', () => {
    const first = deriveCaseDisplayName('SYN-HH-2812551000-0001');
    assert.equal(first, deriveCaseDisplayName('SYN-HH-2812551000-0001'));
    assert.match(first, /^[가-힣]{3,4}$/);
    assert.notEqual(first, deriveCaseDisplayName('SYN-HH-2812551000-0002'));
    assert.doesNotMatch(first, /SYN|HH|합성/);
  });

  test('keeps every name unique inside one dong fixture', () => {
    const names = Array.from({ length: 50 }, (_, index) => (
      deriveCaseDisplayName(`SYN-HH-2812551000-${String(index + 1).padStart(4, '0')}`)
    ));
    assert.equal(new Set(names).size, names.length);
    assert.throws(() => deriveCaseDisplayName('CASE-0001'), TypeError);
  });
});

describe('three-tier agency recommendation rule table', () => {
  test('maps signal combinations to 권고+사유 only (INV14)', () => {
    const observations = emptyObservations();
    observations.최근_건강_정신_괴로움 = true;
    observations.식사상태 = '심각';
    observations.공과금_2개월_이상_체납 = true;
    observations.관찰_6징후.외출_없음 = true;
    const recommendations = buildAgencyRecommendations({
      observations,
      household: household('SYN-HH-2812551000-0001', { contact: { consecutive_no_answer_count: 3 }, workflow: { transfer_status: 'recommended' } }),
      triage: sampleTriage,
    });
    assert.deepEqual(recommendations.map((item) => item.기관), [
      '정신건강복지센터', '보건소·의료 연계', '구 희망복지지원단', '현장 확인',
    ]);
    for (const item of recommendations) {
      assert.equal(item.성격, '권고');
      assert.equal(item.확정_권한, '동 행정복지센터');
      assert.ok(item.사유.length > 0);
      assert.ok(item.근거_문서.length > 0);
    }
  });

  test('isolated network with hygiene concern routes to 구 희망복지지원단', () => {
    const observations = emptyObservations();
    observations.위생상태 = '불량';
    observations.관계망_유무 = '없음';
    const recommendations = buildAgencyRecommendations({
      observations, household: household('SYN-HH-2812551000-0001'), triage: null,
    });
    assert.deepEqual(recommendations.map((item) => item.기관), ['보건소·의료 연계', '구 희망복지지원단']);
    assert.match(recommendations[1].사유, /관계망 부재/);
  });

  test('returns no recommendation without signals and rejects bad input', () => {
    assert.deepEqual(buildAgencyRecommendations({
      observations: emptyObservations(),
      household: household('SYN-HH-2812551000-0001', { contact: { consecutive_no_answer_count: 0 } }),
      triage: null,
    }), []);
    assert.throws(() => buildAgencyRecommendations({ observations: null }), TypeError);
  });
});

describe('three-tier report card', () => {
  test('derives a structured card from a recorded session result', () => {
    const observations = emptyObservations();
    observations.식사상태 = '심각';
    observations.관찰_6징후.우편물_고지서_적체 = true;
    const card = buildReportCard(record(
      household('SYN-HH-2812551000-0001', { contact: { consecutive_no_answer_count: 2 }, workflow: { transfer_status: 'recommended', visit_approval_status: 'recommended', follow_up_status: 'required' } }),
      { revision: 1, triage: sampleTriage, observations },
    ));
    assert.equal(card.card_id, 'RPT-SYN-HH-2812551000-0001-r1');
    assert.equal(card.등급, '방문권고');
    assert.equal(card.권고_액션, '방문권고');
    assert.equal(card.사유_요약.length, 3);
    assert.deepEqual(card.사유_요약.map((item) => item.가산점), [25, 25, 25]);
    assert.equal(card.workflow.transfer_label, '행정복지센터 이관 권고');
    assert.equal(card.evidence.마지막_연락_결과_라벨, '연락 안 됨');
    assert.ok(card.권고_기관.some((item) => item.기관 === '현장 확인'));
    assert.match(card.virtual_phone.display_number, /^010-0000-\d{4}$/);
    assert.equal(card.displayMarker, '[합성]');
    assert.match(card.display_name, /^[가-힣]{3,4}$/);
    assert.doesNotMatch(card.display_name, /SYN|합성/);
  });

  test('returns null before any session-recorded result and fails on bad grades', () => {
    assert.equal(buildReportCard(record(household('SYN-HH-2812551000-0001'))), null);
    assert.equal(buildReportCard(record(household('SYN-HH-2812551000-0001'), { revision: 2, triage: null })), null);
    assert.throws(() => buildReportCard(record(
      household('SYN-HH-2812551000-0001'),
      { revision: 1, triage: { ...sampleTriage, 급성도_등급: '위험' } },
    )), TypeError);
    assert.throws(() => buildReportCard(null), TypeError);
  });

  test('labels every raw contact result in Korean', () => {
    assert.equal(contactResultLabel('connected_ok'), '안부 확인 완료');
    assert.equal(contactResultLabel('not_attempted'), '시도 전');
    assert.equal(contactResultLabel('refused'), '연락(또는 방문) 거부');
    assert.equal(contactResultLabel('unknown_enum'), '기록 없음');
  });
});

describe('three-tier assignment proposal engine', () => {
  const workers = [worker('SYN-W-2812551000-01'), worker('SYN-W-2826051000-01', { constraints: { available_time_window: { start: '09:00', end: '18:00' } } })];
  const records = [
    record(household('SYN-HH-2812551000-0001')),
    record(household('SYN-HH-2812551000-0002', {
      contact: { preferred_contact_method: 'visit' }, workflow: { visit_approval_status: 'approved' },
    }), { revision: 1, triage: sampleTriage }),
    record(household('SYN-HH-2812551000-0003', { contact: { next_contact_date: '2026-08-20' } })),
    record(household('SYN-HH-2812551000-0004')),
    record(household('SYN-HH-2826051000-0001', { contact: { preferred_contact_method: 'visit' }, workflow: { follow_up_status: 'overdue', follow_up_deadline: '2026-08-10', visit_approval_status: 'recommended' } })),
    record(household('SYN-HH-2826051000-0002', {
      contact: { next_contact_date: '2026-08-20' },
      workflow: { visit_approval_status: 'approved' },
      approved_visit_constraints: { max_route_distance_km: 2, assigned_worker_ids: ['SYN-W-2826051000-01'], routing_interpretation: 'approved_visit_only_not_person_risk' },
    })),
    record(household('SYN-HH-2826051000-0003', { contact: { preferred_contact_method: 'visit' }, workflow: { visit_approval_status: 'recommended' } }), {
      revision: 1,
      triage: {
        급성도_점수: 80, 급성도_등급: '방문권고-우선', 취약도_점수: 10, 권고_액션: '방문권고_우선',
        방문_승인_상태: '권고',
        점수_기여내역: [{ 축: '급성도', 코드: '연속_미응답', 근거: '연속 미응답 3회', 가산점: 45 }],
      },
    }),
  ];

  test('separates phone and visit lanes with proposal status only (INV14/INV16)', () => {
    const batches = buildAssignmentProposals({ records, workers, referenceDate: '2026-08-12' });
    assert.equal(batches.length, 2);
    const [first, second] = batches;
    assert.equal(first.dong_code, '2812551000');
    assert.deepEqual(first.lanes.phone.map((item) => item.case_id), ['SYN-HH-2812551000-0001', 'SYN-HH-2812551000-0004']);
    assert.deepEqual(first.lanes.phone.map((item) => item.display_name), [
      deriveCaseDisplayName('SYN-HH-2812551000-0001'),
      deriveCaseDisplayName('SYN-HH-2812551000-0004'),
    ]);
    assert.deepEqual(first.lanes.visit.map((item) => item.case_id), ['SYN-HH-2812551000-0002']);
    assert.deepEqual(second.lanes.visit.map((item) => item.case_id), ['SYN-HH-2826051000-0002']);
    assert.ok(![...second.lanes.phone, ...second.lanes.visit]
      .some((item) => ['SYN-HH-2826051000-0001', 'SYN-HH-2826051000-0003'].includes(item.case_id)),
    'recommended visits stay in center review and are not assigned');
    for (const batch of batches) {
      assert.equal(batch.status, 'proposed');
      for (const proposal of [...batch.lanes.phone, ...batch.lanes.visit]) {
        assert.equal(proposal.status, 'proposed');
        if (proposal.lane === 'visit') {
          assert.equal(proposal.approved_visit, true, 'visit lane accepts only approved visits');
        } else {
          assert.equal(proposal.preferred_contact_method, 'phone');
          assert.equal(proposal.approved_visit, false);
        }
        assert.equal(proposal.management_entry.intake_channel, 'family_request');
      }
      const phoneIds = new Set(batch.lanes.phone.map((item) => item.case_id));
      assert.ok(batch.lanes.visit.every((item) => !phoneIds.has(item.case_id)));
    }
  });

  test('flags time-window mismatch, capacity overflow, and missing workers as 조정 필요', () => {
    const batches = buildAssignmentProposals({ records, workers, referenceDate: '2026-08-12' });
    const visitJemulpo = batches[0].lanes.visit[0];
    assert.ok(visitJemulpo.adjustment_flags.includes('time_window_mismatch'));
    const capacityRecords = [
      record(household('SYN-HH-2826051000-0001', { contact: { preferred_contact_method: 'visit' }, workflow: { visit_approval_status: 'approved' } }), { revision: 1, triage: sampleTriage }),
      record(household('SYN-HH-2826051000-0002', { workflow: { visit_approval_status: 'approved' } })),
      record(household('SYN-HH-2826051000-0003', { contact: { preferred_contact_method: 'visit' }, workflow: { visit_approval_status: 'approved' } }), {
        revision: 1,
        triage: { ...sampleTriage, 급성도_점수: 80, 급성도_등급: '방문권고-우선' },
      }),
    ];
    const bupyeongVisits = buildAssignmentProposals({ records: capacityRecords, workers, referenceDate: '2026-08-12' })[0].lanes.visit;
    assert.deepEqual(bupyeongVisits.map((item) => item.adjustment_flags.includes('capacity_exceeded')), [false, false, true],
      'capacity keeps the two highest acute approved visits; the ungraded case overflows');
    assert.equal(bupyeongVisits[2].급성도_등급, null,
      'grade participates in capacity: the overflow slot goes to the unscored case, not the graded one');
    const orphan = buildAssignmentProposals({
      records: [record(household('SYN-HH-2812551000-0001'))], workers: [], referenceDate: '2026-08-12',
    });
    assert.ok(orphan[0].lanes.phone[0].adjustment_flags.includes('no_worker_for_dong'));
    assert.equal(orphan[0].lanes.phone[0].worker_id, null);
  });

  test('keeps grades from session records and marks unscored tasks', () => {
    const batches = buildAssignmentProposals({ records, workers, referenceDate: '2026-08-12', dongCode: '2812551000' });
    assert.equal(batches.length, 1);
    assert.equal(batches[0].lanes.visit[0].급성도_등급, '방문권고');
    assert.equal(batches[0].lanes.visit[0].grade_source, '세션 기록');
    assert.equal(batches[0].lanes.phone[0].급성도_등급, null);
    assert.equal(batches[0].lanes.phone[0].grade_source, '미기록');
  });

  test('validates inputs deterministically', () => {
    assert.throws(() => buildAssignmentProposals({ records: null, workers, referenceDate: '2026-08-12' }), TypeError);
    assert.throws(() => buildAssignmentProposals({ records, workers: null, referenceDate: '2026-08-12' }), TypeError);
    assert.throws(() => buildAssignmentProposals({ records, workers, referenceDate: 'today' }), TypeError);
    assert.throws(() => buildAssignmentProposals({ records, workers, referenceDate: '2026-08-12', dongCode: '12' }), TypeError);
    assert.ok(timeWindowsOverlap({ start: '10:00', end: '13:00' }, { start: '12:00', end: '17:00' }));
    assert.equal(timeWindowsOverlap({ start: '10:00', end: '13:00' }, { start: '13:00', end: '17:00' }), false);
    assert.throws(() => timeWindowsOverlap({ start: 'ten', end: '13:00' }, { start: '13:00', end: '17:00' }), TypeError);
  });
});

const storeZones = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: null, properties: { geometry_zone_id: 'vworld_sgis_20250630:23010530', current_district_name_20260701: '제물포구', total_population: 10000, population_age_65_plus: 2000, total_households: 5000, one_person_households: 1500, one_person_households_age_65_plus: 648 } },
    { type: 'Feature', geometry: null, properties: { geometry_zone_id: 'vworld_sgis_20250630:23060110', current_district_name_20260701: '부평구', total_population: 20000, population_age_65_plus: 3000, total_households: 8000, one_person_households: 2000, one_person_households_age_65_plus: 700 } },
    { type: 'Feature', geometry: null, properties: { geometry_zone_id: 'vworld_sgis_20250630:23090001', current_district_name_20260701: '연수구' } },
  ],
};

const structuralZones = [
  {
    geometry_zone_id: 'vworld_sgis_20250630:23010530',
    score_0_50: 20,
    indicators: {
      older_population_share: { contribution: 5 },
      one_person_household_share: { contribution: 5 },
      residential_building_30_plus_share: { contribution: 5 },
      basic_livelihood_context_density: { contribution: 5, raw_numerator: 100, raw_denominator: 2000, missing: false },
    },
  },
  {
    geometry_zone_id: 'vworld_sgis_20250630:23060110',
    score_0_50: 30,
    indicators: {
      older_population_share: { contribution: 10 },
      one_person_household_share: { contribution: 10 },
      residential_building_30_plus_share: { contribution: 10 },
      basic_livelihood_context_density: { contribution: 0, raw_numerator: null, raw_denominator: null, missing: true },
    },
  },
];

describe('three-tier district aggregates (INV17)', () => {
  const workers = [worker('SYN-W-2812551000-01'), worker('SYN-W-2826051000-01')];
  const records = [
    record(household('SYN-HH-2812551000-0001')),
    record(household('SYN-HH-2812551000-0002', { workflow: { visit_approval_status: 'recommended' } }), { revision: 1, triage: sampleTriage }),
    record(household('SYN-HH-2826051000-0001', { workflow: { follow_up_status: 'overdue', follow_up_deadline: '2026-08-10', transfer_status: 'recommended' } })),
    record(household('SYN-HH-2826051000-0002', {
      contact: { next_contact_date: '2026-08-20' },
      workflow: { visit_approval_status: 'approved' },
      approved_visit_constraints: { max_route_distance_km: 2, assigned_worker_ids: ['SYN-W-2826051000-01'], routing_interpretation: 'approved_visit_only_not_person_risk' },
    })),
  ];

  function aggregates() {
    return buildDistrictAggregates({
      storeZones,
      facilityDistribution: { 제물포구: 171, 부평구: 390 },
      structuralZones,
      records,
      workers,
      referenceDate: '2026-08-12',
    });
  }

  test('rolls structure and operations up to districts without case identifiers', () => {
    const result = aggregates();
    assert.deepEqual(result.map((item) => item.district), ['부평구', '연수구', '제물포구']);
    const serialized = JSON.stringify(result);
    assert.equal(/SYN-HH-/.test(serialized), false, 'district rollup must not expose case IDs (INV17)');
    assert.equal(/latitude|longitude/.test(serialized), false, 'district rollup must not expose case coordinates');
    for (const item of result) assert.equal(item.case_detail_access, 'none_district_rollup_only');

    const jemulpo = result.find((item) => item.district === '제물포구');
    assert.equal(jemulpo.structure.elderly_share_pct, 20);
    assert.equal(jemulpo.structure.one_person_household_share_pct, 30);
    assert.equal(jemulpo.structure.welfare_facility_count, 171);
    assert.equal(jemulpo.structure.basic_livelihood.density_pct, 5);
    assert.equal(jemulpo.structure.structural_context.mean_score_0_50, 20);
    assert.equal(jemulpo.structure.structural_context.indicator_mean_contributions.고령비율, 5);
    assert.equal(jemulpo.structure.mixed_snapshot_warning, MIXED_SNAPSHOT_WARNING);
    assert.equal(jemulpo.structure.basic_livelihood.mixed_snapshot_warning, WELFARE_MIXED_SNAPSHOT_WARNING);
    assert.equal(jemulpo.operations.due_count, 2);
    assert.equal(jemulpo.operations.pending_visit_approval_count, 1);
    assert.equal(jemulpo.operations.per_worker.due, 2);

    const bupyeong = result.find((item) => item.district === '부평구');
    assert.equal(bupyeong.operations.overdue_count, 1);
    assert.equal(bupyeong.operations.approved_visit_count, 1);
    assert.equal(bupyeong.operations.transfer_recommended_count, 1);
    assert.equal(bupyeong.structure.basic_livelihood.density_pct, null);
    assert.equal(bupyeong.structure.basic_livelihood.missing_zone_count, 1);

    const yeonsu = result.find((item) => item.district === '연수구');
    assert.equal(yeonsu.structure.elderly_share_pct, null);
    assert.equal(yeonsu.operations.per_worker.due, null);
    assert.equal(yeonsu.structure.structural_context.mean_score_0_50, null);
    assert.equal(yeonsu.structure.structural_context.indicator_mean_contributions.기초수급_밀도, null);
  });

  test('staffing review shows structure and load side by side without a composite score', () => {
    const review = buildStaffingReview(aggregates());
    assert.equal(review.title, '증원 검토 후보');
    assert.equal(review.composite_score, null);
    assert.match(review.method_note, /합산하지 않습니다/);
    assert.match(review.method_note, /배치 최적화가 아닙니다/);
    assert.deepEqual(review.candidates.map((item) => item.district), ['제물포구', '부평구', '연수구']);
    assert.deepEqual(review.candidates.map((item) => item.load_rank), [1, 2, 3]);
    const bupyeong = review.candidates.find((item) => item.district === '부평구');
    assert.equal(bupyeong.structure_rank, 1);
    assert.equal(bupyeong.structural_model_output_label, '[MODEL OUTPUT — UNVALIDATED]');
  });

  test('validates aggregate inputs', () => {
    assert.throws(() => buildDistrictAggregates({ storeZones: null, records, workers, referenceDate: '2026-08-12' }), TypeError);
    assert.throws(() => buildDistrictAggregates({ storeZones, records: null, workers, referenceDate: '2026-08-12' }), TypeError);
    assert.throws(() => buildDistrictAggregates({ storeZones, records, workers: null, referenceDate: '2026-08-12' }), TypeError);
    assert.throws(() => buildDistrictAggregates({ storeZones, records, workers, referenceDate: 'now' }), TypeError);
    assert.throws(() => buildStaffingReview(null), TypeError);
  });
});

describe('three-tier district AI summary (INV19)', () => {
  const aggregate = {
    district: '제물포구',
    structure: {
      elderly_share_pct: 20, one_person_household_share_pct: 30,
      one_person_households_age_65_plus: 648,
      welfare_facility_count: 171,
      basic_livelihood: { density_pct: 5 },
      structural_context: { mean_score_0_50: 20 },
    },
    operations: {
      worker_count: 1, due_count: 2, overdue_count: 0,
      pending_visit_approval_count: 1, per_worker: { due: 2 },
    },
  };

  test('Codex-authored analysis is deterministic and quotes only injected values', () => {
    const input = buildDistrictAiSummaryInput(aggregate, '2026-08-12');
    const first = renderAuthoredDistrictAiSummary(input);
    assert.equal(first, renderAuthoredDistrictAiSummary(input));
    for (const value of Object.values(input)) {
      assert.ok(first.includes(String(value)), `summary must quote injected metric ${value}`);
    }
    const allowedTokens = new Set(
      Object.values(input).flatMap((value) => String(value).match(/\d+(?:\.\d+)?/g) ?? []),
    );
    for (const token of first.match(/\d+(?:\.\d+)?/g) ?? []) {
      assert.ok(allowedTokens.has(token), `summary number ${token} must come from injected metrics only`);
    }
    assert.match(first, /개인 단위 예측이나 판정이 아닙니다/);
    assert.match(first, /제물포구/);
    assert.doesNotMatch(first, /mock|모의/);
  });

  test('adapter wraps summaries with the required label and warnings', async () => {
    const adapter = createDistrictAiSummaryAdapter();
    const result = await adapter.summarize({ aggregate, referenceDate: '2026-08-12' });
    assert.equal(result.label, AI_SUMMARY_LABEL);
    assert.equal(result.generator, 'codex_authored_v1');
    assert.equal(result.district, '제물포구');
    assert.deepEqual(result.mixed_snapshot_warnings, [MIXED_SNAPSHOT_WARNING, WELFARE_MIXED_SNAPSHOT_WARNING]);
    assert.equal(result.input_metrics.기초수급_밀도_퍼센트, '5');
    const again = await adapter.summarize({ aggregate, referenceDate: '2026-08-12' });
    assert.deepEqual(result, again);
  });

  test('missing metrics render as 자료 없음 instead of computed values', async () => {
    const sparse = structuredClone(aggregate);
    sparse.structure.basic_livelihood.density_pct = null;
    const input = buildDistrictAiSummaryInput(sparse, '2026-08-12');
    assert.equal(input.기초수급_밀도_퍼센트, '자료 없음');
    assert.match(renderAuthoredDistrictAiSummary(input), /기초수급 밀도는 자료 없음%/);
  });

  test('contains authored guidance for every current Incheon district', () => {
    const districts = ['강화군', '검단구', '계양구', '남동구', '미추홀구', '부평구', '서해구', '연수구', '영종구', '옹진군', '제물포구'];
    for (const district of districts) {
      const input = { ...buildDistrictAiSummaryInput(aggregate, '2026-08-12'), 구: district };
      const text = renderAuthoredDistrictAiSummary(input);
      assert.match(text, new RegExp(district));
      assert.ok(text.length > 250, `${district} analysis must be substantive`);
    }
  });

  test('rejects malformed summary input', () => {
    assert.throws(() => buildDistrictAiSummaryInput(null, '2026-08-12'), TypeError);
    assert.throws(() => buildDistrictAiSummaryInput(aggregate, 'today'), TypeError);
    assert.throws(() => renderAuthoredDistrictAiSummary(null), TypeError);
    assert.throws(() => renderAuthoredDistrictAiSummary({}), TypeError);
    assert.throws(() => renderAuthoredDistrictAiSummary({ ...buildDistrictAiSummaryInput(aggregate, '2026-08-12'), 구: '없는구' }), TypeError);
  });
});

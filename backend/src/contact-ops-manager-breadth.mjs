const CASE_ID_PATTERN = /^SYN-HH-\d{10}-\d{4}$/;
const ACUTE_GRADES = ['정상', '주시', '방문권고', '방문권고-우선'];
const VULNERABILITY_BANDS = ['0_24', '25_49', '50_74', '75_100'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function expectedAcuteGrade(score) {
  if (score >= 75) return '방문권고-우선';
  if (score >= 55) return '방문권고';
  if (score >= 30) return '주시';
  return '정상';
}

function vulnerabilityBand(score) {
  if (score >= 75) return '75_100';
  if (score >= 50) return '50_74';
  if (score >= 25) return '25_49';
  return '0_24';
}

function assertScore(value, label) {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new TypeError(`${label} must be an integer from 0 to 100`);
  }
}

function assertLocation(location) {
  if (!isObject(location)
      || typeof location.current_district_name_20260701 !== 'string'
      || typeof location.current_admin_dong_name_20260701 !== 'string'
      || !Number.isFinite(location.latitude)
      || location.latitude < -90
      || location.latitude > 90
      || !Number.isFinite(location.longitude)
      || location.longitude < -180
      || location.longitude > 180) {
    throw new TypeError('synthetic record location is invalid');
  }
}

function assertTriage(triage) {
  if (!isObject(triage)) throw new TypeError('manager breadth record requires triage');
  assertScore(triage.급성도_점수, '급성도_점수');
  assertScore(triage.취약도_점수, '취약도_점수');
  if (triage.급성도_등급 !== expectedAcuteGrade(triage.급성도_점수)) {
    throw new TypeError('급성도_등급 does not match 급성도_점수');
  }
  if (!Array.isArray(triage.점수_기여내역)
      || triage.점수_기여내역.some(({ 축 } = {}) => !['급성도', '취약도'].includes(축))) {
    throw new TypeError('triage contribution trace is invalid');
  }
}

function assertRecord(record) {
  const household = record?.household;
  if (!isObject(record)
      || record.synthetic !== true
      || !isObject(household)
      || household.synthetic !== true
      || !CASE_ID_PATTERN.test(household.id || '')) {
    throw new TypeError('manager breadth accepts synthetic records only');
  }
  assertLocation(household.location);
  if (!isObject(household.workflow)) throw new TypeError('synthetic record workflow is invalid');
  if (record.triage !== null) assertTriage(record.triage);

  const approved = household.workflow.visit_approval_status === 'approved';
  const constraints = household.approved_visit_constraints;
  if (approved && (!isObject(constraints)
      || !Number.isFinite(constraints.max_route_distance_km)
      || constraints.max_route_distance_km <= 0
      || !Array.isArray(constraints.assigned_worker_ids)
      || constraints.assigned_worker_ids.length === 0)) {
    throw new TypeError('approved visit constraints are required after explicit approval');
  }
  if (!approved && constraints !== null) {
    throw new TypeError('approved visit constraints are forbidden before explicit approval');
  }
  if (['approved', 'recommended'].includes(household.workflow.visit_approval_status)
      && record.triage === null) {
    throw new TypeError('visit record requires triage evidence');
  }
  if (household.workflow.transfer_status === 'recommended' && record.triage === null) {
    throw new TypeError('transfer recommendation requires triage evidence');
  }
}

function assertTuningReport(report) {
  if (!isObject(report)
      || report.자료_성격 !== 'synthetic_scenario_simulation'
      || report.실제_개인_판정 !== false
      || !Number.isSafeInteger(report.전체_건수)
      || report.전체_건수 <= 0
      || !Number.isSafeInteger(report.경증_누적_우선권고_건수)
      || report.경증_누적_우선권고_건수 < 0
      || report.경증_누적_우선권고_건수 > report.전체_건수
      || !isObject(report.급성도_등급별_건수)
      || ACUTE_GRADES.some((grade) => !Number.isSafeInteger(report.급성도_등급별_건수[grade]))
      || ACUTE_GRADES.reduce((count, grade) => count + report.급성도_등급별_건수[grade], 0) !== report.전체_건수) {
    throw new TypeError('tuning report must be deterministic synthetic report evidence');
  }
}

function contributionForAxis(triage, axis) {
  return structuredClone(triage.점수_기여내역.filter(({ 축 }) => 축 === axis));
}

function scoreProjection(triage) {
  return {
    acute: {
      axis_label: '급성도',
      score: triage.급성도_점수,
      grade: triage.급성도_등급,
      contributions: contributionForAxis(triage, '급성도'),
    },
    vulnerability: {
      axis_label: '취약도',
      score: triage.취약도_점수,
      contributions: contributionForAxis(triage, '취약도'),
    },
  };
}

function transferProjection(record) {
  const { household, triage } = record;
  return {
    synthetic: true,
    displayMarker: '[합성]',
    case_id: household.id,
    revision: record.revision,
    status_label: '행정복지센터 이관 권고',
    district: household.location.current_district_name_20260701,
    admin_dong: household.location.current_admin_dong_name_20260701,
    follow_up_deadline: household.workflow.follow_up_deadline,
    last_connected_elapsed_days: triage.마지막_연결_후_경과일 ?? null,
    ...scoreProjection(triage),
  };
}

function orderTransferRecommendations(records) {
  return records
    .filter(({ household }) => household.workflow.transfer_status === 'recommended')
    .toSorted((left, right) => (
      right.triage.급성도_점수 - left.triage.급성도_점수
      || right.triage.취약도_점수 - left.triage.취약도_점수
      || (right.triage.마지막_연결_후_경과일 ?? -1)
        - (left.triage.마지막_연결_후_경과일 ?? -1)
      || left.household.id.localeCompare(right.household.id)
    ))
    .map(transferProjection);
}

function buildGradeDistribution(records) {
  const acute = Object.fromEntries(ACUTE_GRADES.map((grade) => [grade, 0]));
  const vulnerability = Object.fromEntries(VULNERABILITY_BANDS.map((band) => [band, 0]));
  let scoredCaseCount = 0;
  for (const { triage } of records) {
    if (triage === null) continue;
    acute[triage.급성도_등급] += 1;
    vulnerability[vulnerabilityBand(triage.취약도_점수)] += 1;
    scoredCaseCount += 1;
  }
  return {
    scored_case_count: scoredCaseCount,
    not_yet_scored_case_count: records.length - scoredCaseCount,
    acute: {
      axis_label: '급성도',
      primary_ordering_axis: true,
      grades: acute,
    },
    vulnerability: {
      axis_label: '취약도',
      primary_ordering_axis: false,
      score_bands: vulnerability,
    },
  };
}

export function haversineDistanceKm(left, right) {
  assertLocation(left);
  assertLocation(right);
  const radians = (degrees) => degrees * (Math.PI / 180);
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const leftLatitude = radians(left.latitude);
  const rightLatitude = radians(right.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371.0088 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function visitProjection(record, previous = null) {
  const { household } = record;
  return {
    synthetic: true,
    displayMarker: '[합성]',
    case_id: household.id,
    district: household.location.current_district_name_20260701,
    admin_dong: household.location.current_admin_dong_name_20260701,
    latitude: household.location.latitude,
    longitude: household.location.longitude,
    assigned_worker_ids: [...household.approved_visit_constraints.assigned_worker_ids],
    approved_max_route_distance_km: household.approved_visit_constraints.max_route_distance_km,
    ...(previous === null ? {} : {
      distance_from_previous_km: Number(haversineDistanceKm(
        previous.household.location,
        household.location,
      ).toFixed(3)),
    }),
  };
}

function nearestOrder(records) {
  const remaining = records.toSorted((left, right) => left.household.id.localeCompare(right.household.id));
  if (remaining.length === 0) return [];
  const ordered = [remaining.shift()];
  while (remaining.length > 0) {
    const previous = ordered.at(-1);
    remaining.sort((left, right) => (
      haversineDistanceKm(previous.household.location, left.household.location)
        - haversineDistanceKm(previous.household.location, right.household.location)
      || left.household.id.localeCompare(right.household.id)
    ));
    ordered.push(remaining.shift());
  }
  return ordered.map((record, index) => visitProjection(record, index === 0 ? null : ordered[index - 1]));
}

export function buildManagerBreadth({ records, tuningReport }) {
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  records.forEach(assertRecord);
  assertTuningReport(tuningReport);

  const approved = records.filter(
    ({ household }) => household.workflow.visit_approval_status === 'approved',
  );
  return {
    synthetic: true,
    displayMarker: '[합성]',
    transfer_recommendations: orderTransferRecommendations(records),
    grade_distribution: buildGradeDistribution(records),
    tuning_warning: {
      title: '합성 배점 튜닝 경고',
      current_mild_signal_count: tuningReport.경증_누적_우선권고_건수,
      source_case_count: tuningReport.전체_건수,
      source_contract: tuningReport.계약_버전,
      interpretation: '결정적 합성 시나리오의 배점 점검값이며 실제 개인 판정이 아닙니다.',
    },
    approved_visit_hint: {
      approved_visit_count: approved.length,
      label: '단순 근접 순서 · VRP 아님(차량 경로 최적화 미사용)',
      method_label: '단순 근접 순서 안내',
      optimization_or_dispatch: false,
      items: nearestOrder(approved),
    },
  };
}

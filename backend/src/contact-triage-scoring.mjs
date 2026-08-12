const ACUITY_AXIS = '급성도';
const VULNERABILITY_AXIS = '취약도';

const OBSERVATION_SIGN_KEYS = [
  '우편물_고지서_적체',
  '악취_벌레',
  '쓰레기_술병',
  '인기척_없이_TV_불',
  '외출_없음',
  '연락_두절',
];

const ACTION_BY_GRADE = new Map([
  ['정상', '재연락_예약'],
  ['주시', '재연락_기한_단축'],
  ['방문권고', '방문권고'],
  ['방문권고-우선', '방문권고_우선'],
]);

const DONG_CONTRIBUTION_CODES = [
  ['고령비율', '동단위_고령비율'],
  ['1인가구비율', '동단위_1인가구비율'],
  ['노후주택', '동단위_노후주택'],
  ['기초수급_밀도', '동단위_기초수급_밀도'],
];

const ACUITY_GRADES = ['정상', '주시', '방문권고', '방문권고-우선'];

function clampScore(score) {
  return Math.min(100, Math.max(0, score));
}

function gradeAcuity(score) {
  if (score >= 75) return '방문권고-우선';
  if (score >= 55) return '방문권고';
  if (score >= 30) return '주시';
  return '정상';
}

function noAnswerPoints(count) {
  if (count >= 3) return 45;
  if (count === 2) return 25;
  return 0;
}

function contribution({ axis = ACUITY_AXIS, code, basis, points, capped = false, source, documents }) {
  return {
    축: axis,
    코드: code,
    근거: basis,
    가산점: points,
    상한_적용: capped,
    출처: source,
    근거_문서: documents,
  };
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
}

function assertFiniteRange(value, minimum, maximum, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}`);
  }
}

function countObservedSigns(signs) {
  return OBSERVATION_SIGN_KEYS.reduce((count, key) => count + (signs[key] === true ? 1 : 0), 0);
}

function assertNullableBoolean(value, label) {
  if (![true, false, null].includes(value)) {
    throw new TypeError(`${label} must be boolean or null`);
  }
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${label} has an unsupported value`);
  }
}

function validateAcuityInput(input) {
  assertObject(input, 'input');
  assertObject(input.관찰_6징후, '관찰_6징후');
  const observedKeys = Object.keys(input.관찰_6징후);
  for (const key of OBSERVATION_SIGN_KEYS) {
    if (!Object.hasOwn(input.관찰_6징후, key)) {
      throw new TypeError(`관찰_6징후 missing required key: ${key}`);
    }
    assertNullableBoolean(input.관찰_6징후[key], `관찰_6징후.${key}`);
  }
  if (observedKeys.some((key) => !OBSERVATION_SIGN_KEYS.includes(key))) {
    throw new TypeError('관찰_6징후 contains an unknown key');
  }
  if (!Number.isInteger(input.연속_미응답_횟수) || input.연속_미응답_횟수 < 0) {
    throw new TypeError('연속_미응답_횟수 must be a non-negative integer');
  }
  assertEnum(input.식사상태, ['양호', '불량', '심각', null], '식사상태');
  assertEnum(input.위생상태, ['양호', '불량', null], '위생상태');
  assertNullableBoolean(input.공과금_2개월_이상_체납, '공과금_2개월_이상_체납');
  assertNullableBoolean(input.최근_건강_정신_괴로움, '최근_건강_정신_괴로움');
  assertNullableBoolean(input.평소_응답률_대비_급락, '평소_응답률_대비_급락');
  if (input.개인_평소_응답률 !== null) {
    assertFiniteRange(input.개인_평소_응답률, 0, 1, '개인_평소_응답률');
  }
}

export function calculateAcuityScore(input) {
  validateAcuityInput(input);
  const contributions = [];

  const missedContacts = input.연속_미응답_횟수 ?? 0;
  const missedContactPoints = noAnswerPoints(missedContacts);
  if (missedContactPoints > 0) {
    contributions.push(contribution({
      code: '연속_미응답',
      basis: `연속 미응답 ${missedContacts}회`,
      points: missedContactPoints,
      source: '연락_이력',
      documents: ['매뉴얼_p14', '매뉴얼_p48', '운영_배점표_v0.1.0'],
    }));
  }

  if (input.평소_응답률_대비_급락 === true) {
    contributions.push(contribution({
      code: '평소_응답률_대비_급락',
      basis: '개인 평소 응답률 대비 급락 판정',
      points: 20,
      source: '연락_이력',
      documents: ['운영_배점표_v0.1.0'],
    }));
  }

  const observedSignCount = countObservedSigns(input.관찰_6징후);
  if (observedSignCount > 0) {
    const rawObservationPoints = observedSignCount * 12;
    const observationPoints = Math.min(40, rawObservationPoints);
    contributions.push(contribution({
      code: '관찰_6징후',
      basis: `관찰 6징후 중 ${observedSignCount}개 확인`,
      points: observationPoints,
      capped: observationPoints < rawObservationPoints,
      source: '현장_관찰',
      documents: ['매뉴얼_p14', '매뉴얼_p48', '운영_배점표_v0.1.0'],
    }));
  }

  if (input.식사상태 === '심각' || input.식사상태 === '불량') {
    contributions.push(contribution({
      code: '식사상태',
      basis: `식사상태 ${input.식사상태}`,
      points: input.식사상태 === '심각' ? 25 : 12,
      source: '현장_관찰',
      documents: ['매뉴얼_p49', '운영_배점표_v0.1.0'],
    }));
  }

  if (input.위생상태 === '불량') {
    contributions.push(contribution({
      code: '위생상태',
      basis: '위생상태 불량',
      points: 10,
      source: '현장_관찰',
      documents: ['매뉴얼_p49', '운영_배점표_v0.1.0'],
    }));
  }

  if (input.공과금_2개월_이상_체납 === true) {
    contributions.push(contribution({
      code: '공과금_2개월_이상_체납',
      basis: '공과금 2개월 이상 체납 관찰 또는 보고',
      points: 10,
      source: '현장_관찰',
      documents: ['매뉴얼_p49', '운영_배점표_v0.1.0'],
    }));
  }

  if (input.최근_건강_정신_괴로움 === true) {
    contributions.push(contribution({
      code: '최근_건강_정신_괴로움',
      basis: '최근 건강 또는 정신적 괴로움 관찰',
      points: 12,
      source: '현장_관찰',
      documents: ['매뉴얼_p49', '운영_배점표_v0.1.0'],
    }));
  }

  const rawScore = contributions.reduce((sum, item) => sum + item.가산점, 0);
  const score = clampScore(rawScore);
  const grade = gradeAcuity(score);

  return {
    급성도_점수: score,
    급성도_원합계: rawScore,
    급성도_클램프_적용: rawScore !== score,
    급성도_등급: grade,
    권고_액션: ACTION_BY_GRADE.get(grade),
    점수_기여내역: contributions,
  };
}

export function calculateVulnerabilityScore(input) {
  assertObject(input, 'input');
  const dongContext = input.동단위_구조취약도;
  assertObject(dongContext, '동단위_구조취약도');
  assertFiniteRange(dongContext.점수, 0, 50, '동단위 구조취약도 점수');

  if (!Array.isArray(dongContext.기여내역)) {
    throw new TypeError('동단위 구조취약도 기여내역 must be an array');
  }

  const byCode = new Map();
  for (const item of dongContext.기여내역) {
    assertObject(item, '동단위 구조취약도 기여내역 item');
    if (byCode.has(item.코드)) {
      throw new TypeError(`동단위 구조취약도 기여내역 contains duplicate code: ${item.코드}`);
    }
    assertFiniteRange(item.가산점, 0, 50, `동단위 ${item.코드} 가산점`);
    byCode.set(item.코드, item);
  }

  const contributions = DONG_CONTRIBUTION_CODES.map(([inputCode, outputCode]) => {
    const item = byCode.get(inputCode);
    if (!item) {
      throw new TypeError(`동단위 구조취약도 기여내역 missing code: ${inputCode}`);
    }
    return contribution({
      axis: VULNERABILITY_AXIS,
      code: outputCode,
      basis: `${inputCode} 공개 동단위 집계 정규화 기여`,
      points: item.가산점,
      source: '공개_동단위_집계',
      documents: ['매뉴얼_p11', '운영_배점표_v0.1.0'],
    });
  });

  if (byCode.size !== DONG_CONTRIBUTION_CODES.length) {
    throw new TypeError('동단위 구조취약도 기여내역 contains an unknown code');
  }

  const dongContributionSum = contributions.reduce((sum, item) => sum + item.가산점, 0);
  if (Math.abs(dongContributionSum - dongContext.점수) > 1e-9) {
    throw new RangeError(
      `동단위 구조취약도 기여내역 합계 ${dongContributionSum}가 점수 ${dongContext.점수}와 다릅니다`,
    );
  }

  if (input.관계망_유무 === '없음') {
    contributions.push(contribution({
      axis: VULNERABILITY_AXIS,
      code: '관계망_없음',
      basis: '도움을 요청할 사람 또는 기관 관계망 없음',
      points: 25,
      source: '현장_관찰',
      documents: ['매뉴얼_p49', '운영_배점표_v0.1.0'],
    }));
  }

  if (['주_1회_미만', '없음'].includes(input.연락_빈도)) {
    contributions.push(contribution({
      axis: VULNERABILITY_AXIS,
      code: '사회적_고립',
      basis: `타인 연락 빈도 ${input.연락_빈도}`,
      points: 25,
      source: '현장_관찰',
      documents: ['매뉴얼_p11', '매뉴얼_p49', '운영_배점표_v0.1.0'],
    }));
  }

  const score = clampScore(contributions.reduce((sum, item) => sum + item.가산점, 0));
  return {
    취약도_점수: score,
    점수_기여내역: contributions,
  };
}

function recommendationStatus(currentStatus, acuityGrade) {
  if (!([null, '권고', '승인', '반려'].includes(currentStatus))) {
    throw new TypeError('방문_승인_상태 must be null, 권고, 승인, or 반려');
  }
  if (currentStatus !== null) return currentStatus;
  return ['방문권고', '방문권고-우선'].includes(acuityGrade) ? '권고' : null;
}

export function buildTriageQueue(inputs) {
  if (!Array.isArray(inputs)) {
    throw new TypeError('inputs must be an array');
  }

  return inputs.map((input) => {
    const acute = calculateAcuityScore(input);
    const vulnerability = calculateVulnerabilityScore(input);
    return {
      계약_버전: 'contact-triage-queue-item-v0.1.0',
      합성_운영데이터: true,
      케이스_id: input.케이스_id,
      급성도_점수: acute.급성도_점수,
      급성도_원합계: acute.급성도_원합계,
      급성도_클램프_적용: acute.급성도_클램프_적용,
      급성도_등급: acute.급성도_등급,
      취약도_점수: vulnerability.취약도_점수,
      점수_기여내역: [
        ...acute.점수_기여내역,
        ...vulnerability.점수_기여내역,
      ],
      권고_액션: acute.권고_액션,
      방문_승인_상태: recommendationStatus(input.방문_승인_상태, acute.급성도_등급),
      마지막_연결_후_경과일: input.마지막_연결_후_경과일,
      재연락_기한: input.재연락_기한,
    };
  }).sort((left, right) => {
    const leftElapsed = left.마지막_연결_후_경과일 ?? Number.NEGATIVE_INFINITY;
    const rightElapsed = right.마지막_연결_후_경과일 ?? Number.NEGATIVE_INFINITY;
    return right.급성도_점수 - left.급성도_점수
      || right.취약도_점수 - left.취약도_점수
      || rightElapsed - leftElapsed
      || String(left.케이스_id).localeCompare(String(right.케이스_id));
  });
}

export function auditMildSignalEscalations(inputs) {
  if (!Array.isArray(inputs)) {
    throw new TypeError('inputs must be an array');
  }

  for (const item of inputs) {
    assertObject(item, 'audit item');
    if (!Number.isInteger(item.연속_미응답_횟수)
        || !Object.hasOwn(item, '식사상태')
        || !Object.hasOwn(item, '평소_응답률_대비_급락')) {
      throw new TypeError(
        'audit anchor fields 연속_미응답_횟수, 식사상태, 평소_응답률_대비_급락 are required',
      );
    }
  }

  return inputs
    .filter((item) => item.급성도_점수 >= 75
      && item.연속_미응답_횟수 < 3
      && item.식사상태 !== '심각'
      && item.평소_응답률_대비_급락 !== true)
    .map((item) => ({
      케이스_id: item.케이스_id,
      급성도_점수: item.급성도_점수,
      급성도_등급: item.급성도_등급,
      기여_코드: item.점수_기여내역
        .filter(({ 축 }) => 축 === ACUITY_AXIS)
        .map(({ 코드 }) => 코드),
    }))
    .sort((left, right) => right.급성도_점수 - left.급성도_점수
      || String(left.케이스_id).localeCompare(String(right.케이스_id)));
}

export function summarizeTriageDistribution(inputs) {
  if (!Array.isArray(inputs)) {
    throw new TypeError('inputs must be an array');
  }
  const counts = Object.fromEntries(ACUITY_GRADES.map((grade) => [grade, 0]));
  for (const item of inputs) {
    if (!ACUITY_GRADES.includes(item.급성도_등급)) {
      throw new TypeError(`unknown 급성도_등급: ${item.급성도_등급}`);
    }
    counts[item.급성도_등급] += 1;
  }
  return {
    전체_건수: inputs.length,
    급성도_등급별_건수: counts,
  };
}

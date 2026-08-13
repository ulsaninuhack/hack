import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  auditMildSignalEscalations,
  buildTriageQueue,
  summarizeTriageDistribution,
} from '../src/contact-triage-scoring.mjs';
import { buildSyntheticScenarioInput } from '../src/contact-triage-synthetic-scenario.mjs';

const fixturePath = process.env.DATA_DIR
  ? join(process.env.DATA_DIR, 'synthetic-households.json')
  : new URL('../../public/data/synthetic-households.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

const inputs = fixture.households.map((household) => buildSyntheticScenarioInput(
  household,
  fixture.scenario_reference_date,
));
const queue = buildTriageQueue(inputs);
const inputById = new Map(inputs.map((input) => [input.케이스_id, input]));
const scoredCases = queue.map((item) => {
  const input = inputById.get(item.케이스_id);
  return {
    ...item,
    연속_미응답_횟수: input.연속_미응답_횟수,
    식사상태: input.식사상태,
    평소_응답률_대비_급락: input.평소_응답률_대비_급락,
  };
});
const distribution = summarizeTriageDistribution(scoredCases);
const mildEscalations = auditMildSignalEscalations(scoredCases);

const report = {
  계약_버전: 'contact-triage-distribution-report-v0.1.0',
  자료_성격: 'synthetic_scenario_simulation',
  실제_개인_판정: false,
  기준일: fixture.scenario_reference_date,
  전체_건수: distribution.전체_건수,
  현행_행정동_수: new Set(fixture.households.map(
    ({ location }) => location.current_admin_dong_code_20260701,
  )).size,
  지도구역_수: new Set(fixture.households.map(
    ({ location }) => location.geometry_zone_id,
  )).size,
  동단위_구조취약도_정규화_주입: false,
  급성도_등급별_건수: distribution.급성도_등급별_건수,
  경증_누적_우선권고_건수: mildEscalations.length,
  경증_누적_우선권고_표본: mildEscalations.slice(0, 20),
  해석_주의: [
    '케이스 ID 해시로 고정 시나리오를 배정한 배점 역전 감시용 합성 분포다.',
    '실제 개인 상태, 연락 결과, 복지 적격성 또는 방문 필요성을 나타내지 않는다.',
    '동단위 0~50 정규화 방식은 별도 검증 전이므로 이 리포트에는 주입하지 않았다.',
  ],
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

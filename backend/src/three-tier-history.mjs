// 사례별 과거 기록 타임라인과 기록 요약.
//
// 시연 데이터에는 실제 장기 이력이 없으므로, 사례 ID 해시로 결정론
// 합성 과거 기록을 만들고 현재 세션에 기록된 최신 연락 결과를 맨 위에
// 병합한다. 요약은 기록된 값의 비교만 서술한다. 위험 평가·미래 예측·
// 점수 생성은 이 모듈의 범위가 아니며 출력에서도 금지한다.
import { contactResultLabel, deriveCaseDisplayName } from './three-tier-ops.mjs';

const HISTORY_DEPTH = 5;
const MEAL_LEVELS = ['양호', '불량', '심각'];
const HYGIENE_LEVELS = ['양호', '불량'];
const RESULT_CODE_POOL = ['connected_ok', 'no_answer', 'connected_ok', 'connected_concern'];
const NO_ANSWER_LABEL = contactResultLabel('no_answer');
const FORBIDDEN_SUMMARY_PATTERN = /위험|예측|추정|점수|고위험/;

export const HISTORY_SOURCE_SYNTHETIC = '합성 과거 기록';
export const HISTORY_SOURCE_SESSION = '세션 기록';
export const HISTORY_SUMMARY_LABEL = '[AI 생성 · 기록 요약]';

function seedFor(caseId) {
  let hash = 0x811c9dc5;
  for (const ch of String(caseId)) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function shiftIsoDate(isoDate, days) {
  const value = new Date(`${isoDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function countSigns(signs) {
  if (!signs || typeof signs !== 'object') return 0;
  return Object.values(signs).filter((value) => value === true).length;
}

export function historyTrend(caseId) {
  return ['유지', '악화', '개선'][seedFor(caseId) % 3];
}

// 과거로 갈수록의 상태 심각도(0=양호, 1=가장 나쁨)를 추세별로 정의한다.
function severityAt(trend, index) {
  const oldness = index / HISTORY_DEPTH;
  if (trend === '악화') return 1 - oldness;
  if (trend === '개선') return oldness;
  return 0;
}

export function buildCaseHistory(record) {
  const { household } = record;
  const caseId = household.id;
  const seed = seedFor(caseId);
  const trend = historyTrend(caseId);
  const cadence = household.contact.contact_cadence_days || 7;
  const anchor = household.contact.last_contact_date ?? household.contact.next_contact_date ?? null;
  // gradeSource(three-tier-ops)와 같은 판정: triage가 있고 데모 사전 기록이
  // 아니면 이 세션에서 조사원이 제출한 기록이다.
  const sessionRecorded = record.triage != null && record.triage.기록_출처 !== 'demo_precontact_record';

  const entries = [];
  if (anchor !== null) {
    const newestSeverity = severityAt(trend, 0);
    entries.push({
      일자: anchor,
      결과_라벨: contactResultLabel(household.contact.last_contact_result),
      식사상태: record.observations?.식사상태
        ?? (sessionRecorded ? null : MEAL_LEVELS[Math.round(newestSeverity * (MEAL_LEVELS.length - 1))]),
      위생상태: record.observations?.위생상태
        ?? (sessionRecorded ? null : HYGIENE_LEVELS[Math.round(newestSeverity * (HYGIENE_LEVELS.length - 1))]),
      특이_징후_수: sessionRecorded
        ? countSigns(record.observations?.관찰_6징후)
        : Math.round(newestSeverity * 3),
      출처: sessionRecorded ? HISTORY_SOURCE_SESSION : HISTORY_SOURCE_SYNTHETIC,
    });
    for (let index = 1; index <= HISTORY_DEPTH; index += 1) {
      const severity = severityAt(trend, index);
      const forcedNoAnswer = trend === '악화' && severity >= 0.7;
      entries.push({
        일자: shiftIsoDate(anchor, -cadence * index),
        결과_라벨: contactResultLabel(
          forcedNoAnswer ? 'no_answer' : RESULT_CODE_POOL[(seed >> (index * 2)) & 3],
        ),
        식사상태: MEAL_LEVELS[Math.round(severity * (MEAL_LEVELS.length - 1))],
        위생상태: HYGIENE_LEVELS[Math.round(severity * (HYGIENE_LEVELS.length - 1))],
        특이_징후_수: Math.round(severity * 3),
        출처: HISTORY_SOURCE_SYNTHETIC,
      });
    }
  }

  return {
    synthetic: true,
    displayMarker: '[합성]',
    case_id: caseId,
    display_name: deriveCaseDisplayName(caseId),
    trend_label: trend,
    source_note: '과거 기록은 시연용 합성 기록이며 세션에서 제출한 기록이 맨 위에 병합됩니다.',
    entries,
  };
}

export function deterministicHistorySummary(history) {
  const { entries } = history;
  if (entries.length === 0) return '요약할 기록이 없습니다.';
  const newest = entries[0];
  const oldest = entries[entries.length - 1];
  const noAnswerCount = entries.filter((entry) => entry.결과_라벨 === NO_ANSWER_LABEL).length;
  const sentences = [
    `최근 기록 ${entries.length}회 중 '${NO_ANSWER_LABEL}' ${noAnswerCount}회, 마지막 기록은 ${newest.일자} '${newest.결과_라벨}'입니다.`,
  ];
  if (newest.식사상태 !== null && oldest.식사상태 !== null && newest.식사상태 !== oldest.식사상태) {
    sentences.push(`기록상 식사 상태가 '${oldest.식사상태}'에서 '${newest.식사상태}'(으)로 바뀌었습니다.`);
  }
  return sentences.join(' ');
}

const SUMMARY_SYSTEM_PROMPT = [
  '당신은 돌봄 연락 기록 요약 도우미입니다.',
  '제공된 기록 목록만 근거로 한국어 2~3문장 요약을 만드세요.',
  '기록된 값의 변화(좋아짐·나빠짐)는 비교로만 서술하세요.',
  '기록에 없는 사실, 위험 평가, 미래 예측, 점수는 절대 쓰지 마세요.',
].join(' ');

export function createHistorySummarizer({
  apiKey = null,
  fetchImpl = globalThis.fetch,
  model = 'gpt-4o-mini',
  timeoutMs = 6000,
} = {}) {
  return Object.freeze({
    async summarize(history) {
      const fallback = {
        summary_text: deterministicHistorySummary(history),
        generator: 'deterministic_v1',
        label: HISTORY_SUMMARY_LABEL,
      };
      if (!apiKey || history.entries.length === 0) return fallback;
      try {
        const response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model,
            temperature: 0.2,
            max_tokens: 220,
            messages: [
              { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
              {
                role: 'user',
                content: JSON.stringify({
                  display_name: history.display_name,
                  entries: history.entries,
                }),
              },
            ],
            response_format: {
              type: 'json_schema',
              json_schema: {
                name: 'history_summary',
                strict: true,
                schema: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['summary'],
                  properties: { summary: { type: 'string' } },
                },
              },
            },
          }),
        });
        if (!response.ok) return fallback;
        const payload = await response.json();
        const summary = JSON.parse(payload.choices?.[0]?.message?.content ?? '{}').summary;
        if (typeof summary !== 'string' || summary.trim() === '' || summary.length > 600
            || FORBIDDEN_SUMMARY_PATTERN.test(summary)) {
          return fallback;
        }
        return {
          summary_text: summary.trim(),
          generator: 'openai_runtime_v1',
          label: HISTORY_SUMMARY_LABEL,
        };
      } catch {
        return fallback;
      }
    },
  });
}

export function buildCenterCalendar(records, { month }) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) {
    throw new TypeError('month must use the YYYY-MM form');
  }
  const days = new Map();
  for (const record of records) {
    const history = buildCaseHistory(record);
    for (const entry of history.entries) {
      if (!entry.일자.startsWith(`${month}-`)) continue;
      const day = days.get(entry.일자) ?? { 일자: entry.일자, 기록_수: 0, 미응답_수: 0, 사례: [] };
      day.기록_수 += 1;
      if (entry.결과_라벨 === NO_ANSWER_LABEL) day.미응답_수 += 1;
      day.사례.push({
        case_id: history.case_id,
        display_name: history.display_name,
        결과_라벨: entry.결과_라벨,
        출처: entry.출처,
      });
      days.set(entry.일자, day);
    }
  }
  return {
    synthetic: true,
    displayMarker: '[합성]',
    month,
    source_note: '과거 기록은 시연용 합성 기록이며 세션에서 제출한 기록이 반영됩니다.',
    days: [...days.values()].toSorted((left, right) => left.일자.localeCompare(right.일자)),
  };
}

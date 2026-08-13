import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  HISTORY_SOURCE_SESSION,
  HISTORY_SOURCE_SYNTHETIC,
  HISTORY_SUMMARY_LABEL,
  buildCaseHistory,
  buildCenterCalendar,
  createHistorySummarizer,
  deterministicHistorySummary,
  historyTrend,
} from '../src/three-tier-history.mjs';

function record(caseId, overrides = {}) {
  return {
    household: {
      id: caseId,
      location: { current_admin_dong_code_20260701: caseId.slice(7, 17) },
      contact: {
        last_contact_date: '2026-08-11',
        last_contact_result: 'no_answer',
        contact_cadence_days: 7,
        next_contact_date: '2026-08-12',
        ...overrides.contact,
      },
    },
    observations: overrides.observations ?? null,
    triage: overrides.triage ?? null,
  };
}

function caseIdForTrend(wanted) {
  for (let index = 1; index < 500; index += 1) {
    const caseId = `SYN-HH-2812551000-${String(index).padStart(4, '0')}`;
    if (historyTrend(caseId) === wanted) return caseId;
  }
  throw new Error(`no case id found for trend ${wanted}`);
}

describe('three-tier case history', () => {
  test('builds a deterministic newest-first timeline anchored on the last contact', () => {
    const first = buildCaseHistory(record('SYN-HH-2812551000-0001'));
    const second = buildCaseHistory(record('SYN-HH-2812551000-0001'));
    assert.deepEqual(first, second);
    assert.equal(first.synthetic, true);
    assert.equal(first.entries.length, 6);
    assert.equal(first.entries[0].일자, '2026-08-11');
    assert.equal(first.entries[1].일자, '2026-08-04');
    assert.equal(first.entries[5].일자, '2026-07-07');
    assert.ok(first.entries.every((entry) => entry.출처 === HISTORY_SOURCE_SYNTHETIC));
    assert.match(first.display_name, /.+/);
  });

  test('marks the newest entry as a session record and reuses submitted observations', () => {
    const history = buildCaseHistory(record('SYN-HH-2812551000-0001', {
      triage: { 기록_출처: '세션 기록' },
      observations: {
        식사상태: '심각',
        위생상태: '불량',
        관찰_6징후: { 우편물_고지서_적체: true, 악취_벌레: true, 쓰레기_술병: false },
      },
    }));
    assert.equal(history.entries[0].출처, HISTORY_SOURCE_SESSION);
    assert.equal(history.entries[0].식사상태, '심각');
    assert.equal(history.entries[0].위생상태, '불량');
    assert.equal(history.entries[0].특이_징후_수, 2);
    assert.equal(history.entries[1].출처, HISTORY_SOURCE_SYNTHETIC);
  });

  test('returns an empty timeline when no contact date can anchor it', () => {
    const history = buildCaseHistory(record('SYN-HH-2812551000-0001', {
      contact: { last_contact_date: null, next_contact_date: null },
    }));
    assert.deepEqual(history.entries, []);
  });

  test('covers worsening, improving, and stable synthetic trends', () => {
    const worse = buildCaseHistory(record(caseIdForTrend('악화')));
    assert.equal(worse.entries[1].식사상태, '심각');
    assert.equal(worse.entries[5].식사상태, '양호');
    assert.equal(worse.entries[1].결과_라벨, '연락 안 됨');

    const better = buildCaseHistory(record(caseIdForTrend('개선')));
    assert.equal(better.entries[1].식사상태, '양호');
    assert.equal(better.entries[5].식사상태, '심각');

    const stable = buildCaseHistory(record(caseIdForTrend('유지')));
    assert.ok(stable.entries.slice(1).every((entry) => entry.식사상태 === '양호'));
  });

  test('deterministic summary quotes recorded values only', () => {
    const summary = deterministicHistorySummary(buildCaseHistory(record(caseIdForTrend('악화'))));
    assert.match(summary, /최근 기록 6회 중 '연락 안 됨'/);
    assert.match(summary, /바뀌었습니다/);
    assert.match(summary, /개인 상태에 대한 판단이 아닙니다/);
    assert.doesNotMatch(summary, /위험|예측/);

    const empty = deterministicHistorySummary({ entries: [] });
    assert.match(empty, /요약할 기록이 없습니다/);
  });
});

describe('three-tier history summarizer', () => {
  const history = buildCaseHistory(record('SYN-HH-2812551000-0001'));
  let throwingFetchCalls = 0;
  const throwingFetch = async () => { throwingFetchCalls += 1; throw new Error('down'); };

  test('falls back to the deterministic summary without an API key', async () => {
    const result = await createHistorySummarizer().summarize(history);
    assert.equal(result.generator, 'deterministic_v1');
    assert.equal(result.label, HISTORY_SUMMARY_LABEL);
    assert.match(result.summary_text, /마지막 기록/);
  });

  test('never calls the model for an empty timeline', async () => {
    const before = throwingFetchCalls;
    const summarizer = createHistorySummarizer({ apiKey: 'k', fetchImpl: throwingFetch });
    const result = await summarizer.summarize({ ...history, entries: [] });
    assert.equal(throwingFetchCalls, before);
    assert.equal(result.generator, 'deterministic_v1');
  });

  test('uses the runtime model output and appends the fixed closing note', async () => {
    const summarizer = createHistorySummarizer({
      apiKey: 'k',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ summary: '기록상 식사 상태가 양호에서 불량으로 바뀌었습니다.' }) } }],
        }),
      }),
    });
    const result = await summarizer.summarize(history);
    assert.equal(result.generator, 'openai_runtime_v1');
    assert.equal(result.label, HISTORY_SUMMARY_LABEL);
    assert.match(result.summary_text, /바뀌었습니다\. 합성 시연 기록의 요약이며/);
  });

  test('rejects model output that adds forbidden framing', async () => {
    const summarizer = createHistorySummarizer({
      apiKey: 'k',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ summary: '위험이 커지고 있습니다.' }) } }],
        }),
      }),
    });
    const result = await summarizer.summarize(history);
    assert.equal(result.generator, 'deterministic_v1');
  });

  test('falls back on transport errors and non-2xx responses', async () => {
    const failing = createHistorySummarizer({ apiKey: 'k', fetchImpl: throwingFetch });
    assert.equal((await failing.summarize(history)).generator, 'deterministic_v1');
    assert.ok(throwingFetchCalls > 0);
    const rejected = createHistorySummarizer({ apiKey: 'k', fetchImpl: async () => ({ ok: false }) });
    assert.equal((await rejected.summarize(history)).generator, 'deterministic_v1');
  });
});

describe('three-tier center calendar', () => {
  test('aggregates per-day counts for the requested month', () => {
    const records = [record('SYN-HH-2812551000-0001'), record('SYN-HH-2812551000-0002')];
    const calendar = buildCenterCalendar(records, { month: '2026-08' });
    assert.equal(calendar.month, '2026-08');
    assert.ok(calendar.days.length >= 2);
    const first = calendar.days[0];
    assert.ok(first.일자.startsWith('2026-08-'));
    assert.equal(first.기록_수, first.사례.length);
    assert.ok(first.미응답_수 <= first.기록_수);
    assert.match(first.사례[0].display_name, /.+/);
    const dates = calendar.days.map((day) => day.일자);
    assert.deepEqual(dates, [...dates].toSorted());
  });

  test('rejects a malformed month', () => {
    assert.throws(() => buildCenterCalendar([], { month: '2026-8' }), TypeError);
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, test } from 'node:test';

function runReport() {
  return spawnSync(process.execPath, ['scripts/report-contact-triage.mjs'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });
}

describe('deterministic synthetic triage distribution report', () => {
  test('covers all 5,869 tasks and preserves the 162 current-dong to 156 geometry contract', () => {
    const result = runReport();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);

    assert.equal(report.자료_성격, 'synthetic_scenario_simulation');
    assert.equal(report.실제_개인_판정, false);
    assert.equal(report.전체_건수, 5_869);
    assert.equal(report.현행_행정동_수, 162);
    assert.equal(report.지도구역_수, 156);
    assert.equal(report.동단위_구조취약도_정규화_주입, false);
    assert.equal(
      Object.values(report.급성도_등급별_건수).reduce((sum, count) => sum + count, 0),
      report.전체_건수,
    );
  });

  test('reports mild-signal priority escalations instead of hiding them', () => {
    const result = runReport();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);

    assert.ok(report.경증_누적_우선권고_건수 > 0);
    assert.ok(report.경증_누적_우선권고_표본.length > 0);
    assert.ok(report.경증_누적_우선권고_표본.length <= 20);
    assert.match(report.경증_누적_우선권고_표본[0].케이스_id, /^SYN-HH-\d{10}-\d{4}$/);
    assert.equal(Object.hasOwn(report, '종합_점수'), false);
  });

  test('is byte-deterministic for the same fixture', () => {
    const first = runReport();
    const second = runReport();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
  });
});

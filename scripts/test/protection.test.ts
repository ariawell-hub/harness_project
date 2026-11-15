// 필수 체크 출처 확인(0.2절, 운영 전환 체크리스트 1). 계획 20261114-ci-gates step4.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIONS_APP_ID, compareRequiredChecks, toRequiredChecks } from '../ci/protection.ts';
import { loadConfig } from '../lib/config.ts';
import { fixtureConfig, tmp, write } from './helpers.ts';

const APP = 4242;
const want = [
  { context: 'check', source: 'actions' as const },
  { context: 'plan-gate', source: 'recorder' as const },
  { context: 'risk-gate', source: 'recorder' as const },
];
const ci = { requiredChecks: want, recorderAppId: APP };
const ok = [
  { context: 'check', appId: ACTIONS_APP_ID },
  { context: 'plan-gate', appId: APP },
  { context: 'risk-gate', appId: APP },
];

test('toRequiredChecks: branches API 응답에서 context와 app_id를 뽑는다', () => {
  const raw = {
    protection: {
      required_status_checks: {
        checks: [
          { context: 'check', app_id: 15368 },
          { context: 'x', app_id: null },
        ],
      },
    },
  };
  assert.deepEqual(toRequiredChecks(raw), [
    { context: 'check', appId: 15368 },
    { context: 'x', appId: null },
  ]);
  assert.deepEqual(toRequiredChecks({ protection: { enabled: false } }), []);
  assert.deepEqual(toRequiredChecks(null), []);
});

test('compareRequiredChecks: 설정과 등록이 같으면 통과', () => {
  const r = compareRequiredChecks(ok, ci);
  assert.equal(r.ok, true, r.lines.join('\n'));
});

test('compareRequiredChecks: 누락, 출처 다름, 출처 없음(아무 출처), 여분을 보고한다', () => {
  const miss = compareRequiredChecks(ok.slice(0, 2), ci);
  assert.equal(miss.ok, false);
  assert.match(miss.lines.join('\n'), /risk-gate.*등록되지 않았다/);
  const src = compareRequiredChecks(
    [ok[0], { context: 'plan-gate', appId: ACTIONS_APP_ID }, ok[2]],
    ci,
  );
  assert.equal(src.ok, false);
  assert.match(src.lines.join('\n'), /plan-gate.*출처/);
  const any = compareRequiredChecks([ok[0], { context: 'plan-gate', appId: null }, ok[2]], ci);
  assert.equal(any.ok, false);
  const extra = compareRequiredChecks([...ok, { context: 'old', appId: null }], ci);
  assert.equal(extra.ok, false);
  assert.match(extra.lines.join('\n'), /old.*설정에 없다/);
});

test('loadConfig: ci.recorderBot이 문자열이 아니면 설정 오류', () => {
  const root = tmp('config-');
  const cfg = fixtureConfig() as { ci?: Record<string, unknown> };
  cfg.ci = { ...(cfg.ci ?? {}), recorderBot: 5764201 };
  write(root, 'harness.config.json', JSON.stringify(cfg));
  assert.throws(() => loadConfig(root), /ci\.recorderBot/);
  cfg.ci.recorderBot = 'harness-recorder[bot]';
  write(root, 'harness.config.json', JSON.stringify(cfg));
  assert.equal(loadConfig(root).ci.recorderBot, 'harness-recorder[bot]');
});

test('compareRequiredChecks: recorderAppId가 없으면 recorder 출처를 확인할 수 없어 실패', () => {
  const r = compareRequiredChecks(ok, { requiredChecks: want, recorderAppId: null });
  assert.equal(r.ok, false);
  assert.match(r.lines.join('\n'), /recorderAppId/);
});

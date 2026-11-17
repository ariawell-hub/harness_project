// 필수 체크 출처 확인(0.2절, 운영 전환 체크리스트 1). 계획 20261114-ci-gates step4.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { GATE_CONTEXTS, LEDGER_CONTEXT, REVIEW_CONTEXTS } from '../ci/results.ts';
import { ACTIONS_APP_ID, compareRequiredChecks, toRequiredChecks } from '../ci/protection.ts';
import { requiredCheckGuide } from '../commands/init.ts';
import { loadConfig } from '../lib/config.ts';
import { fixtureConfig, tmp, write } from './helpers.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

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

// 계획 20261115-review-ledger step5
test('이 리포의 설정: review-ledger가 검증 App 출처의 필수 체크이고 계획 검증(G1)이 켜져 있다', () => {
  const cfg = loadConfig(REPO_ROOT);
  assert.deepEqual(
    cfg.ci.requiredChecks.find((c) => c.context === LEDGER_CONTEXT),
    { context: 'review-ledger', source: 'recorder' },
  );
  // review-ledger는 판정 워크플로의 기록 job이 review/*와 함께 쓴다. 둘은 같이 등록한다
  for (const c of ['review/claude', 'review/codex'])
    assert.ok(cfg.ci.requiredChecks.some((x) => x.context === c && x.source === 'recorder'));
  assert.equal(cfg.planReview.required, true);
  // 등록에 review-ledger가 빠져 있으면 required-checks가 알려 준다
  const registered = cfg.ci.requiredChecks.map((c) => ({
    context: c.context,
    appId: c.source === 'actions' ? ACTIONS_APP_ID : cfg.ci.recorderAppId,
  }));
  assert.equal(compareRequiredChecks(registered, cfg.ci).ok, true);
  const missing = compareRequiredChecks(
    registered.filter((c) => c.context !== LEDGER_CONTEXT),
    cfg.ci,
  );
  assert.equal(missing.ok, false);
  assert.match(missing.lines.join('\n'), /review-ledger.*등록되지 않았다/);
});

test('init 안내: 등록할 필수 체크 목록은 설정(ci.requiredChecks)에서 만든다', () => {
  const guide = requiredCheckGuide(loadConfig(REPO_ROOT).ci.requiredChecks);
  assert.match(guide, /check\(GitHub Actions\)/);
  assert.match(guide, /review\/codex·review-ledger\(출처 = 검증 App/);
  for (const c of loadConfig(REPO_ROOT).ci.requiredChecks) assert.ok(guide.includes(c.context));
  // 설정에 필수 체크가 없으면 목록 대신 설정을 채우라고 안내한다
  assert.match(requiredCheckGuide([]), /ci\.requiredChecks/);
});

// 계획 20261116-ops-security step4
test('이 리포의 설정: 10.3절의 필수 체크가 모두 있고 revert-check의 출처는 검증 App이다', () => {
  const cfg = loadConfig(REPO_ROOT);
  assert.deepEqual(
    cfg.ci.requiredChecks.find((c) => c.context === 'revert-check'),
    { context: 'revert-check', source: 'recorder' },
  );
  // 기록 job이 쓰는 context는 모두 검증 App 출처의 필수 체크다. check만 GitHub Actions다
  for (const c of [...GATE_CONTEXTS, ...REVIEW_CONTEXTS, LEDGER_CONTEXT])
    assert.ok(
      cfg.ci.requiredChecks.some((x) => x.context === c && x.source === 'recorder'),
      c,
    );
  assert.deepEqual(
    cfg.ci.requiredChecks.filter((c) => c.source === 'actions').map((c) => c.context),
    ['check'],
  );
  // 등록에 revert-check가 빠져 있으면 required-checks가 알려 준다
  const registered = cfg.ci.requiredChecks.map((c) => ({
    context: c.context,
    appId: c.source === 'actions' ? ACTIONS_APP_ID : cfg.ci.recorderAppId,
  }));
  const missing = compareRequiredChecks(
    registered.filter((c) => c.context !== 'revert-check'),
    cfg.ci,
  );
  assert.equal(missing.ok, false);
  assert.match(missing.lines.join('\n'), /revert-check.*등록되지 않았다/);
  // 제작자에게 주는 등록 목록(init 안내)에도 나온다
  assert.match(requiredCheckGuide(cfg.ci.requiredChecks), /revert-check/);
});

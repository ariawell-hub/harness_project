// ops-check: 운영 전환 체크리스트 1~3을 읽기만으로 확인한다(10.4절). 계획 20261116-ops-security step4.
// 확인하지 못한 항목은 ok가 아니다. 종료 코드 0은 세 항목이 모두 ok일 때뿐이다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { ACTIONS_APP_ID } from '../ci/protection.ts';
import { formatOps, opsCheck, type OpsItem } from '../commands/ops-check.ts';
import { CODEOWNERS_FILE, codeownersText } from '../gates/codeowners.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { FakeGitHub, initFakeState, type FakeState } from '../lib/github-fake.ts';
import { parseScopes, type GitHubPort } from '../lib/github.ts';
import { HARNESS_ROOT, fixtureConfig, makeFixture, write, type Fixture } from './helpers.ts';

const APP = 4242;
const REQUIRED = [
  { context: 'check', source: 'actions' as const },
  { context: 'revert-check', source: 'recorder' as const },
  { context: 'plan-gate', source: 'recorder' as const },
  { context: 'risk-gate', source: 'recorder' as const },
  { context: 'deps-guard', source: 'recorder' as const },
  { context: 'harness-guard', source: 'recorder' as const },
  { context: 'review/claude', source: 'recorder' as const },
  { context: 'review/codex', source: 'recorder' as const },
  { context: 'review-ledger', source: 'recorder' as const },
];
const REGISTERED = REQUIRED.map((c) => ({
  context: c.context,
  app_id: c.source === 'actions' ? ACTIONS_APP_ID : APP,
}));
const CONFIG = {
  protectedPaths: ['scripts/**', 'harness.config.json'],
  ci: { requiredChecks: REQUIRED, recorderAppId: APP, recorderBot: 'harness-recorder[bot]' },
};

// 임시 리포는 파일 전체가 하나를 나눠 쓴다(만드는 데 몇 초 걸린다). 사례마다 설정과 가짜 GitHub 상태 파일만 바꾼다
let shared: Fixture | null = null;
let seq = 0;
after(() => shared?.cleanup());

/** 세 항목이 모두 맞는 리포와 가짜 GitHub. over로 가짜 GitHub의 상태를, config로 설정을 바꾼다 */
function setup(
  over: Partial<FakeState> = {},
  config: Record<string, unknown> = {},
): { fx: Fixture; state: string; gh: FakeGitHub } {
  const fx = (shared ??= makeFixture(CONFIG));
  write(
    fx.root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ ...CONFIG, ...config }), null, 2),
  );
  write(fx.root, CODEOWNERS_FILE, codeownersText(loadConfig(fx.root)));
  const state = path.join(fx.dir, `github-${seq++}.json`);
  initFakeState(state, {
    remote: fx.remote,
    requiredChecks: REGISTERED,
    tokenScopes: ['read:org', 'repo'],
    ...over,
  });
  return { fx, state, gh: new FakeGitHub(state) };
}

/** 사례 하나를 만들어 바로 판정한다. wrap으로 포트의 메서드를 바꿔 끼운다 */
function check(
  over: Partial<FakeState> = {},
  config: Record<string, unknown> = {},
  wrap: (gh: GitHubPort) => GitHubPort = (gh) => gh,
): OpsItem[] {
  const { fx, gh } = setup(over, config);
  return opsCheck({ root: fx.root, cfg: loadConfig(fx.root), gh: wrap(gh) });
}
const item = (items: OpsItem[], n: number) => items.find((i) => i.n === n)!;
const text = (i: OpsItem) => i.lines.join('\n');
/** 메서드 하나가 예외를 던지는 포트 */
const failing = (name: 'branchInfo' | 'tokenScopes') => (gh: GitHubPort) =>
  Object.assign(Object.create(gh) as GitHubPort, {
    [name]() {
      throw new Error('gh api 실패: HTTP 502\n둘째 줄');
    },
  });

const cli = (args: string[], cwd: string, state: string) =>
  runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/harness.ts'), ...args], {
    cwd,
    env: { ...process.env, HARNESS_FAKE_GH: state },
  });

test('parseScopes: 응답 머리말의 x-oauth-scopes만 읽는다. 머리말이 없으면 null이다', () => {
  const head = (lines: string[]) => lines.join('\r\n') + '\r\n\r\n{"login":"bot"}';
  assert.deepEqual(
    parseScopes(
      head(['HTTP/2.0 200 OK', 'X-Accepted-Oauth-Scopes: ', 'X-Oauth-Scopes: read:org, repo']),
    ),
    ['read:org', 'repo'],
  );
  assert.deepEqual(parseScopes(head(['HTTP/2.0 200 OK', 'x-oauth-scopes: repo,workflow'])), [
    'repo',
    'workflow',
  ]);
  // 범위가 없는 클래식 토큰: 머리말은 있고 값이 비어 있다
  assert.deepEqual(parseScopes(head(['HTTP/2.0 200 OK', 'X-Oauth-Scopes: '])), []);
  // 세분화 토큰: 머리말이 없다
  assert.equal(parseScopes(head(['HTTP/2.0 200 OK', 'Content-Type: application/json'])), null);
  // 본문에 같은 글자가 있어도 머리말로 보지 않는다
  assert.equal(parseScopes('HTTP/2.0 200 OK\r\nEtag: "x"\r\n\r\nx-oauth-scopes: repo\r\n'), null);
});

test('opsCheck: 등록·출처, CODEOWNERS, 권한 범위가 모두 맞으면 세 항목이 ok다', () => {
  const { fx, state, gh } = setup({ codeOwnerReview: true });
  const before = readFileSync(state, 'utf8');
  const items = opsCheck({ root: fx.root, cfg: loadConfig(fx.root), gh });
  assert.deepEqual(
    items.map((i) => `${i.n}:${i.state}`),
    ['1:ok', '2:ok', '3:ok'],
    formatOps(items).join('\n'),
  );
  assert.match(text(item(items, 1)), /✓ revert-check: 출처 recorder\(4242\)/);
  assert.match(text(item(items, 2)), /✓ .*코드 오너 리뷰 필수가 켜져 있다/);
  assert.match(text(item(items, 3)), /✓ .*workflow 권한이 없다\(범위: read:org, repo\)/);
  // 봇이 읽을 수 없는 것은 제작자 확인으로 적는다
  assert.match(text(item(items, 3)), /제작자 확인.*REVERT_BOT_TOKEN/);
  assert.match(text(item(items, 3)), /이 명령을 실행한 머신의 토큰/);
  // 읽기만 한다
  assert.equal(readFileSync(state, 'utf8'), before);
});

test('opsCheck 1번: 필수 체크 누락·출처 다름, 설정에서 빠진 체크는 fail이고 읽지 못하면 unknown이다', () => {
  const without = (context: string) => REGISTERED.filter((c) => c.context !== context);
  const from = (context: string, app_id: number | null) =>
    REGISTERED.map((c) => (c.context === context ? { ...c, app_id } : c));

  const miss = item(check({ requiredChecks: without('revert-check') }), 1);
  assert.equal(miss.state, 'fail');
  assert.match(text(miss), /✗ revert-check: 필수 체크로 등록되지 않았다/);

  const src = item(check({ requiredChecks: from('plan-gate', ACTIONS_APP_ID) }), 1);
  assert.equal(src.state, 'fail');
  assert.match(text(src), /✗ plan-gate: 출처가 다르다/);

  const any = item(check({ requiredChecks: from('risk-gate', null) }), 1);
  assert.equal(any.state, 'fail');
  assert.match(text(any), /risk-gate: 출처가 다르다\(등록 아무 출처/);

  // 설정에 revert-check가 없으면 등록과 설정이 서로 같아도 fail이다(10.3절의 필수 체크가 모두 있어야 한다)
  const short = item(
    check(
      { requiredChecks: without('revert-check') },
      {
        ci: { ...CONFIG.ci, requiredChecks: REQUIRED.filter((c) => c.context !== 'revert-check') },
      },
    ),
    1,
  );
  assert.equal(short.state, 'fail');
  assert.match(text(short), /✗ revert-check: 설정\(ci\.requiredChecks\)에 없다/);

  // check가 아닌 체크의 출처를 actions로 적은 설정은 등록이 그와 같아도 fail이다
  const loose = item(
    check(
      { requiredChecks: from('deps-guard', ACTIONS_APP_ID) },
      {
        ci: {
          ...CONFIG.ci,
          requiredChecks: REQUIRED.map((c) =>
            c.context === 'deps-guard' ? { ...c, source: 'actions' } : c,
          ),
        },
      },
    ),
    1,
  );
  assert.equal(loose.state, 'fail');
  assert.match(text(loose), /✗ deps-guard: 설정의 출처가 검증 App이 아니다/);

  const unread = item(check({}, {}, failing('branchInfo')), 1);
  assert.equal(unread.state, 'unknown');
  assert.match(text(unread), /\? .*읽지 못했다: gh api 실패: HTTP 502$/m);
});

test('opsCheck 2번: CODEOWNERS 파일이 맞으면 ok다. 리포 설정은 읽을 수 있을 때만 판정한다', () => {
  // 봇 토큰으로는 보호 규칙을 읽지 못한다: `?` 줄을 남기고 항목은 파일로 판정한다
  const unread = item(check(), 2);
  assert.equal(unread.state, 'ok');
  assert.match(text(unread), /✓ \.github\/CODEOWNERS/);
  assert.match(text(unread), /\? 코드 오너 리뷰 필수.*읽을 수 없다.*protected-needs-owner/);
  // 읽었는데 꺼져 있으면 fail
  const off = item(check({ codeOwnerReview: false }), 2);
  assert.equal(off.state, 'fail');
  assert.match(text(off), /✗ .*코드 오너 리뷰 필수가 꺼져 있다/);
  // 파일이 다르면 fail(구축 단계여도). 설정이 켜져 있어도 바뀌지 않는다
  const { fx, gh } = setup({ codeOwnerReview: true });
  write(fx.root, CODEOWNERS_FILE, '# 손으로 쓴 파일\n');
  const edited = item(opsCheck({ root: fx.root, cfg: loadConfig(fx.root), gh }), 2);
  assert.equal(edited.state, 'fail');
  assert.match(text(edited), /✗ .*만든 내용과 다르다/);
});

test('opsCheck 3번: 권한 범위에 workflow가 있으면 fail, 머리말이 없으면 unknown, 봇 계정이 아니면 fail이다', () => {
  const wf = item(check({ tokenScopes: ['read:org', 'repo', 'workflow'] }), 3);
  assert.equal(wf.state, 'fail');
  assert.match(text(wf), /✗ .*workflow 권한이 있다\(범위: read:org, repo, workflow\)/);
  const fine = item(check({ tokenScopes: null }), 3);
  assert.equal(fine.state, 'unknown');
  assert.match(text(fine), /\? .*x-oauth-scopes.*없다/);
  const maker = item(check({ me: 'maker' }), 3);
  assert.equal(maker.state, 'fail');
  assert.match(text(maker), /✗ .*\(maker\).*봇 계정\(harness-bot\)이 아니다/);
  const unread = item(check({}, {}, failing('tokenScopes')), 3);
  assert.equal(unread.state, 'unknown');
  assert.match(text(unread), /제작자 확인.*REVERT_BOT_TOKEN/);
});

test('ops-check 명령: 모두 맞으면 종료 코드 0, 하나라도 fail·unknown이면 1이다(읽기만 한다)', () => {
  const ok = setup();
  const before = readFileSync(ok.state, 'utf8');
  const a = cli(['ops-check'], ok.fx.root, ok.state);
  assert.equal(a.code, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /^✓ 1\. /m);
  assert.match(a.stdout, /^✓ 2\. /m);
  assert.match(a.stdout, /^✓ 3\. /m);
  assert.match(a.stdout, /ops-check: 통과/);
  assert.equal(readFileSync(ok.state, 'utf8'), before);

  const unknown = setup({ tokenScopes: null });
  const b = cli(['ops-check'], unknown.fx.root, unknown.state);
  assert.equal(b.code, 1, b.stdout + b.stderr);
  assert.match(b.stdout, /^\? 3\. /m);
  assert.match(b.stdout, /ops-check: 실패/);
  // --allow-unknown 같은 우회 옵션은 없다
  const forced = cli(['ops-check', '--allow-unknown'], unknown.fx.root, unknown.state);
  assert.notEqual(forced.code, 0);

  const fail = setup({ requiredChecks: REGISTERED.slice(0, 3) });
  const c = cli(['ops-check'], fail.fx.root, fail.state);
  assert.equal(c.code, 1, c.stdout + c.stderr);
  assert.match(c.stdout, /^✗ 1\. /m);
  assert.match(c.stdout, / {4}✗ risk-gate: 필수 체크로 등록되지 않았다/);
});

test('가짜 GitHub: 권한 범위와 코드 오너 리뷰 설정은 상태 파일의 값을 돌려주고, 없으면 null이다', () => {
  const { fx } = setup();
  const state = path.join(fx.dir, 'github-empty.json');
  initFakeState(state, { remote: fx.remote });
  const gh: GitHubPort = new FakeGitHub(state);
  assert.equal(gh.tokenScopes(), null);
  assert.equal(gh.codeOwnerReviewRequired('main'), null);
});

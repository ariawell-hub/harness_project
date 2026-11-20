// check-results.ts의 verify-playwright 검사 테스트: 기대와 어긋난 결과 파일을 통과시키지 않는다.
//   node --test lab/pilot-prep/test/*.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkVerifyPlaywright,
  PLAYWRIGHT_VERSION,
  VERIFY_BYPASS,
  VERIFY_CASES,
  type VerifyCase,
} from '../check-results.ts';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-results.ts');
const MARK = 'zqcheckmark01';
const PORTS = { other: 50001, tcp: 50002 };
const APP_PORT = 51000;

type Row = Record<string, unknown>;

function scenario(w: VerifyCase): Row {
  const s: Row = {
    file: w.files?.[0] ?? `e2e/t-${w.id}.spec.ts`,
    line: 3,
    status: 'passed',
    ok: w.exit === 0,
    observation: true,
    consoleErrors: 0,
    failedRequests: 0,
    blockedRequests: w.blocked ? 1 : 0,
    allowedConsoleErrors: w.allowed?.consoleErrors ?? 0,
    allowedFailedRequests: w.allowed?.failedRequests ?? 0,
  };
  if (w.blocked) s.failedRequests = 1;
  if (w.why === 'console') s.consoleErrors = 1;
  if (w.why === 'request') s.failedRequests = 1;
  if (w.why === 'skipped') s.status = 'skipped';
  if (w.why === 'failed') s.status = 'failed';
  if (w.why === 'no-observation' || w.why === 'skipped') {
    s.observation = false;
    s.consoleErrors = null;
    s.failedRequests = null;
  }
  return s;
}

function target(w: VerifyCase): string[] {
  if (!w.target) return [];
  const host = w.target.host === '<marker>.invalid' ? `${MARK}.invalid` : w.target.host;
  const port =
    w.target.port === 'app'
      ? APP_PORT
      : typeof w.target.port === 'number'
        ? w.target.port
        : PORTS[w.target.port];
  return [`${host}:${port}`];
}

/** 모든 기대를 채운 결과 */
function good(): { [k: string]: unknown; tool: Row; ports: Row; cases: Row[] } {
  return {
    tool: { playwright: PLAYWRIGHT_VERSION, chromium: 'x', node: 'v22.0.0', os: 'test' },
    bypass: VERIFY_BYPASS,
    marker: MARK,
    ports: { ...PORTS },
    selfCheck: true,
    traceOnlyInLocal: true,
    traces: 2,
    cases: VERIFY_CASES.map((w) => {
      const none = w.noEvidence || w.interrupt !== undefined;
      const scenarios = none ? [] : [scenario(w)];
      const row: Row = {
        id: w.id,
        exitCode: w.exit,
        signal: w.signal ?? null,
        appPort: w.noEvidence ? 0 : APP_PORT,
        targetHits: 0,
        denied: w.denied === 'some' ? 1 : 0,
        deniedTargets: target(w),
        scenarioFiles: scenarios.map((s) => s.file),
        scenarios,
        allowed: w.allowed ?? { consoleErrors: 0, failedRequests: 0 },
        blocked: w.blocked ? 1 : 0,
        evidenceFiles: w.noEvidence ? [] : ['summary.json', 'summary.md'],
        leftover: 0,
        swScriptHits: 0,
        markerInEvidence: false,
        deniedTargetInEvidence: false,
        markerFile: false,
      };
      if (w.interrupt) {
        row.started = true;
        row.signalSent = true;
        row.runningBeforeSignal = 8;
        row.browsersBeforeSignal = 4;
      }
      return row;
    }),
  };
}
const of = (r: { cases: Row[] }, id: string) => r.cases.find((c) => c.id === id)!;
const check = (r: unknown) => checkVerifyPlaywright(r).join('\n');

test('기대를 모두 채운 결과는 통과한다', () => {
  assert.deepEqual(checkVerifyPlaywright(good()), []);
});

test('사례가 빠지거나 더 있거나 겹치면 실패한다', () => {
  for (const w of VERIFY_CASES) {
    const missing = good();
    missing.cases = missing.cases.filter((c) => c.id !== w.id);
    assert.match(check(missing), new RegExp(`사례 ${w.id}가 0개다`));
  }
  const extra = good();
  extra.cases.push({ ...of(extra, 'pass'), id: 'extra' });
  assert.match(check(extra), /모르는 사례가 있다: extra/);
  const twice = good();
  twice.cases.push({ ...of(twice, 'pass') });
  assert.match(check(twice), /사례 pass가 2개다/);
  const notArray = good() as Record<string, unknown>;
  notArray.cases = {};
  assert.match(check(notArray), /cases가 객체 배열이 아니다/);
});

test('공통 기대: 어느 사례든 대상에 닿았거나 프로세스가 남았거나 증거에 다른 것이 있으면 실패한다', () => {
  for (const w of VERIFY_CASES) {
    const hit = good();
    of(hit, w.id).targetHits = 1;
    assert.match(check(hit), new RegExp(`${w.id}: targetHits: 1\\(기대 0\\)`));
    const left = good();
    of(left, w.id).leftover = 2;
    assert.match(check(left), new RegExp(`${w.id}: leftover: 2\\(기대 0\\)`));
    const more = good();
    of(more, w.id).evidenceFiles = ['screenshot.png', 'summary.json', 'summary.md'];
    assert.match(check(more), new RegExp(`${w.id}: evidenceFiles: `));
    const leak = good();
    of(leak, w.id).deniedTargetInEvidence = true;
    assert.match(check(leak), new RegExp(`${w.id}: deniedTargetInEvidence: true`));
    const mark = good();
    of(mark, w.id).markerInEvidence = true;
    assert.match(check(mark), new RegExp(`${w.id}: markerInEvidence: true`));
    const unknown = good();
    delete of(unknown, w.id).targetHits;
    assert.match(check(unknown), new RegExp(`${w.id}: targetHits: \\(없음\\)`));
  }
});

test('증거 묶음이 하나만 있거나 없으면 실패한다(아무것도 띄우지 않은 shell-arg는 없어야 한다)', () => {
  const one = good();
  of(one, 'pass').evidenceFiles = ['summary.json'];
  assert.match(check(one), /pass: evidenceFiles: \[summary\.json\]/);
  const none = good();
  of(none, 'console-error').evidenceFiles = [];
  assert.match(check(none), /console-error: evidenceFiles: /);
  const shell = good();
  of(shell, 'shell-arg').evidenceFiles = ['summary.json', 'summary.md'];
  assert.match(check(shell), /shell-arg: evidenceFiles: /);
});

test('종료 코드가 기대와 다르면 실패한다(신호로 끝나야 하는 사례는 종료 코드가 없어야 한다)', () => {
  for (const w of VERIFY_CASES) {
    const r = good();
    of(r, w.id).exitCode = w.exit === 0 ? 1 : 0;
    assert.match(check(r), new RegExp(`${w.id}: 종료 코드: `));
  }
  const signal = good();
  of(signal, 'signal').exitCode = 143;
  assert.match(check(signal), /signal: 종료 코드: 143\(기대 없음\(신호로 끝난다\)\)/);
});

// 구현 판정 F3: 신호 사례가 신호로 끝났는지, 시나리오가 시작된 뒤에 신호를 보냈는지를 본다
test('신호 사례: 하네스가 기대한 신호로 끝나지 않았으면 실패한다', () => {
  const wants = VERIFY_CASES.filter((w) => w.signal);
  assert.deepEqual(
    wants.map((w) => [w.id, w.signal, w.exit]),
    [
      ['signal', 'SIGTERM', null],
      ['signal-hup', 'SIGHUP', null],
    ],
  );
  for (const w of wants) {
    // 프로세스 수를 센 뒤 명령이 스스로 끝난 실행
    const natural = good();
    Object.assign(of(natural, w.id), { signal: null, exitCode: 0 });
    assert.match(check(natural), new RegExp(`${w.id}: 끝난 신호: null\\(기대 ${w.signal}\\)`));
    assert.match(check(natural), new RegExp(`${w.id}: 종료 코드: 0`));
    const other = good();
    of(other, w.id).signal = 'SIGKILL';
    assert.match(check(other), new RegExp(`${w.id}: 끝난 신호: SIGKILL\\(기대 ${w.signal}\\)`));
    const absent = good();
    delete of(absent, w.id).signal;
    assert.match(check(absent), new RegExp(`${w.id}: 끝난 신호: \\(없음\\)`));
  }
});

test('신호로 끝나지 않아야 하는 사례가 신호로 끝났으면 실패한다', () => {
  for (const w of VERIFY_CASES) {
    if (w.signal) continue;
    const r = good();
    of(r, w.id).signal = 'SIGTERM';
    assert.match(check(r), new RegExp(`${w.id}: 끝난 신호: SIGTERM\\(기대 없음\\)`));
  }
});

test('도중에 끊는 사례: 시나리오 시작을 보지 못했거나 신호를 보내지 못했으면 실패한다', () => {
  const wants = VERIFY_CASES.filter((w) => w.interrupt);
  assert.deepEqual(
    wants.map((w) => [w.id, w.interrupt]),
    [
      ['signal', 'harness'],
      ['signal-hup', 'harness'],
      ['runner-killed', 'runner'],
    ],
  );
  for (const w of wants) {
    for (const key of ['started', 'signalSent']) {
      const no = good();
      of(no, w.id)[key] = false;
      assert.match(check(no), new RegExp(`${w.id}: ${key}: false\\(기대 true\\)`));
      const absent = good();
      delete of(absent, w.id)[key];
      assert.match(check(absent), new RegExp(`${w.id}: ${key}: \\(없음\\)`));
    }
    const blind = good();
    of(blind, w.id).runningBeforeSignal = 2;
    assert.match(check(blind), new RegExp(`${w.id}: runningBeforeSignal: 2\\(기대 3 이상\\)`));
    const noBrowser = good();
    of(noBrowser, w.id).browsersBeforeSignal = 0;
    assert.match(check(noBrowser), new RegExp(`${w.id}: browsersBeforeSignal: 0\\(기대 1 이상\\)`));
  }
  // 실행기를 강제로 끝낸 사례: verify는 신호로 죽지 않고 스스로 실패로 끝난다
  const killed = VERIFY_CASES.find((w) => w.id === 'runner-killed')!;
  assert.equal(killed.exit, 1);
  assert.equal(killed.signal, undefined);
});

test('앱 주소 밖 사례: 거부 건수가 0이거나 그 사례의 대상이 기록에 없으면 실패한다', () => {
  for (const w of VERIFY_CASES.filter((c) => c.denied === 'some')) {
    const zero = good();
    of(zero, w.id).denied = 0;
    assert.match(check(zero), new RegExp(`${w.id}: denied: 0\\(기대 1 이상\\)`));
    const other = good();
    of(other, w.id).deniedTargets = ['elsewhere.invalid:80'];
    assert.match(check(other), new RegExp(`${w.id}: deniedTargets: `));
  }
  // 호스트는 같고 포트만 다른 기록은 그 사례의 대상이 아니다
  const port = good();
  of(port, 'app-alias').deniedTargets = [`localhost:${PORTS.other}`];
  assert.match(check(port), /app-alias: deniedTargets: /);
  const noApp = good();
  of(noApp, 'wss-same-port').appPort = 0;
  assert.match(check(noApp), /wss-same-port: 대상의 포트: 0/);
});

test('앱 주소 안에서 끝나는 사례: 거부 프록시에 닿은 것이 있으면 실패한다', () => {
  for (const w of VERIFY_CASES.filter((c) => c.denied === 'none')) {
    const r = good();
    of(r, w.id).denied = 1;
    assert.match(check(r), new RegExp(`${w.id}: denied: 1\\(기대 0\\)`));
  }
});

test('fixture의 관찰: 앱 주소 밖 사례는 blocked가 1 이상이고 나머지는 0이다', () => {
  const none = good();
  of(none, 'redirect-out').blocked = 0;
  assert.match(check(none), /redirect-out: blocked[^:]*: 0\(기대 1 이상\)/);
  const some = good();
  of(some, 'pass').blocked = 1;
  assert.match(check(some), /pass: blocked[^:]*: 1\(기대 0\)/);
});

test('시나리오 지정: 지정하지 않은 파일이 결과에 있으면 실패한다', () => {
  const r = good();
  of(r, 'exact-select').scenarioFiles = ['e2e/sel/a.spec.ts', 'e2e/sel/more-e2e/sel/a.spec.ts'];
  assert.match(check(r), /exact-select: scenarioFiles: /);
  const full = good();
  of(full, 'full-run').scenarioFiles = [];
  assert.match(check(full), /full-run: scenarioFiles: /);
});

test('의도한 실패: 뺀 건수가 분류별로 기대와 같아야 한다', () => {
  const both = good();
  of(both, 'allowed-failure').allowed = { consoleErrors: 0, failedRequests: 2 };
  assert.match(check(both), /allowed-failure: allowed: 콘솔 에러 0·실패한 요청 2\(기대 1·1\)/);
  const only = good();
  of(only, 'allowed-request-only').allowed = { consoleErrors: 1, failedRequests: 1 };
  assert.match(check(only), /allowed-request-only: allowed: /);
  // 선언으로 뺀 것이 있는데 통과했다고 적힌 경우
  const blocked = good();
  of(blocked, 'allow-blocked').exitCode = 0;
  assert.match(check(blocked), /allow-blocked: 종료 코드: 0\(기대 1\)/);
});

test('실패의 이유가 기대와 다르면 실패한다', () => {
  const first = (r: { cases: Row[] }, id: string) => (of(r, id).scenarios as Row[])[0];
  const noFixture = good();
  first(noFixture, 'no-fixture').observation = true;
  assert.match(check(noFixture), /no-fixture: 실패의 이유가 기대\(no-observation\)와 다르다/);
  const skipped = good();
  first(skipped, 'skipped').status = 'passed';
  assert.match(check(skipped), /skipped: 실패의 이유가 기대\(skipped\)와 다르다/);
  const consoleError = good();
  first(consoleError, 'console-error').consoleErrors = 0;
  assert.match(check(consoleError), /console-error: 실패의 이유가 기대\(console\)와 다르다/);
  const request = good();
  first(request, 'failed-request').failedRequests = 0;
  assert.match(check(request), /failed-request: 실패의 이유가 기대\(request\)와 다르다/);
  const marker = good();
  first(marker, 'marker').status = 'passed';
  assert.match(check(marker), /marker: 실패의 이유가 기대\(failed\)와 다르다/);
  const none = good();
  of(none, 'skipped').scenarios = [];
  assert.match(check(none), /skipped: 시나리오가 0개다/);
  const passed = good();
  first(passed, 'ws-same-port').status = 'failed';
  assert.match(check(passed), /ws-same-port: 통과한 실행인데/);
});

test('서비스 워커 스크립트 요청, 셸이 만든 표식 파일, 신호 전의 프로세스 수를 본다', () => {
  const sw = good();
  of(sw, 'service-worker').swScriptHits = 1;
  assert.match(check(sw), /service-worker: swScriptHits: 1\(기대 0\)/);
  const shell = good();
  of(shell, 'shell-arg').markerFile = true;
  assert.match(check(shell), /shell-arg: markerFile: true\(기대 false\)/);
  const blind = good();
  of(blind, 'signal').runningBeforeSignal = 0;
  assert.match(check(blind), /signal: runningBeforeSignal: 0\(기대 3 이상\)/);
  const absent = good();
  delete of(absent, 'signal').runningBeforeSignal;
  assert.match(check(absent), /signal: runningBeforeSignal: \(없음\)/);
});

test('도구 버전, 우회 값, 표식, 포트, 자기 점검, 산출물 위치가 어긋나면 실패한다', () => {
  const tool = good();
  tool.tool.playwright = '1.65.1';
  assert.match(check(tool), /tool\.playwright: 1\.65\.1\(기대 /);
  const bypass = good();
  bypass.bypass = '<-loopback>,127.0.0.1:<앱 포트>';
  assert.match(check(bypass), /bypass: /);
  const wide = good();
  wide.bypass = `${VERIFY_BYPASS},localhost`;
  assert.match(check(wide), /bypass: /);
  const marker = good();
  marker.marker = '';
  assert.match(check(marker), /marker가 영문 소문자·숫자/);
  const ports = good();
  ports.ports.other = 0;
  assert.match(check(ports), /ports\.other가 포트 번호가 아니다: 0/);
  const self = good() as Record<string, unknown>;
  delete self.selfCheck;
  assert.match(check(self), /selfCheck: \(없음\)\(기대 true\)/);
  const trace = good();
  trace.traceOnlyInLocal = false;
  assert.match(check(trace), /traceOnlyInLocal: false\(기대 true\)/);
});

test('객체가 아닌 결과는 실패한다', () => {
  assert.deepEqual(checkVerifyPlaywright(null), ['결과가 객체가 아니다']);
  assert.deepEqual(checkVerifyPlaywright([]), ['결과가 객체가 아니다']);
  assert.notDeepEqual(checkVerifyPlaywright({}), []);
});

test('문자열로 바꿀 수 없는 값과 깊게 중첩된 값이 어느 칸에 있어도 멈추지 않고 어긋난 점을 낸다', () => {
  const weird = () => JSON.parse('{"toString":null}') as never;
  const deep = () => {
    let v: unknown = {};
    for (let i = 0; i < 200_000; i++) v = i % 2 ? { a: v } : [v];
    return v as never;
  };
  for (const junk of [weird, deep]) {
    const KEYS = [
      'exitCode',
      'appPort',
      'targetHits',
      'denied',
      'deniedTargets',
      'scenarioFiles',
      'scenarios',
      'allowed',
      'blocked',
      'evidenceFiles',
      'leftover',
      'swScriptHits',
      'markerInEvidence',
      'deniedTargetInEvidence',
      'markerFile',
      'id',
    ];
    for (const key of KEYS) {
      const r = good();
      for (const c of r.cases) c[key] = junk();
      assert.notDeepEqual(checkVerifyPlaywright(r), [], key);
    }
    const lists = good();
    for (const c of lists.cases) {
      c.deniedTargets = [junk()];
      c.scenarioFiles = [junk()];
      c.evidenceFiles = [junk(), junk()];
      c.scenarios = [junk()];
      c.allowed = { consoleErrors: junk(), failedRequests: junk() };
    }
    assert.notDeepEqual(checkVerifyPlaywright(lists), []);
    const top = good() as Record<string, unknown>;
    for (const key of ['tool', 'bypass', 'marker', 'ports', 'selfCheck', 'traceOnlyInLocal'])
      top[key] = junk();
    const bad = check(top);
    assert.match(bad, /tool\.playwright: /);
    assert.match(bad, /bypass: (객체|배열\(길이 1\))\(기대 /);
    assert.match(bad, /marker가 영문 소문자·숫자/);
    assert.match(bad, /ports\.tcp가 포트 번호가 아니다/);
  }
});

test('명령행: 리포의 결과 파일(results/verify-playwright.json)이 통과한다', () => {
  const r = spawnSync(process.execPath, [SCRIPT, 'verify-playwright'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /verify-playwright: 통과/);
});

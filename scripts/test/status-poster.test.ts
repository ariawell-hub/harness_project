// 커밋 상태 쓰기의 다시 시도(githubStatusPoster)를 가짜 GitHub API 서버로 확인한다. 계획 20261122-status-post-retry step0.
// 요청은 늘 이 파일의 서버(127.0.0.1)로만 간다. 대기와 시계는 주입해 실제로 기다리지 않는다(명령 실행 테스트 하나만 실제로 기다린다)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import * as record from '../ci/record.ts';
import { RECORDED_CONTEXTS, type StatusPayload } from '../ci/results.ts';
import { parseReviewLog } from '../runner/review.ts';
import { HARNESS_ROOT, tmp } from './helpers.ts';

const HEAD = '1'.repeat(40);
const TOKEN = 'status-token-51c0';
const BODY_MARK = 'SERVER-BODY-7f3a';
const PAYLOAD: StatusPayload = { context: 'plan-gate', state: 'success', description: '통과' };

/**
 * 서버가 요청마다 차례로 쓰는 응답. 숫자는 HTTP 상태, 'drop'은 응답 없이 연결을 끊는다.
 * 'hang'은 연결을 둔 채 답하지 않고, 'slow'는 0.15초 뒤에 201로 답한다. 다 쓰면 201이다.
 * `[코드, ms]`는 그 코드로 답하고 가짜 시계를 `takesMs` 대신 ms만큼 돌린다(요청마다 걸린 시간을 따로 정한다)
 */
type Step = number | 'drop' | 'hang' | 'slow' | [code: number, takesMs: number];
const srv = {
  script: [] as Step[],
  /** 요청 하나가 걸린 것으로 칠 시간(가짜 시계를 이만큼 돌린다) */
  takesMs: 0,
  requests: [] as { method: string; url: string; auth: string; body: unknown }[],
};
/** 가짜 시계. `overshootMs`는 대기가 예정보다 길어진 것으로 칠 시간이다 */
const clock = { t: 0, sleeps: [] as number[], overshootMs: 0 };
let server: Server;
let api = '';

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      srv.requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        auth: req.headers.authorization ?? '',
        body: JSON.parse(body || 'null'),
      });
      const next = srv.script.shift() ?? 201;
      const [step, takes] = Array.isArray(next) ? next : [next, srv.takesMs];
      clock.t += takes;
      if (step === 'drop') return void req.socket.destroy();
      if (step === 'hang') return;
      if (step === 'slow') return void setTimeout(() => res.writeHead(201).end('{}'), 150);
      res.writeHead(step, { 'content-type': 'application/json' });
      res.end(JSON.stringify(step < 300 ? {} : { message: BODY_MARK }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  // 답하지 않고 둔 연결을 닫는다
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  srv.script = [];
  srv.takesMs = 0;
  srv.requests = [];
  clock.t = 0;
  clock.sleeps = [];
  clock.overshootMs = 0;
});

/** 대기와 시계를 가짜로 바꾼 poster. 로그 줄은 lines에 모은다 */
function poster() {
  const lines: string[] = [];
  const post = record.githubStatusPoster({
    token: TOKEN,
    repo: 'o/r',
    sha: HEAD,
    targetUrl: 'https://example.invalid/run/1',
    apiUrl: api,
    log: (l) => lines.push(l),
    sleep: async (ms) => {
      clock.sleeps.push(ms);
      clock.t += ms + clock.overshootMs;
    },
    now: () => clock.t,
  });
  return { post, lines };
}
/**
 * 상태 쓰기의 결과를 값으로 받는다: 끝났으면 'ok', 예외면 'rejected: <글>', 정한 시간 안에 끝나지 않았으면 'pending'.
 * 예외나 긴 대기가 단언보다 먼저 테스트를 끝내지 않게 한다(이 변경 전의 코드는 답이 없는 요청을 30초 기다린다).
 * 끝나지 않았으면 서버에 남은 연결을 닫는다(답하지 않고 둔 요청이 뒤에 남지 않는다)
 */
async function outcome(p: Promise<void>, maxMs = 3_000): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string>((r) => {
    timer = setTimeout(() => r('pending'), maxMs);
  });
  const settled = p.then(
    () => 'ok',
    (e: Error) => `rejected: ${e.message}`,
  );
  const result = await Promise.race([settled, late]);
  clearTimeout(timer);
  if (result === 'pending') server.closeAllConnections();
  return result;
}
const [W1, W2, W3] = [2_000, 6_000, 15_000];
const TIMEOUT = 30_000;
const BUDGET = 60_000;
const MIN_REQUEST = 5_000;

/** 대기와 시계가 진짜인 poster. 다시 시도의 값을 짧게 바꿔 실제 시간 제한을 본다 */
function realPoster(retry: Partial<record.StatusRetry>) {
  const lines: string[] = [];
  const post = record.githubStatusPoster({
    token: TOKEN,
    repo: 'o/r',
    sha: HEAD,
    targetUrl: 'https://example.invalid/run/1',
    apiUrl: api,
    log: (l) => lines.push(l),
    retry,
  });
  return { post, lines };
}

test('다시 시도의 값: 요청은 상태 하나에 4번까지, 더하는 시간의 상한은 record job의 시간 제한(5분)보다 작다', () => {
  assert.deepEqual(record.STATUS_RETRY, {
    attempts: 4,
    waitsMs: [W1, W2, W3],
    timeoutMs: TIMEOUT,
    budgetMs: BUDGET,
    minRequestMs: MIN_REQUEST,
  });
  // 판정 기록 명령은 poster 둘을 쓴다(review/*와 review-ledger). 둘의 상한을 더해도 5분의 절반이 안 된다
  assert.ok(2 * BUDGET < (5 * 60_000) / 2);
});

test('HTTP 5xx를 받으면 기다렸다가 다시 보내고, 성공하면 끝난다(같은 내용을 같은 토큰으로 보낸다)', async () => {
  for (const code of [500, 502, 503, 504]) {
    srv.script = [code];
    srv.requests = [];
    clock.sleeps = [];
    const { post, lines } = poster();
    assert.equal(await outcome(post(PAYLOAD)), 'ok');
    assert.equal(srv.requests.length, 2, String(code));
    assert.deepEqual(clock.sleeps, [W1]);
    assert.deepEqual(srv.requests[0], {
      method: 'POST',
      url: `/repos/o/r/statuses/${HEAD}`,
      auth: `Bearer ${TOKEN}`,
      body: { ...PAYLOAD, target_url: 'https://example.invalid/run/1' },
    });
    assert.deepEqual(srv.requests[1], srv.requests[0]);
    assert.deepEqual(lines, [
      `record: 커밋 상태 기록 다시 시도(plan-gate): HTTP ${code}, 2초 뒤 2/4번째`,
    ]);
  }
});

test('응답이 없어도(연결 끊김) 다시 보낸다', async () => {
  srv.script = ['drop', 'drop'];
  const { post, lines } = poster();
  assert.equal(await outcome(post(PAYLOAD)), 'ok');
  assert.equal(srv.requests.length, 3);
  assert.deepEqual(clock.sleeps, [W1, W2]);
  assert.equal(lines.length, 2);
  assert.match(
    lines[0],
    /^record: 커밋 상태 기록 다시 시도\(plan-gate\): 응답 없음\([A-Za-z]+\), 2초 뒤 2\/4번째$/,
  );
  assert.match(lines[1], /, 6초 뒤 3\/4번째$/);
});

test('계속 실패하면 4번 보낸 뒤 실패한다(fail-closed 그대로). 오류에 마지막 응답과 시도 수가 있다', async () => {
  srv.script = [500, 503, 'drop', 502];
  const { post, lines } = poster();
  await assert.rejects(post(PAYLOAD), (e: Error) => {
    assert.match(e.message, /^커밋 상태 기록 실패\(plan-gate\): HTTP 502 .*\(4회 시도\)$/);
    return true;
  });
  assert.equal(srv.requests.length, 4);
  assert.deepEqual(clock.sleeps, [W1, W2, W3]);
  assert.equal(lines.length, 3);

  // 응답 없음으로 끝나도 같다
  srv.script = ['drop', 'drop', 'drop', 'drop'];
  srv.requests = [];
  await assert.rejects(
    poster().post(PAYLOAD),
    /^Error: 커밋 상태 기록 실패\(plan-gate\): 응답 없음\([A-Za-z]+\) \(4회 시도\)$/,
  );
  assert.equal(srv.requests.length, 4);
});

test('HTTP 4xx는 다시 보내지 않고 바로 실패한다(오류 문구는 전과 같다)', async () => {
  for (const code of [400, 401, 403, 404, 409, 422, 429]) {
    srv.script = [code];
    srv.requests = [];
    clock.sleeps = [];
    const { post, lines } = poster();
    await assert.rejects(post(PAYLOAD), (e: Error) => {
      assert.equal(
        e.message,
        `커밋 상태 기록 실패(plan-gate): HTTP ${code} ${JSON.stringify({ message: BODY_MARK })}`,
      );
      return true;
    });
    assert.equal(srv.requests.length, 1, String(code));
    assert.deepEqual(clock.sleeps, []);
    assert.deepEqual(lines, []);
  }
});

test('다시 시도를 알리는 줄에 토큰과 응답 본문이 없다', async () => {
  srv.script = [500, 'drop', 503];
  const { post, lines } = poster();
  assert.equal(await outcome(post(PAYLOAD)), 'ok');
  assert.equal(lines.length, 3);
  for (const l of lines) {
    assert.doesNotMatch(l, new RegExp(TOKEN));
    assert.doesNotMatch(l, new RegExp(BODY_MARK));
    assert.match(l, /^record: 커밋 상태 기록 다시 시도\(plan-gate\): /);
  }
});

test('성공하면 한 번만 보내고 기다리지 않는다. 상태 여럿은 준 순서대로 하나씩 기록된다', async () => {
  const { post, lines } = poster();
  srv.script = [201, 500, 201, 201];
  for (const context of ['a', 'b', 'c'])
    assert.equal(await outcome(post({ ...PAYLOAD, context })), 'ok');
  assert.deepEqual(
    srv.requests.map((r) => (r.body as StatusPayload).context),
    ['a', 'b', 'b', 'c'],
  );
  assert.deepEqual(clock.sleeps, [W1]);
  assert.equal(lines.length, 1);
});

test('다시 시도가 더하는 시간에 상한이 있다: 느린 요청이 이어지면 횟수가 남아도 그만 보낸다', async () => {
  // 요청마다 20초가 걸린 것으로 친다. 첫 요청의 20초는 다시 시도가 더한 시간이 아니다.
  // 첫 다시 시도: 0 + 2 + 5 ≤ 60 → 보낸다(22초를 쓴다). 둘째: 22 + 6 + 5 ≤ 60 → 보낸다(48초를 쓴다).
  // 셋째: 48 + 15 + 5 > 60 → 보내지 않고 실패한다
  srv.takesMs = 20_000;
  srv.script = [500, 500, 500, 500];
  const { post, lines } = poster();
  await assert.rejects(
    post(PAYLOAD),
    /^Error: 커밋 상태 기록 실패\(plan-gate\): HTTP 500 .*\(3회 시도\) \(시간 상한\)$/,
  );
  assert.equal(srv.requests.length, 3);
  assert.deepEqual(clock.sleeps, [W1, W2]);
  assert.equal(lines.length, 2);
  // 다시 시도에 쓴 시간(대기 + 둘째부터의 요청)은 48초로 상한 이하다
  assert.equal(clock.t - 20_000, W1 + 20_000 + W2 + 20_000);
  assert.ok(clock.t - 20_000 <= BUDGET);
});

test('상한은 poster 하나가 쓰는 상태 전체에 걸린다: 앞의 상태가 시간을 썼으면 뒤의 상태는 다시 보내지 않는다. 동시에 쓰는 상태도 상한을 함께 쓴다', async () => {
  const { post } = poster();
  // 빠른 5xx 셋: 2 + 6 + 15 = 23초를 쓴다
  srv.script = [500, 500, 500];
  assert.equal(await outcome(post({ ...PAYLOAD, context: 'a' })), 'ok');
  assert.deepEqual(clock.sleeps, [W1, W2, W3]);
  // 23 + 2 + 5 ≤ 60 → 한 번 더 다시 보낼 수 있다. 그 요청이 30초 걸리면 55초를 쓴 것이 된다
  srv.script = [500];
  srv.takesMs = TIMEOUT;
  assert.equal(await outcome(post({ ...PAYLOAD, context: 'b' })), 'ok');
  assert.deepEqual(clock.sleeps, [W1, W2, W3, W1]);
  // 55 + 2 + 5 > 60 → 다음 실패는 다시 보내지 않는다(요청 하나로 끝난다)
  srv.script = [500];
  srv.requests = [];
  await assert.rejects(
    post({ ...PAYLOAD, context: 'c' }),
    /^Error: 커밋 상태 기록 실패\(c\): HTTP 500 .*[^)] \(시간 상한\)$/,
  );
  assert.equal(srv.requests.length, 1);
  assert.deepEqual(clock.sleeps, [W1, W2, W3, W1]);

  // 새 poster는 새 상한을 쓴다
  srv.takesMs = 0;
  srv.script = [500];
  assert.equal(await outcome(poster().post(PAYLOAD)), 'ok');

  // 같은 poster로 두 상태를 동시에 써도 상한을 함께 쓴다: 다시 시도는 poster 안에서 한 번에 하나씩 한다.
  // 새 poster에서 빠른 5xx 셋으로 23초를 쓴 뒤 x와 y를 동시에 쓴다. 둘 다 첫 요청이 빠르게 500을 받는다.
  // 먼저 다시 보내는 쪽: 23 + 2 + 5 ≤ 60 → 보내고, 그 요청이 30초 걸려 55초를 쓴 것이 된다.
  // 뒤의 쪽: 55 + 2 + 5 > 60 → 보내지 않는다. 둘이 따로 상한을 보면 둘 다 23초를 보고 다시 보낸다(합해 87초)
  const two = poster();
  srv.script = [500, 500, 500];
  assert.equal(await outcome(two.post({ ...PAYLOAD, context: 'a' })), 'ok');
  srv.script = [500, 500, [201, TIMEOUT], [201, TIMEOUT]];
  srv.requests = [];
  clock.sleeps = [];
  const got = await Promise.all(
    ['x', 'y'].map((context) => outcome(two.post({ ...PAYLOAD, context }))),
  );
  assert.equal(got.filter((x) => x === 'ok').length, 1, JSON.stringify(got));
  assert.match(
    got.find((x) => x !== 'ok') ?? '',
    /^rejected: 커밋 상태 기록 실패\([xy]\): HTTP 500 .*[^)] \(시간 상한\)$/,
  );
  assert.equal(srv.requests.length, 3);
  assert.deepEqual(clock.sleeps, [W1]);
  assert.equal(two.lines.length, 4);
});

test('대기가 예정보다 길어져 상한까지 남은 시간이 모자라면 대기 뒤에도 보내지 않는다', async () => {
  const { post, lines } = poster();
  // 빠른 5xx 셋으로 23초를 쓴다
  srv.script = [500, 500, 500];
  assert.equal(await outcome(post({ ...PAYLOAD, context: 'a' })), 'ok');
  // 대기 전: 23 + 2 + 5 ≤ 60 → 다시 보내기로 한다. 그런데 2초 대기가 34초 걸렸다 → 남은 시간 3초 < 5초 → 보내지 않는다
  clock.overshootMs = 32_000;
  srv.script = [500, 201];
  srv.requests = [];
  await assert.rejects(
    post({ ...PAYLOAD, context: 'b' }),
    /^Error: 커밋 상태 기록 실패\(b\): HTTP 500 .*[^)] \(시간 상한\)$/,
  );
  assert.equal(srv.requests.length, 1);
  assert.equal(lines.length, 4);

  // 남은 시간이 5초 이상이면 보낸다: 새 poster에서 2초 대기가 50초 걸려도(남은 시간 10초) 다시 보내 성공한다
  clock.overshootMs = 48_000;
  srv.script = [500];
  srv.requests = [];
  assert.equal(await outcome(poster().post(PAYLOAD)), 'ok');
  assert.equal(srv.requests.length, 2);
});

test('요청이 시간 제한을 넘기면 끊고 다시 보낸다. 다시 보내는 요청은 새 시간 제한을 쓴다(실제 시간)', async () => {
  // 첫 요청에는 답하지 않는다 → 0.3초 뒤 끊긴다. 둘째 요청은 0.15초 뒤에 201이다:
  // 앞 요청의 만료된 신호를 물려받았다면 둘째 요청은 보내자마자 끊긴다
  srv.script = ['hang', 'slow'];
  const { post, lines } = realPoster({ timeoutMs: 300, waitsMs: [10, 10, 10], minRequestMs: 100 });
  const from = performance.now();
  assert.equal(await outcome(post(PAYLOAD)), 'ok');
  const took = performance.now() - from;
  assert.equal(srv.requests.length, 2);
  assert.deepEqual(srv.requests[1], srv.requests[0]);
  assert.deepEqual(lines, [
    'record: 커밋 상태 기록 다시 시도(plan-gate): 응답 없음(TimeoutError), 0.01초 뒤 2/4번째',
  ]);
  // 첫 요청은 시간 제한(0.3초)까지 기다렸다
  assert.ok(took >= 300 && took < 3_000, String(took));

  // 답이 계속 없으면 요청마다 시간 제한에 끊기고 4번 뒤 실패한다
  srv.script = ['hang', 'hang', 'hang', 'hang'];
  srv.requests = [];
  assert.equal(
    await outcome(
      realPoster({ timeoutMs: 100, waitsMs: [10, 10, 10], minRequestMs: 50 }).post(PAYLOAD),
    ),
    'rejected: 커밋 상태 기록 실패(plan-gate): 응답 없음(TimeoutError) (4회 시도)',
  );
  assert.equal(srv.requests.length, 4);
});

test('다시 보내는 요청의 시간 제한은 상한까지 남은 시간을 넘지 않는다(실제 시간)', async () => {
  // 요청의 시간 제한은 20초인데 상한이 0.5초다. 다시 보낸 요청에 답이 없으면 0.5초쯤에 끊긴다(20초를 기다리지 않는다)
  srv.script = [500, 'hang'];
  const { post } = realPoster({
    timeoutMs: 20_000,
    budgetMs: 500,
    waitsMs: [10, 10, 10],
    minRequestMs: 100,
  });
  const from = performance.now();
  assert.equal(
    await outcome(post(PAYLOAD)),
    'rejected: 커밋 상태 기록 실패(plan-gate): 응답 없음(TimeoutError) (2회 시도) (시간 상한)',
  );
  const took = performance.now() - from;
  assert.equal(srv.requests.length, 2);
  assert.ok(took >= 300 && took < 3_000, String(took));
});

test('record-status 명령: 커밋 상태 쓰기가 HTTP 500을 한 번 받아도 모든 상태를 기록하고 성공으로 끝난다', async () => {
  const f = path.join(tmp(), 'gates.json');
  writeFileSync(
    f,
    JSON.stringify({
      version: 1,
      headSha: HEAD,
      results: RECORDED_CONTEXTS.map((context) => ({
        context,
        state: 'success',
        description: '통과',
        details: [],
      })),
    }),
  );
  // 둘째 상태의 첫 요청만 실패한다
  srv.script = [201, 500];
  const args = [
    path.join(HARNESS_ROOT, 'scripts/harness.ts'),
    'record-status',
    ...['--results', f, '--head-sha', HEAD, '--repo-slug', 'o/r'],
    ...['--target-url', 'https://example.invalid/run/1'],
  ];
  const r = await new Promise<{ code: number; out: string }>((resolve) => {
    const p = spawn(process.execPath, args, {
      cwd: HARNESS_ROOT,
      env: { ...process.env, GITHUB_API_URL: api, GH_TOKEN: TOKEN, SELFTEST_B64: '' },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
  assert.equal(r.code, 0, r.out);
  const contexts = srv.requests.map((x) => (x.body as StatusPayload).context);
  assert.deepEqual(contexts, [
    RECORDED_CONTEXTS[0],
    RECORDED_CONTEXTS[1],
    ...RECORDED_CONTEXTS.slice(1),
  ]);
  assert.deepEqual(
    [...new Set(srv.requests.map((x) => (x.body as StatusPayload).state))],
    ['success'],
  );
  assert.match(r.out, /record-status: 기록함/);
  assert.match(
    r.out,
    new RegExp(
      `record: 커밋 상태 기록 다시 시도\\(${RECORDED_CONTEXTS[1]}\\): HTTP 500, 2초 뒤 2/4번째`,
    ),
  );
  assert.doesNotMatch(r.out, new RegExp(TOKEN));
  assert.doesNotMatch(r.out, new RegExp(BODY_MARK));
});

test('다시 시도를 알리는 줄이 판정 로그에 끼어도 runner가 지적을 그대로 읽는다', async () => {
  srv.script = [500];
  const { post, lines } = poster();
  assert.equal(await outcome(post({ ...PAYLOAD, context: 'review/claude' })), 'ok');
  assert.equal(lines.length, 1);
  const verdict = record.reviewLogLines({
    verdict: 'request_changes',
    risk: 'high',
    summary: '요약',
    findings: [
      {
        severity: 'P1',
        file: 'src/a.ts',
        line: 3,
        title: '제목',
        evidence: '근거',
        suggestion: '제안',
        repro: { path: '', content: '' },
      },
    ],
    resolutions: [],
  });
  const want = parseReviewLog(verdict.join('\n'));
  assert.equal(want.length, 1);
  // 상태 쓰기는 지적을 찍은 뒤다: 다시 시도 줄은 지적 묶음 뒤에 온다
  const log = [...verdict, ...lines, 'record-review: review/claude = failure — 수정 요청'];
  assert.deepEqual(parseReviewLog(log.join('\n')), want);
});

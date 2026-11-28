// 유출 검사 명령(codex-scan, claude-scan)의 job 출력 계약(10.2절 (3), Issue #143).
// 판정을 내보낼 때 GITHUB_OUTPUT에 repro=true|false를 덧붙인다. 재현 job은 이 값이 false가 아니면 돈다.
// 명령을 실제로 실행해 본다(합성 이벤트와 가짜 값).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { hasRepro, reproOutputValue } from '../ci/repro.ts';
import type { Verdict } from '../ci/verdict.ts';
import { runSync } from '../lib/exec.ts';
import { HARNESS_ROOT, tmp } from './helpers.ts';

const HARNESS = path.join(HARNESS_ROOT, 'scripts/harness.ts');

const finding = (repro?: { path: string; content: string }) => ({
  severity: 'P1',
  file: 'src/a.js',
  line: 1,
  title: '경계값에서 틀린다',
  evidence: 'src/a.js:1',
  suggestion: '고쳐라',
  ...(repro ? { repro } : {}),
});
const REPRO = {
  path: 'scripts/test/harness-repro-edge.test.ts',
  content: "import assert from 'node:assert/strict';\nassert.equal(1, 2);\n",
};
const approve = { verdict: 'approve', risk: 'low', summary: '문제 없음', findings: [] };
const noRepro = {
  verdict: 'request_changes',
  risk: 'low',
  summary: '지적 1건',
  findings: [finding()],
};
const withRepro = {
  verdict: 'request_changes',
  risk: 'low',
  summary: '지적 2건',
  findings: [finding(), finding(REPRO)],
};

interface Run {
  code: number;
  /** GITHUB_OUTPUT 파일의 줄(파일을 주지 않았으면 null) */
  output: string[] | null;
  verdictFile: boolean;
}

/** 명령을 실행한다. githubOutput이 true면 미리 한 줄이 든 GITHUB_OUTPUT 파일을 준다 */
function exec(args: (dir: string) => string[], githubOutput: boolean): Run {
  const dir = tmp('scan-output-');
  const out = path.join(dir, 'verdict.json');
  const ghOut = path.join(dir, 'github-output');
  if (githubOutput) writeFileSync(ghOut, 'earlier=1\n');
  // 러너의 변수는 넘기지 않는다: 이 테스트가 CI에서 돌 때 실제 GITHUB_OUTPUT에 쓰면 안 된다
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  if (githubOutput) env.GITHUB_OUTPUT = ghOut;
  const r = runSync(process.execPath, [HARNESS, ...args(dir), '--out', out], { cwd: dir, env });
  return {
    code: r.code,
    output: githubOutput ? readFileSync(ghOut, 'utf8').split('\n').filter(Boolean) : null,
    verdictFile: existsSync(out),
  };
}

function claude(verdict: unknown, o: { githubOutput?: boolean; broken?: boolean } = {}): Run {
  return exec((dir) => {
    const pr = path.join(dir, 'pr');
    mkdirSync(path.join(pr, 'src'), { recursive: true });
    writeFileSync(path.join(pr, 'src/a.js'), 'x\n');
    const events = [
      {
        type: 'system',
        subtype: 'init',
        model: 'test-model',
        tools: ['Glob', 'Grep', 'Read', 'StructuredOutput'],
        mcp_servers: [],
      },
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        structured_output: verdict,
        permission_denials: [],
      },
    ];
    const log = path.join(dir, 'claude.log');
    // 깨진 실행: 결과 이벤트가 없다(판정을 내보내지 못한다)
    writeFileSync(
      log,
      (o.broken ? events.slice(0, 1) : events).map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
    return ['claude-scan', '--log', log, '--pr', pr];
  }, o.githubOutput ?? true);
}

function codex(verdict: unknown, o: { githubOutput?: boolean; broken?: boolean } = {}): Run {
  return exec((dir) => {
    const pr = path.join(dir, 'pr');
    mkdirSync(pr, { recursive: true });
    const events = [
      { type: 'thread.started', thread_id: 't' },
      // 깨진 실행: 턴이 실패했다(판정을 내보내지 못한다)
      o.broken
        ? { type: 'turn.failed', error: { message: 'usage limit' } }
        : { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } },
    ];
    const ev = path.join(dir, 'events.jsonl');
    const last = path.join(dir, 'last.txt');
    writeFileSync(ev, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    writeFileSync(last, JSON.stringify(verdict));
    return ['codex-scan', '--events', ev, '--last', last, '--pr', pr];
  }, o.githubOutput ?? true);
}

const reproLines = (r: Run) => (r.output ?? []).filter((l) => l.startsWith('repro'));

for (const [name, scan] of [
  ['claude-scan', claude],
  ['codex-scan', codex],
] as const) {
  test(`${name}: 재현 테스트가 붙은 지적이 있으면 repro=true를 한 줄 덧붙인다`, () => {
    const r = scan(withRepro);
    assert.equal(r.code, 0);
    assert.equal(r.verdictFile, true);
    assert.deepEqual(reproLines(r), ['repro=true']);
    // 이미 있던 출력은 그대로다
    assert.equal(r.output?.[0], 'earlier=1');
  });

  test(`${name}: 재현 테스트가 없는 판정(지적만, 승인)이면 repro=false를 한 줄 덧붙인다`, () => {
    for (const v of [noRepro, approve]) {
      const r = scan(v);
      assert.equal(r.code, 0);
      assert.deepEqual(reproLines(r), ['repro=false']);
      assert.equal(r.output?.[0], 'earlier=1');
    }
  });

  test(`${name}: 판정을 내보내지 못하면 repro를 쓰지 않는다`, () => {
    const r = scan(withRepro, { broken: true });
    assert.notEqual(r.code, 0);
    assert.equal(r.verdictFile, false);
    assert.deepEqual(r.output, ['earlier=1']);
  });

  test(`${name}: GITHUB_OUTPUT이 없으면 판정 파일만 쓴다`, () => {
    const r = scan(withRepro, { githubOutput: false });
    assert.equal(r.code, 0);
    assert.equal(r.verdictFile, true);
  });
}

// 사용 한도(Issue #223): codex-scan은 한도 값을 --unavailable-out 파일에만 쓰고, codex-unavailable이 그 파일을 검사해
// GITHUB_OUTPUT에 unavailable=을 쓴다. 실패로 끝나는 codex-scan은 지금처럼 job 출력을 쓰지 않는다(#143)
const LIMIT_AT =
  "You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again at Nov 21st, 2026 8:36 AM.";
const FAKE_TOKEN = ['tok', 'FAKEFAKE', 'fakefake', '0123456789'].join('-');

interface LimitRun extends Run {
  /** --unavailable-out 파일의 내용(없으면 null) */
  unavailable: string | null;
}

/** codex-scan을 합성 이벤트로 실행한다. last는 마지막 메시지 파일 내용 */
function codexEvents(events: unknown[], last: string): LimitRun {
  let file = '';
  const r = exec((dir) => {
    const pr = path.join(dir, 'pr');
    mkdirSync(pr, { recursive: true });
    const ev = path.join(dir, 'events.jsonl');
    const lastFile = path.join(dir, 'last.txt');
    const auth = path.join(dir, 'auth.json');
    file = path.join(dir, 'codex-unavailable.txt');
    writeFileSync(ev, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    writeFileSync(lastFile, last);
    writeFileSync(auth, JSON.stringify({ tokens: { access_token: FAKE_TOKEN } }));
    return [
      'codex-scan',
      ...['--events', ev, '--last', lastFile, '--pr', pr, '--auth', auth],
      ...['--unavailable-out', file],
    ];
  }, true);
  return { ...r, unavailable: existsSync(file) ? readFileSync(file, 'utf8') : null };
}
const started = { type: 'thread.started', thread_id: 't' };
const completed = { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } };
const turnFailed = (message: string) => ({ type: 'turn.failed', error: { message } });

test('codex-scan --unavailable-out: 사용 한도면 값 한 줄을 파일에 쓰고 판정 없이 종료 코드 1이다 (Issue #223)', () => {
  const cases: [string, string][] = [
    [LIMIT_AT, 'usage-limit@2026-11-21T08:36Z'],
    ['You have hit your usage limit. Try again later', 'usage-limit'],
    ['usage limit. try again at Feb 30th, 2027 8:36 AM', 'usage-limit'],
    ['usage limit. try again at Nov 21st, 2026 8:36 AM PST', 'usage-limit'],
    // 비밀 값과 제어 문자가 섞여도 파일에는 정한 형식만 간다
    [`${LIMIT_AT}\u0007\n${FAKE_TOKEN}\r\nunavailable=x`, 'usage-limit@2026-11-21T08:36Z'],
  ];
  for (const [message, value] of cases) {
    const r = codexEvents([started, turnFailed(message)], JSON.stringify(approve));
    assert.equal(r.code, 1, message);
    assert.equal(r.verdictFile, false, message);
    assert.deepEqual(r.output, ['earlier=1'], '실패로 끝나면 GITHUB_OUTPUT에 쓰지 않는다');
    assert.equal(r.unavailable, `${value}\n`, message);
  }
});

test('codex-scan --unavailable-out: 한도가 아닌 실패와 통과한 판정에는 파일을 만들지 않는다', () => {
  const runs = [
    codexEvents([started, turnFailed('stream disconnected')], JSON.stringify(approve)),
    // 비밀 값
    codexEvents(
      [started, { type: 'item.completed', item: { type: 'agent_message', text: FAKE_TOKEN } }],
      JSON.stringify(approve),
    ),
    // 허용 밖 항목
    codexEvents(
      [started, { type: 'item.completed', item: { type: 'web_search' } }, completed],
      JSON.stringify(approve),
    ),
    // 판정 형식 오류
    codexEvents([started, completed], JSON.stringify({ ...approve, risk: 'none' })),
  ];
  for (const r of runs) {
    assert.equal(r.code, 1);
    assert.equal(r.unavailable, null);
    assert.deepEqual(r.output, ['earlier=1']);
  }
  const ok = codexEvents([started, completed], JSON.stringify(approve));
  assert.equal(ok.code, 0);
  assert.equal(ok.unavailable, null);
  assert.deepEqual(ok.output, ['earlier=1', 'repro=false'], '통과 경로는 지금 그대로다');
});

/** codex-unavailable을 실행한다. content가 null이면 파일을 만들지 않는다 */
function unavailable(content: string | null, o: { githubOutput?: boolean } = {}) {
  const dir = tmp('codex-unavailable-');
  const file = path.join(dir, 'codex-unavailable.txt');
  const ghOut = path.join(dir, 'github-output');
  if (content !== null) writeFileSync(file, content);
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  if (o.githubOutput ?? true) {
    writeFileSync(ghOut, 'earlier=1\n');
    env.GITHUB_OUTPUT = ghOut;
  }
  const r = runSync(process.execPath, [HARNESS, 'codex-unavailable', '--file', file], {
    cwd: dir,
    env,
  });
  return {
    code: r.code,
    stdout: r.stdout,
    output: existsSync(ghOut) ? readFileSync(ghOut, 'utf8').split('\n').filter(Boolean) : null,
  };
}

test('codex-unavailable: 정한 형식의 값이면 GITHUB_OUTPUT에 unavailable= 한 줄을 덧붙인다', () => {
  for (const [content, value] of [
    ['usage-limit@2026-11-21T08:36Z\n', 'usage-limit@2026-11-21T08:36Z'],
    ['usage-limit', 'usage-limit'],
    // 앞뒤 공백·줄바꿈만 다른 것은 받는다
    ['  usage-limit@2026-11-21T08:36Z \r\n', 'usage-limit@2026-11-21T08:36Z'],
    ['\nusage-limit\n\n', 'usage-limit'],
  ]) {
    const r = unavailable(content);
    assert.equal(r.code, 0);
    assert.deepEqual(r.output, ['earlier=1', `unavailable=${value}`], JSON.stringify(content));
    assert.match(r.stdout, new RegExp(`codex-unavailable: ${value}`));
  }
});

test('codex-unavailable: 파일이 없거나 형식이 아니면 쓰지 않고, 종료 코드는 언제나 0이다', () => {
  for (const content of [
    null,
    '',
    'usage-limit\nunavailable=x',
    'usage-limit@2026-11-21T08:36Z\nusage-limit',
    'usage-limit@2027-02-29T08:36Z',
    'usage-limit@2026-11-21T08:36',
    'rate limit',
    'You have hit your usage limit.',
  ]) {
    const r = unavailable(content);
    assert.equal(r.code, 0, JSON.stringify(content));
    assert.deepEqual(r.output, ['earlier=1'], JSON.stringify(content));
  }
  // GITHUB_OUTPUT이 없으면(로컬) 쓰지 않는다
  const local = unavailable('usage-limit', { githubOutput: false });
  assert.equal(local.code, 0);
  assert.equal(local.output, null);
});

test('hasRepro: 내용이 빈 재현 테스트는 세지 않는다', () => {
  const v = (findings: { repro: { path: string; content: string } }[]) =>
    ({ findings }) as unknown as Verdict;
  assert.equal(hasRepro(v([])), false);
  assert.equal(hasRepro(v([{ repro: { path: '', content: '' } }])), false);
  assert.equal(hasRepro(v([{ repro: { path: 'x', content: '' } }])), false);
  assert.equal(hasRepro(v([{ repro: { path: '', content: '' } }, { repro: REPRO }])), true);
});

test('reproOutputValue: 읽지 못한 판정은 돌리는 쪽(true)이다', () => {
  assert.equal(reproOutputValue(withRepro), true);
  assert.equal(reproOutputValue(noRepro), false);
  assert.equal(reproOutputValue(approve), false);
  // 형식이 다른 값: 재현 job을 건너뛰게 하지 않는다
  for (const bad of [
    null,
    undefined,
    '',
    'x',
    {},
    { verdict: 'approve' },
    { ...noRepro, extra: 1 },
  ])
    assert.equal(reproOutputValue(bad), true, JSON.stringify(bad));
});

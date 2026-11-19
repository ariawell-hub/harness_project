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

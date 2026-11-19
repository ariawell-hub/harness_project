// check-results.ts 테스트: 기대와 어긋난 결과 파일을 통과시키지 않는다.
//   node --test lab/pilot-prep/test/*.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkTestEffect, TEST_EFFECT_CASES, VITEST_VERSION } from '../check-results.ts';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-results.ts');
const COMMAND = ['node', 'profiles/web/test-effect/run-one.mjs'];

const detail = (c: (typeof TEST_EFFECT_CASES)[number]) =>
  c.outcome === 'ineffective'
    ? 'base에서도 통과'
    : c.phrase === '단언 실패'
      ? 'base에서 단언 실패, 종료 코드 1'
      : 'base에서 실패(단언 실패 아님: 모듈 없음 등), 종료 코드 1';

/** 모든 기대를 채운 결과 */
function good(): {
  tool: Record<string, string>;
  command: string[];
  runs: { id: string; exitCode: number }[];
  cases: { id: string; file: string; outcome: string; line: string }[];
} {
  return {
    tool: { vitest: VITEST_VERSION, node: 'v22.0.0', os: 'test' },
    command: [...COMMAND],
    runs: [
      { id: 'all', exitCode: 1 },
      { id: 'effective-only', exitCode: 0 },
      { id: 'first-adoption', exitCode: 1 },
    ],
    cases: TEST_EFFECT_CASES.map((c) => ({
      id: c.id,
      file: c.file,
      outcome: c.outcome,
      line: `${c.file}: ${c.outcome}(${detail(c)})`,
    })),
  };
}

test('기대를 모두 채운 결과는 통과한다', () => {
  assert.deepEqual(checkTestEffect(good(), COMMAND), []);
});

test('사례가 빠지거나 더 있으면 실패한다', () => {
  const missing = good();
  missing.cases.pop();
  assert.match(checkTestEffect(missing, COMMAND).join('\n'), /adoption-fail가 0개/);
  const extra = good();
  extra.cases.push({ id: 'extra', file: 'src/x.test.ts', outcome: 'effective', line: '' });
  assert.match(checkTestEffect(extra, COMMAND).join('\n'), /모르는 사례가 있다: extra/);
  const twice = good();
  twice.cases.push({ ...twice.cases[0] });
  assert.match(checkTestEffect(twice, COMMAND).join('\n'), /passes-on-base가 2개/);
});

test('판정이 섞인 결과는 실패한다(이름이 겹치는 파일의 결과가 바뀐 경우)', () => {
  const r = good();
  const pass = r.cases.find((c) => c.id === 'similar-pass')!;
  pass.outcome = 'effective';
  pass.line = `${pass.file}: effective(base에서 단언 실패, 종료 코드 1)`;
  assert.match(
    checkTestEffect(r, COMMAND).join('\n'),
    /similar-pass: outcome: effective\(기대 ineffective\)/,
  );
});

test('단언 실패를 기대하는 사례의 판정 줄이 "단언 실패 아님"이면 실패한다', () => {
  const r = good();
  const c = r.cases.find((x) => x.id === 'assertion')!;
  c.line = `${c.file}: effective(base에서 실패(단언 실패 아님: 모듈 없음 등), 종료 코드 1)`;
  assert.match(checkTestEffect(r, COMMAND).join('\n'), /assertion: 판정 줄이 "단언 실패 아님"이다/);
});

test('판정 줄이 다른 파일의 것이면 실패한다', () => {
  const r = good();
  const c = r.cases.find((x) => x.id === 'similar-fail')!;
  c.line = 'src/sim/a.test.ts: effective(base에서 단언 실패, 종료 코드 1)';
  assert.match(checkTestEffect(r, COMMAND).join('\n'), /similar-fail: 판정 줄이/);
});

test('실행의 종료 코드, 도구 버전, 명령이 어긋나면 실패한다', () => {
  const run = good();
  run.runs[0].exitCode = 0;
  assert.match(checkTestEffect(run, COMMAND).join('\n'), /runs\.all의 종료 코드: 0\(기대 1\)/);
  const noRun = good();
  noRun.runs.pop();
  assert.match(checkTestEffect(noRun, COMMAND).join('\n'), /runs에 first-adoption가 0개/);
  const tool = good();
  tool.tool.vitest = '5.1.1';
  assert.match(checkTestEffect(tool, COMMAND).join('\n'), /tool\.vitest: 5\.1\.1\(기대 /);
  const cmd = good();
  cmd.command = ['pnpm', 'exec', 'vitest', 'run'];
  assert.match(checkTestEffect(cmd, COMMAND).join('\n'), /command가 프로파일/);
  assert.match(checkTestEffect(good(), undefined).join('\n'), /command가 프로파일/);
});

test('객체가 아닌 결과는 실패한다', () => {
  assert.deepEqual(checkTestEffect(null, COMMAND), ['결과가 객체가 아니다']);
  assert.notDeepEqual(checkTestEffect({}, COMMAND), []);
});

test('명령행: 모르는 이름이나 인자 없음은 종료 코드 2다', () => {
  for (const args of [[], ['nope'], ['test-effect-vitest', 'x']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /사용법/);
  }
});

test('래퍼가 없는 기준 커밋과 비교한 실행에서 통과하는 테스트가 effective로 나오면 실패한다', () => {
  const r = good();
  const c = r.cases.find((x) => x.id === 'adoption-pass')!;
  c.outcome = 'effective';
  c.line = `${c.file}: effective(base에서 실패(단언 실패 아님: 모듈 없음 등), 종료 코드 1)`;
  assert.match(
    checkTestEffect(r, COMMAND).join('\n'),
    /adoption-pass: outcome: effective\(기대 ineffective\)/,
  );
});

test('문자열로 바꿀 수 없는 값이 있어도 멈추지 않고 그 칸과 나머지 어긋난 점을 모두 낸다', () => {
  // JSON.parse가 만들 수 있는 값이다: {"toString":null}은 String()과 템플릿 문자열에서 TypeError를 낸다
  const weird = () => JSON.parse('{"toString":null}') as never;
  const r = good() as unknown as {
    tool: { vitest: unknown };
    runs: { id: string; exitCode: unknown }[];
    cases: { id: unknown; file: unknown; outcome: unknown; line: unknown }[];
  };
  r.tool.vitest = weird();
  r.runs[0].exitCode = weird();
  r.cases[0].file = weird();
  r.cases[1].outcome = weird();
  r.cases[2].id = weird();
  const bad = checkTestEffect(r, COMMAND).join('\n');
  assert.match(bad, /tool\.vitest: \{"toString":null\}\(기대 /);
  assert.match(bad, /runs\.all의 종료 코드: \{"toString":null\}\(기대 1\)/);
  assert.match(bad, /passes-on-base: file: \{"toString":null\}\(기대 /);
  assert.match(bad, /assertion: outcome: \{"toString":null\}\(기대 effective\)/);
  assert.match(bad, /모르는 사례가 있다: \{"toString":null\}/);
  assert.match(bad, /사례 new-module가 0개다/);
});

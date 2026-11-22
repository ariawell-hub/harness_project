import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import * as prettier from 'prettier';
import { judge, keyFailures, stepTotals, type Attempt } from '../lib/attempts.ts';
import {
  ConfigError,
  DEFAULT_MCP_GUARD,
  loadConfig,
  resolveDbCommands,
  resolveMcpGuard,
} from '../lib/config.ts';
import { run } from '../lib/exec.ts';
import { matchDbCommand } from '../hooks/db-commands.ts';
import {
  extractCommands,
  openQuestions,
  parseBranch,
  parseDoc,
  section,
  setFrontmatter,
  smallPlanFields,
  unhandledFindings,
} from '../lib/plan.ts';
import { globToRegExp, matchesAny } from '../lib/util.ts';
import { HARNESS_ROOT, fixtureConfig, tmp } from './helpers.ts';

test('frontmatter 파싱과 수정(주석 보존)', () => {
  const text =
    '---\nid: 20261110-x\nissue: 42                # 번호\nrelated_code: [src/a/, src/b/]\nstatus: draft            # 상태\n---\n# 제목\n';
  const d = parseDoc(text);
  assert.equal(d.frontmatter!.issue, 42);
  assert.deepEqual(d.frontmatter!.related_code, ['src/a/', 'src/b/']);
  const t2 = setFrontmatter(text, 'status', 'active');
  assert.equal(parseDoc(t2).frontmatter!.status, 'active');
  assert.match(t2, /status: active\s+# 상태/);
  assert.match(setFrontmatter(text, 'owner', 'runner-1'), /owner: runner-1\n---/);
});

test('setFrontmatter: 값과 주석 사이는 공백 하나다(포매터의 결과와 같다)', async () => {
  const fm = (status: string, gap = ' ') =>
    `---\nid: x\nissue: 3 # 번호\nstatus: ${status}${gap}# draft | active | blocked | completed | abandoned\nsize: small\n---\n\n# 제목\n`;
  const line = (text: string, key: string) => text.split('\n').find((l) => l.startsWith(`${key}:`));
  const COMMENT = '# draft | active | blocked | completed | abandoned';
  // 짧아진다(완료한 step을 다시 열 때), 길어진다, 길이가 같다
  const shorter = setFrontmatter(fm('completed'), 'status', 'active');
  assert.equal(line(shorter, 'status'), `status: active ${COMMENT}`);
  assert.equal(
    line(setFrontmatter(fm('active'), 'status', 'completed'), 'status'),
    `status: completed ${COMMENT}`,
  );
  assert.equal(
    line(setFrontmatter(fm('active'), 'status', 'failed'), 'status'),
    `status: failed ${COMMENT}`,
  );
  // 손으로 칸을 맞춘 줄도 바꾼 뒤에는 공백 하나다. 다른 줄은 글자 그대로다
  const aligned = setFrontmatter(fm('completed', '      '), 'status', 'active');
  assert.equal(line(aligned, 'status'), `status: active ${COMMENT}`);
  assert.equal(line(aligned, 'issue'), 'issue: 3 # 번호');
  assert.equal(line(aligned, 'size'), 'size: small');
  // 주석이 없는 줄, 없는 키
  assert.equal(line(setFrontmatter(fm('active'), 'size', 'large'), 'size'), 'size: large');
  assert.match(setFrontmatter(fm('active'), 'owner', 'runner-1'), /\nowner: runner-1\n---\n/);
  // 바꾼 결과를 포매터가 고치지 않는다
  const config = await prettier.resolveConfig(path.join(HARNESS_ROOT, 'x.md'));
  for (const text of [shorter, aligned, setFrontmatter(fm('active'), 'status', 'completed')])
    assert.ok(await prettier.check(text, { ...config, filepath: 'x.md' }), text);
});

test('섹션 추출은 코드 블록 안의 ##을 무시한다', () => {
  const body =
    '## 작업\nA\n```md\n## 가짜\n```\n## Acceptance Criteria\n```bash\nnode --test a.test.ts\nnpm run x \\\n  --flag\n# 주석\n```\n';
  assert.match(section(body, '작업')!, /## 가짜/);
  assert.deepEqual(extractCommands(section(body, 'Acceptance Criteria')), [
    'node --test a.test.ts',
    'npm run x    --flag',
  ]);
});

test('브랜치 이름 해석 (8.1절)', () => {
  assert.deepEqual(parseBranch('feat/20261110-login-rate-limit-s0'), {
    type: 'feat',
    id: '20261110-login-rate-limit',
    step: 0,
  });
  assert.deepEqual(parseBranch('fix/20261110-typo'), {
    type: 'fix',
    id: '20261110-typo',
    step: null,
  });
  assert.equal(parseBranch('main'), null);
  assert.equal(parseBranch('claim/42'), null);
});

test('소규모 계획 필드와 발견 사항 처리 검사', () => {
  assert.deepEqual(smallPlanFields('- 목표: a\n- 변경: b\n- 검증: pnpm test x'), {
    목표: 'a',
    변경: 'b',
    검증: 'pnpm test x',
  });
  const body =
    '## 발견 사항\n- 캐시가 느림 → 처리: TD-3\n- 문서 누락 → 처리: [문서](docs/a.md)\n- 이상한 것\n- 해결 → 처리: 해당 없음\n';
  assert.deepEqual(unhandledFindings(body), ['- 이상한 것']);
  assert.deepEqual(unhandledFindings('## 발견 사항\n<!-- 설명 -->\n'), []);
});

const A = (key: string, ok: boolean, extra: Partial<Attempt> = {}): Attempt => ({
  ts: '',
  plan: 'p',
  step: 0,
  key,
  ok,
  kind: 'check',
  ...extra,
});
const L = { switchAt: 3, stopAt: 5, stepFailedCheckLimit: 10, stepSessionMinutesLimit: 120 };

test('3회/5회 규칙은 키별로 세고, 통과하면 그 키는 0이 된다 (9.2절)', () => {
  const two = [A('check:lint', false), A('check:test', false), A('check:lint', false)];
  assert.equal(judge(two, 'p', 0, L).action, 'continue');
  const three = [...two, A('check:lint', false)];
  assert.deepEqual(
    [judge(three, 'p', 0, L).action, judge(three, 'p', 0, L).key],
    ['switch', 'check:lint'],
  );
  const reset = [...three, A('check:lint', true)];
  assert.equal(keyFailures(reset, 'p').has('check:lint'), false);
  const five = [...three, A('check:lint', false), A('check:lint', false)];
  assert.equal(judge(five, 'p', 0, L).action, 'stop');
});

test('환경 장애는 세지 않는다', () => {
  const list = Array.from({ length: 6 }, () => A('session', false, { env: true, kind: 'session' }));
  assert.equal(judge(list, 'p', 0, L).action, 'continue');
});

test('총량 상한: 키가 계속 바뀌어도 실패한 check 합계로 멈춘다', () => {
  const list = Array.from({ length: 10 }, (_, i) => A(`check:k${i}`, false));
  const v = judge(list, 'p', 0, L);
  assert.equal(v.action, 'stop');
  assert.match(v.reason!, /총량/);
  const minutes = [A('session', true, { kind: 'session', durationMs: 121 * 60000 })];
  assert.equal(judge(minutes, 'p', 0, L).action, 'stop');
  assert.equal(stepTotals(minutes, 'p', 0).sessions, 1);
});

test('제작자 답변 표식 뒤에는 새로 센다', () => {
  const list = [
    ...Array.from({ length: 5 }, () => A('ac:x', false)),
    A('__reset__', true, { kind: 'plan' }),
  ];
  assert.equal(judge(list, 'p', 0, L).action, 'continue');
});

test('시간 제한을 넘기면 프로세스 그룹 전체를 끝낸다', async () => {
  const started = Date.now();
  const r = await run('sh', ['-c', 'sleep 30 & sleep 30'], { timeoutMs: 500 });
  assert.equal(r.timedOut, true);
  assert.equal(r.code, 124);
  assert.ok(Date.now() - started < 10_000, '손자 프로세스가 남아도 바로 돌아와야 한다');
});

test('글롭', () => {
  assert.ok(globToRegExp('docs/**').test('docs/a/b.md'));
  assert.ok(matchesAny('docs/x/TEMPLATE-step.md', ['docs/**/TEMPLATE*.md']));
  assert.ok(matchesAny('docs/TEMPLATE.md', ['docs/**/TEMPLATE*.md']));
  assert.ok(!matchesAny('src/a.ts', ['docs/**']));
});

test('열린 질문 추출: "### 질문:" 블록만 나누고, 주석·"없음"·목록은 질문이 아니다 (TD-18)', () => {
  const body = [
    '## 의사결정 로그',
    '### 질문: 여기는 다른 섹션',
    '## 열린 질문',
    '<!-- 선택지 + 추천안 (9.1절) -->',
    '',
    '### 질문: 봇 Issue를 받을까',
    '',
    '- A) 제외 — 영향: 없음',
    '- B) 받는다 — 영향: 크다',
    '- 추천: A. 이유: 안전',
    '',
    '### 질문:   설정 이름  ',
    '- A) x',
    '### 참고',
    '- 질문이 아니다',
    '',
    '## 검증 방법과 결과',
    '- 없음',
  ].join('\n');
  const qs = openQuestions(body);
  assert.deepEqual(
    qs.map((q) => q.title),
    ['봇 Issue를 받을까', '설정 이름'],
  );
  assert.equal(
    qs[0].text,
    '### 질문: 봇 Issue를 받을까\n\n- A) 제외 — 영향: 없음\n- B) 받는다 — 영향: 크다\n- 추천: A. 이유: 안전',
  );
  assert.equal(qs[1].text, '### 질문:   설정 이름  \n- A) x', '다음 ### 제목 앞에서 끊는다');
  assert.deepEqual(openQuestions('## 열린 질문\n<!-- ### 질문: 주석 -->\n- 없음\n'), []);
  assert.deepEqual(openQuestions('## 열린 질문\n\n- step2 전: environment 4개\n'), []);
  assert.deepEqual(openQuestions('## 목표\n- x\n'), []);
});

// ---------- guard.mcp 설정 (계획 20261116-ops-security step2) ----------

test('guard.mcp: 키가 없으면 기본값이고, 형식이 틀리면 ConfigError다', () => {
  assert.deepEqual(resolveMcpGuard(undefined), DEFAULT_MCP_GUARD);
  assert.notEqual(
    resolveMcpGuard(undefined),
    DEFAULT_MCP_GUARD,
    '기본값 객체를 그대로 돌려주지 않는다',
  );
  assert.deepEqual(resolveMcpGuard({}), DEFAULT_MCP_GUARD);
  assert.deepEqual(resolveMcpGuard({ denyWords: [], allowTools: ['mcp__x__*'] }), {
    ...DEFAULT_MCP_GUARD,
    denyWords: [],
    allowTools: ['mcp__x__*'],
  });
  for (const w of ['delete', 'trash', 'remove', 'destroy', 'purge', 'erase', 'wipe', 'cancel'])
    assert.ok(DEFAULT_MCP_GUARD.denyWords.includes(w), w);
  assert.deepEqual(DEFAULT_MCP_GUARD.allowTools, []);
  for (const h of ['github.com', '*.github.com', 'github.dev', '*.github.dev'])
    assert.ok(DEFAULT_MCP_GUARD.denyHosts.includes(h), h);
  const BAD: [unknown, RegExp][] = [
    [[], /guard\.mcp는 객체/],
    ['off', /guard\.mcp는 객체/],
    [null, /guard\.mcp는 객체/],
    [{ denyWords: 'delete' }, /guard\.mcp\.denyWords는 문자열 배열/],
    [{ denyHosts: [1] }, /guard\.mcp\.denyHosts는 문자열 배열/],
    [{ allowTools: [''] }, /guard\.mcp\.allowTools는 문자열 배열/],
    [{ denyWord: [] }, /guard\.mcp\.denyWord는 모르는 키/],
  ];
  for (const [raw, message] of BAD)
    assert.throws(
      () => resolveMcpGuard(raw),
      (e: unknown) => e instanceof ConfigError && message.test(e.message),
      JSON.stringify(raw),
    );
});

test('loadConfig: guard.mcp가 없는 옛 설정은 기본값으로 읽고, 틀리면 ConfigError다', () => {
  const dir = tmp('harness-lib-cfg-');
  const put = (guard: unknown) =>
    writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify(fixtureConfig({ guard })));
  put({ dbPatterns: [], dbClients: [] });
  assert.deepEqual(loadConfig(dir).guard.mcp, DEFAULT_MCP_GUARD);
  put({ dbPatterns: [], dbClients: [], mcp: { denyTools: [] } });
  assert.deepEqual(loadConfig(dir).guard.mcp, { ...DEFAULT_MCP_GUARD, denyTools: [] });
  put({ dbPatterns: [], dbClients: [], mcp: { browserTools: 'mcp__playwright__*' } });
  assert.throws(
    () => loadConfig(dir),
    (e: unknown) =>
      e instanceof ConfigError &&
      /harness\.config\.json 검증 실패/.test(e.message) &&
      /guard\.mcp\.browserTools는 문자열 배열/.test(e.message),
  );
});

test('이 리포의 설정과 프로파일: guard.mcp가 기본값으로 적혀 있다', () => {
  const read = (rel: string) => JSON.parse(readFileSync(path.join(HARNESS_ROOT, rel), 'utf8'));
  assert.deepEqual(read('harness.config.json').guard.mcp, DEFAULT_MCP_GUARD);
  assert.deepEqual(loadConfig(HARNESS_ROOT).guard.mcp, DEFAULT_MCP_GUARD);
  for (const profile of ['core', 'web'])
    assert.deepEqual(
      read(`profiles/${profile}/profile.json`).config.guard.mcp,
      DEFAULT_MCP_GUARD,
      profile,
    );
});

test('loadConfig: testEffect가 없으면 null이고, 틀리면 ConfigError다', () => {
  const dir = tmp('harness-lib-cfg-');
  const put = (testEffect?: unknown) =>
    writeFileSync(
      path.join(dir, 'harness.config.json'),
      JSON.stringify(fixtureConfig(testEffect === undefined ? {} : { testEffect })),
    );
  put();
  assert.equal(loadConfig(dir).testEffect, null);
  put(null);
  assert.equal(loadConfig(dir).testEffect, null);
  const good = { files: ['t/*.test.ts'], command: ['node', '--test'], timeoutSec: 60 };
  put(good);
  assert.deepEqual(loadConfig(dir).testEffect, {
    ...good,
    support: [],
    link: [],
    assertPattern: null,
  });
  put({ ...good, support: ['t/helpers.ts'], link: ['node_modules'], assertPattern: 'Assert|ERR' });
  assert.deepEqual(loadConfig(dir).testEffect, {
    ...good,
    support: ['t/helpers.ts'],
    link: ['node_modules'],
    assertPattern: 'Assert|ERR',
  });
  put({ ...good, assertPattern: null });
  assert.equal(loadConfig(dir).testEffect?.assertPattern, null);
  for (const bad of [
    'on',
    [],
    { ...good, files: [] },
    { ...good, files: 't/*.test.ts' },
    { ...good, files: ['/abs/*.test.ts'] },
    { ...good, files: ['t/../../x.test.ts'] },
    { ...good, files: ['t\\x.test.ts'] },
    { ...good, files: [''] },
    { ...good, command: [] },
    { ...good, command: ['node', ''] },
    { ...good, command: 'node --test' },
    { ...good, timeoutSec: 0 },
    { ...good, timeoutSec: 1.5 },
    { ...good, support: ['../helpers.ts'] },
    { ...good, link: ['/usr/lib'] },
    { ...good, link: ['a/../..'] },
    { ...good, link: 'node_modules' },
    { ...good, assertPattern: '' },
    { ...good, assertPattern: '(' },
    { ...good, assertPattern: 3 },
    { ...good, assertPattern: ['AssertionError'] },
  ]) {
    put(bad);
    assert.throws(
      () => loadConfig(dir),
      (e: unknown) => e instanceof ConfigError && /testEffect는/.test(e.message),
      JSON.stringify(bad),
    );
  }
});

// ---------- guard.dbCommands 설정 (계획 20261121-db-arg-boundary) ----------

test('guard.dbCommands: 키가 없으면 빈 목록이고, 바른 값은 정규화해 돌려준다', () => {
  assert.deepEqual(resolveDbCommands(undefined), []);
  assert.deepEqual(resolveDbCommands([]), []);
  assert.deepEqual(
    resolveDbCommands([
      { tool: '  Drizzle-Kit ', forbidden: [' Migrate ', 'db   PUSH', 'push'] },
      { tool: 'my_tool.v2', forbidden: ['schema sync --force'] },
    ]),
    [
      { tool: 'drizzle-kit', forbidden: ['migrate', 'db push', 'push'] },
      { tool: 'my_tool.v2', forbidden: ['schema sync --force'] },
    ],
  );
});

test('guard.dbCommands: 걸 수 없는 항목과 틀린 형식은 ConfigError다', () => {
  const ok = { tool: 'x', forbidden: ['y'] };
  const BAD: [unknown, RegExp][] = [
    // 형식
    [{}, /guard\.dbCommands는 배열/],
    ['drizzle-kit push', /guard\.dbCommands는 배열/],
    [null, /guard\.dbCommands는 배열/],
    [['drizzle-kit push'], /guard\.dbCommands\[0\]는 객체/],
    [[null], /guard\.dbCommands\[0\]는 객체/],
    [[['x', 'y']], /guard\.dbCommands\[0\]는 객체/],
    [[ok, { ...ok, allowed: ['z'] }], /guard\.dbCommands\[1\]\.allowed는 모르는 키/],
    [[{ forbidden: ['y'] }], /\[0\]\.tool은 문자열/],
    [[{ tool: 'x' }], /\[0\]\.forbidden은 문자열 배열/],
    [[{ tool: 7, forbidden: ['y'] }], /\[0\]\.tool은 문자열/],
    [[{ tool: ['x'], forbidden: ['y'] }], /\[0\]\.tool은 문자열/],
    [[{ tool: 'x', forbidden: 'y' }], /\[0\]\.forbidden은 문자열 배열/],
    [[{ tool: 'x', forbidden: [] }], /\[0\]\.forbidden이 비어 있다/],
    [[{ tool: 'x', forbidden: ['y', 3] }], /\[0\]\.forbidden\[1\]은 문자열/],
    // 걸 수 없는 도구 이름
    [[{ tool: '', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: '   ', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: 'a b', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: 'a/b', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: 'a\\b', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: 'a@1', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: 'a:b', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: '도구', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: '-tool', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: '--x', forbidden: ['y'] }], /\[0\]\.tool은 영문/],
    [[{ tool: 'drizzle-kit.exe', forbidden: ['y'] }], /\[0\]\.tool은 실행 파일 확장자/],
    [[{ tool: 'x.cmd', forbidden: ['y'] }], /\[0\]\.tool은 실행 파일 확장자/],
    [[{ tool: 'x.bat', forbidden: ['y'] }], /\[0\]\.tool은 실행 파일 확장자/],
    [[{ tool: 'x.com', forbidden: ['y'] }], /\[0\]\.tool은 실행 파일 확장자/],
    [[{ tool: 'X.EXE', forbidden: ['y'] }], /\[0\]\.tool은 실행 파일 확장자/],
    // 걸 수 없는 금지 항목
    [[{ tool: 'x', forbidden: [''] }], /\[0\]\.forbidden\[0\]이 비어 있다/],
    [[{ tool: 'x', forbidden: ['y', '  \t '] }], /\[0\]\.forbidden\[1\]이 비어 있다/],
    [[{ tool: 'x', forbidden: ['--force'] }], /\[0\]\.forbidden\[0\]의 첫 낱말이/],
    [[{ tool: 'x', forbidden: ['-f push'] }], /\[0\]\.forbidden\[0\]의 첫 낱말이/],
  ];
  for (const [raw, message] of BAD)
    assert.throws(
      () => resolveDbCommands(raw),
      (e: unknown) => e instanceof ConfigError && message.test(e.message),
      JSON.stringify(raw),
    );
});

test('guard.dbCommands 불변식: 검사를 통과한 규칙의 도구와 금지 항목으로 만든 가장 단순한 호출은 반드시 걸린다', () => {
  const GOOD: unknown[] = [
    [{ tool: 'drizzle-kit', forbidden: ['migrate', 'push', 'drop'] }],
    [{ tool: '  Drizzle-Kit  ', forbidden: ['  MIGRATE ', 'db    Push'] }],
    [{ tool: 'my_tool.v2', forbidden: ['schema sync now', 'a'] }],
    [{ tool: '7zip', forbidden: ['x --force', 'db push --accept-data-loss'] }],
    [
      { tool: 'prisma', forbidden: ['db push', 'migrate reset'] },
      { tool: 'knex', forbidden: ['migrate:latest', 'seed:run'] },
    ],
    [{ tool: 'a.b-c_d', forbidden: ['\tone\ttwo\n'] }],
  ];
  let checked = 0;
  for (const raw of GOOD) {
    const rules = resolveDbCommands(raw);
    assert.ok(rules.length > 0, JSON.stringify(raw));
    for (const rule of rules)
      for (const sub of rule.forbidden) {
        const argv = [rule.tool, ...sub.split(' ')];
        assert.deepEqual(
          matchDbCommand(argv, [rule]),
          { tool: rule.tool, sub },
          `걸려야 한다: ${JSON.stringify(argv)}`,
        );
        // 훅이 쓰는 꼴(규칙 전체)에서도 걸린다
        assert.notEqual(matchDbCommand(argv, rules), null);
        checked += 1;
      }
  }
  assert.ok(checked >= 14, String(checked));
});

test('loadConfig: guard.dbCommands가 없는 옛 설정은 빈 목록으로 읽고, 틀리면 ConfigError다', () => {
  const dir = tmp('harness-lib-cfg-');
  const put = (guard: unknown) =>
    writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify(fixtureConfig({ guard })));
  put({ dbPatterns: [], dbClients: [] });
  assert.deepEqual(loadConfig(dir).guard.dbCommands, []);
  put({
    dbPatterns: [],
    dbClients: [],
    dbCommands: [{ tool: 'Knex', forbidden: ['migrate:latest'] }],
  });
  assert.deepEqual(loadConfig(dir).guard.dbCommands, [
    { tool: 'knex', forbidden: ['migrate:latest'] },
  ]);
  put({ dbPatterns: [], dbClients: [], dbCommands: [{ tool: '-knex', forbidden: ['x'] }] });
  assert.throws(
    () => loadConfig(dir),
    (e: unknown) => e instanceof ConfigError && /guard\.dbCommands\[0\]\.tool/.test(e.message),
  );
  // 이 리포의 설정과 코어 프로파일에는 키가 있다(빈 목록)
  assert.deepEqual(loadConfig(HARNESS_ROOT).guard.dbCommands, []);
});

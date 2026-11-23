// scope(R18, 14.6절): PR이 바꾼 파일을 계획의 "관련 파일·문서"와 견준다(Issue #186 step1, TD-6).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cellCode, gatesOutput, isWarning, runGates, summaryMarkdown } from '../ci/gates.ts';
import {
  GATE_CONTEXTS,
  RECORDED_CONTEXTS,
  RESULTS_MAX_BYTES,
  resultsBytes,
  WARN_CONTEXTS,
  WARN_DETAILS_DROPPED,
  type GateResult,
  type GateResults,
} from '../ci/results.ts';
import { planHash } from '../ci/plan-hash.ts';
import {
  inScope,
  judgeScope,
  planScopePaths,
  readPlanAtHead,
  scopeCheck,
  scopePaths,
} from '../gates/scope.ts';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { DETAIL_LINE_MAX, DETAILS_CUT, WARN_PREFIX } from '../lib/util.ts';
import { HARNESS_ROOT, commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

const ID = '20261122-demo';
const BRANCH = `feat/${ID}-s0`;
const ACTIVE = `docs/exec-plans/active/${ID}`;
const DONE = `docs/exec-plans/completed/${ID}`;
const FRONT = `---\nid: ${ID}\nissue: 3\ntype: feat\nstatus: active\nsize: medium\nrisk: normal\nauthor: claude-code\nowner: r\nclaimed_at: 2026-11-22T09:00:00+09:00\n---\n`;
/** 계획 본문. related가 null이면 "관련 파일·문서" 섹션이 없다 */
const plan = (related: string | null) =>
  `${FRONT}# 데모\n\n## 목표와 수용 기준\n- 만든다\n\n## 범위 / 비범위\n- \`other/in-scope-section.ts\`는 범위 경로가 아니다\n\n${
    related === null ? '' : `## 관련 파일·문서\n\n${related}\n\n`
  }## 진행 로그\n- \`log/not-scope.ts\`\n\n## 발견 사항\n- 없음\n\n## 검증 방법과 결과\n- node --test\n`;
const RELATED = '- `src/a.ts`, `src/lib/`(설명)\n- `docs/*.md`\n- 읽기만: `src/read.ts`';

test('scopePaths: 백틱 안의 글자를 순서대로 뽑고, 공백이 든 것과 빈 것과 중복은 버린다', () => {
  assert.deepEqual(
    scopePaths('- `a.ts`, `b/c.ts`(설명) 그리고 `a.ts`\n- `git status`, ` `, `d/`'),
    ['a.ts', 'b/c.ts', 'd/'],
  );
  assert.deepEqual(scopePaths(''), []);
  assert.deepEqual(scopePaths('- src/a.ts\n- 설계서 6절'), []);
});

test('scopePaths: 백틱 하나로 감싼 코드 스팬만 경로다(둘 이상으로 감싼 것은 예시다)', () => {
  // 백틱 둘·셋으로 감싼 글자는 경로가 아니다
  assert.deepEqual(scopePaths('- 예시: ``outside.ts``'), []);
  assert.deepEqual(scopePaths('- 예시: ```outside.ts```'), []);
  // 같은 줄에 예시와 정상 경로가 함께 있으면 정상 경로만 뽑는다
  assert.deepEqual(scopePaths('- ``x.ts``는 예시이고 `y.ts`는 바꾼다'), ['y.ts']);
  assert.deepEqual(scopePaths('- `y.ts`, ``x.ts``, `z.ts`'), ['y.ts', 'z.ts']);
  // 백틱 둘로 감싼 스팬 안의 백틱 하나(백틱을 글자로 보이는 표기)는 경로가 아니다
  assert.deepEqual(scopePaths('- 표기 예: `` `late.ts` ``'), []);
  assert.deepEqual(scopePaths('- `` `late.ts` ``와 `real.ts`'), ['real.ts']);
  // 닫히지 않은 백틱 줄은 글자다: 뒤의 스팬을 삼키지 않는다
  assert.deepEqual(scopePaths('- ``열고 닫지 않은 것과 `a.ts`'), ['a.ts']);
  assert.deepEqual(scopePaths('- `닫지않음'), []);
  // 계획 전체에서도 같다: 백틱 둘로 적은 파일을 바꾸면 범위 밖이다
  assert.deepEqual(planScopePaths(plan('- `src/a.ts`\n- 예시: ``outside.ts``')), ['src/a.ts']);
  assert.deepEqual(
    judgeScope(
      ['outside.ts', 'src/a.ts'],
      planScopePaths(plan('- `src/a.ts`\n- 예시: ``outside.ts``')),
    ).outside,
    ['outside.ts'],
  );
});

test('scopePaths: 역슬래시로 막은 백틱은 코드 스팬을 열지 않는다(스팬 밖에서만)', () => {
  // 막은 백틱 바로 뒤의 스팬: 첫 백틱은 글자이고 둘째 백틱이 스팬을 연다
  assert.deepEqual(scopePaths('- \\``real.ts`'), ['real.ts']);
  assert.deepEqual(scopePaths('- 글자 백틱 \\` 과 `a.ts`'), ['a.ts']);
  // 막은 백틱 둘 사이의 글자는 스팬이 아니다
  assert.deepEqual(scopePaths('- \\`not.ts\\`'), []);
  // 역슬래시 둘 뒤의 백틱은 막히지 않았다(앞의 둘이 역슬래시 하나다)
  assert.deepEqual(scopePaths('- \\\\`b.ts`'), ['b.ts']);
  // 스팬 안에서는 역슬래시가 글자다: 스팬은 다음 백틱에서 닫힌다
  assert.deepEqual(scopePaths('- `src\\` 그리고 `c.ts`'), ['src\\', 'c.ts']);
  // 막은 백틱이 백틱 둘 묶음의 길이를 바꾸지 않는다
  assert.deepEqual(scopePaths('- \\```x.ts`` 와 `d.ts`'), ['d.ts']);
  // 줄 끝의 역슬래시
  assert.deepEqual(scopePaths('- `e.ts` \\'), ['e.ts']);
  // 계획 전체에서: 막은 백틱 뒤에 적은 경로만 바뀌면 통과다
  const paths = planScopePaths(plan('- \\``real.ts`'));
  assert.deepEqual(paths, ['real.ts']);
  assert.deepEqual(judgeScope(['real.ts'], paths).outside, []);
});

test('scopePaths: HTML 주석과 코드 블록 안의 글자는 넣지 않는다', () => {
  assert.deepEqual(scopePaths('<!-- `x.ts` -->\n- `a.ts`\n<!--\n- `y.ts`\n-->\n- `b.ts`'), [
    'a.ts',
    'b.ts',
  ]);
  assert.deepEqual(scopePaths('- `a.ts`\n```text\n- `in.ts`\n```\n- `b.ts`\n~~~\n`in2.ts`\n~~~'), [
    'a.ts',
    'b.ts',
  ]);
  // 긴 바깥 펜스 안의 짧은 펜스는 블록을 닫지 않는다
  const nested = '- `a.ts`\n````md\n```ts\n- `in.ts`\n```\n- `still-in.ts`\n````\n- `b.ts`';
  assert.deepEqual(scopePaths(nested), ['a.ts', 'b.ts']);
  // 닫는 펜스는 같은 글자여야 하고 여는 것보다 짧지 않아야 한다. 정보 문자열이 붙은 줄은 닫지 않는다
  assert.deepEqual(scopePaths('```\n~~~\n`in.ts`\n```md\n`in2.ts`\n````\n- `b.ts`'), ['b.ts']);
  // 닫히지 않은 블록은 끝까지다
  assert.deepEqual(scopePaths('- `a.ts`\n```\n- `in.ts`'), ['a.ts']);
  // 한 줄 안에서 백틱 셋으로 감싼 글자는 펜스가 아니다(그 줄은 코드 블록을 열지 않는다)
  assert.deepEqual(scopePaths('```x``` `a.ts`\n- `b.ts`').includes('b.ts'), true);
});

test('scopePaths: 주석과 코드 블록은 먼저 열린 쪽으로 가린다(주석 안의 펜스 줄은 블록을 열지 않는다)', () => {
  // 주석 안의 닫히지 않은 펜스 줄: 주석 뒤의 경로가 뽑힌다(Issue #202)
  for (const fence of ['~~~', '```', '~~~~md'])
    assert.deepEqual(
      scopePaths(`- \`a.ts\`\n<!--\n${fence}\n-->\n- \`b.ts\``),
      ['a.ts', 'b.ts'],
      fence,
    );
  // 주석 안의 경로는 펜스 줄이 함께 있어도 빠진다
  assert.deepEqual(scopePaths('<!--\n~~~\n- `x.ts`\n-->\n- `b.ts`'), ['b.ts']);
  // 주석 안에 열고 닫은 펜스, 한 줄 주석: 전과 같다
  assert.deepEqual(scopePaths('- `a.ts`\n<!--\n~~~\n`x.ts`\n~~~\n-->\n- `b.ts`'), ['a.ts', 'b.ts']);
  assert.deepEqual(scopePaths('- `a.ts`\n<!-- ~~~ -->\n- `b.ts`'), ['a.ts', 'b.ts']);
  // 펜스가 먼저 열렸으면 그 안의 `<!--`는 주석을 열지 않는다: 펜스가 닫힌 뒤의 경로가 뽑힌다
  assert.deepEqual(scopePaths('```\n<!--\n`in.ts`\n```\n- `b.ts`\n-->\n- `c.ts`'), [
    'b.ts',
    'c.ts',
  ]);
  // 주석이 닫힌 줄의 나머지 글은 읽힌다
  assert.deepEqual(scopePaths('<!--\n~~~\n--> `after.ts`\n- `b.ts`'), ['after.ts', 'b.ts']);
  assert.deepEqual(scopePaths('- `a.ts` <!-- 설명\n`x.ts` --> `b.ts`'), ['a.ts', 'b.ts']);
  // 닫히지 않은 `<!--`는 주석이 아니다
  assert.deepEqual(scopePaths('- `a.ts` <!-- 닫지 않았다\n- `b.ts`'), ['a.ts', 'b.ts']);
  // 주석은 `## ` 줄을 넘지 못한다(계획 해시의 섹션 추출과 같다): 여는 표식과 닫는 표식 사이에 `## ` 줄이 있으면
  // 그 여는 표식은 닫히지 않은 것이고, 절은 그 줄에서 끝난다. 다음 절의 닫는 표식 뒤에 적은 경로는 뽑히지 않는다
  assert.deepEqual(
    scopePaths('- `a.ts` <!-- 닫지 않았다\n- `b.ts`\n## 진행 로그\n- `log.ts`\n-->\n- `late.ts`'),
    ['a.ts', 'b.ts'],
  );
  assert.deepEqual(scopePaths('- `a.ts`\n<!--\n## 주석 안의 제목\n-->\n- `late.ts`'), ['a.ts']);
  assert.deepEqual(scopePaths('- `a.ts`\n<!--\n## 제목 -->\n- `late.ts`'), ['a.ts']);
  // 닫힌 주석 뒤의 `## ` 줄에서 끝난다. 그 뒤에 닫는 표식이 더 있어도 같다
  assert.deepEqual(scopePaths('- `a.ts`\n<!-- x -->\n## 다음 절\n- `late.ts`\n-->'), ['a.ts']);
  // 주석 안의 코드 블록 속 `## ` 줄은 절의 경계가 아니다: 주석은 닫는 표식까지이고 그 안의 경로는 빠진다(판정 2회차 F2·F3)
  for (const fence of ['~~~', '```'])
    assert.deepEqual(
      scopePaths(`- \`a.ts\`\n<!--\n${fence}\n## 예시\n${fence}\n- \`x.ts\`\n-->\n- \`b.ts\``),
      ['a.ts', 'b.ts'],
      fence,
    );
  assert.deepEqual(scopePaths('- `a.ts`\n<!--\n```md\n## 예시\n```\n`x.ts`\n--> `after.ts`'), [
    'a.ts',
    'after.ts',
  ]);
  // 주석 안의 코드 블록이 닫힌 뒤의 `## ` 줄은 경계다: 그 여는 표식은 닫히지 않은 것이고 절은 그 줄에서 끝난다
  assert.deepEqual(
    scopePaths('- `a.ts`\n<!--\n~~~\n## 예시\n~~~\n## 진행 로그\n- `log.ts`\n-->\n- `late.ts`'),
    ['a.ts'],
  );
  // 주석 안의 닫히지 않은 코드 블록 속 `## ` 줄: 계획 해시의 섹션 추출도 그 줄을 제목으로 보지 않는다. 주석이 닫힌 뒤를 읽는다
  assert.deepEqual(scopePaths('- `a.ts`\n<!--\n~~~\n## 예시\n- `x.ts`\n-->\n- `b.ts`'), [
    'a.ts',
    'b.ts',
  ]);
  // 긴 입력: 여는 표식마다 뒤의 `## ` 줄과 닫는 표식을 다시 찾지 않는다
  {
    const many = Array.from({ length: 20_000 }, (_, i) => `- \`g${i}.ts\` <!-- 닫지 않았다`);
    const started = Date.now();
    assert.equal(
      scopePaths([...many, '## 다음 절', '-->', '- `late.ts`'].join('\n')).length,
      20_000,
    );
    assert.ok(Date.now() - started < 5_000, `걸린 시간 ${Date.now() - started}ms`);
  }
  {
    // 코드 블록을 여닫는 줄 사이사이에 닫히지 않은 여는 표식이 있고 `## ` 줄과 닫는 표식이 맨 끝에 있다
    const many = Array.from({ length: 20_000 }, (_, i) =>
      i % 3 === 0 ? `- \`h${i}.ts\` <!-- 닫지 않았다` : '~~~',
    );
    const started = Date.now();
    scopePaths([...many, '## 다음 절', '-->'].join('\n'));
    assert.ok(Date.now() - started < 5_000, `걸린 시간 ${Date.now() - started}ms`);
  }
});

test('scopePaths: 닫히지 않은 주석 표식이 많은 긴 글도 시간 안에 읽는다', () => {
  const lines = Array.from({ length: 20_000 }, (_, i) => `- \`f${i}.ts\` <!-- 닫지 않았다`);
  const started = Date.now();
  const paths = scopePaths(lines.join('\n'));
  assert.equal(paths.length, 20_000);
  assert.ok(Date.now() - started < 5_000, `걸린 시간 ${Date.now() - started}ms`);
});

test('scopePaths: 읽기만으로 시작하는 항목과 그에 딸린 줄은 넣지 않는다', () => {
  const text = [
    '- `a.ts`',
    '- 읽기만: `r1.ts`, `r2.ts`',
    '  - `r3.ts`',
    '',
    '    이어지는 줄 `r4.ts`',
    '- `b.ts`(읽기만)',
    '* 읽기만 `r5.ts`',
    '+ 읽기만: `r6.ts`',
    '  - 읽기만: `r7.ts`',
    '  - `c.ts`',
    '- 읽기만은 아니다가 아니라 머리가 읽기만이다 `r8.ts`',
    '`d.ts` 읽기만',
  ].join('\n');
  // `+ 읽기만` 아래의 더 깊은 항목(`c.ts`)도 그 항목에 딸린 줄이다
  assert.deepEqual(scopePaths(text), ['a.ts', 'b.ts', 'd.ts']);
});

/** 계획 폴더만 둔 임시 폴더에서 계획 해시를 구한다 */
function hashOf(planText: string): string {
  const root = tmp();
  write(root, `${ACTIVE}/plan.md`, planText);
  return planHash(root, ACTIVE);
}

test('planScopePaths: 계획 해시에 들어가는 "관련 파일" 섹션의 글자에서만 읽는다', () => {
  assert.deepEqual(planScopePaths(plan(null)), []);
  // 다른 섹션(앞의 "범위 / 비범위", 뒤의 "진행 로그")에 적힌 경로는 들어가지 않는다
  assert.deepEqual(planScopePaths(plan(RELATED)), ['src/a.ts', 'src/lib/', 'docs/*.md']);

  // 긴 펜스 안의 짧은 펜스 한 쌍과 그 사이의 `## ` 줄: 해시의 섹션은 그 줄에서 끝난다.
  // 그 뒤(바깥 블록이 닫힌 뒤)에 적은 경로는 해시에 묶이지 않으므로 범위에 넣지 않는다
  const tricky = (late: string) => '- `a.ts`\n````md\n```\n## 예시\n```\n````\n' + late;
  assert.deepEqual(planScopePaths(plan(tricky('- `late.ts`'))), ['a.ts']);
  assert.equal(hashOf(plan(tricky('- `late.ts`'))), hashOf(plan(tricky(''))));

  // 안쪽 펜스가 홀수 번 나와 해시의 섹션이 뒤의 섹션까지 삼킨 경우: 코드 블록 밖의 `## ` 줄에서 그친다
  const odd = '- `a.ts`\n````md\n```\n````';
  assert.deepEqual(planScopePaths(plan(odd)), ['a.ts']);
});

test('planScopePaths: 범위 경로가 달라지는 계획 수정은 계획 해시도 바꾼다', () => {
  const related = [
    RELATED,
    RELATED + '\n- `added.ts`',
    '- `a.ts`\n````md\n```\n## 예시\n```\n````\n- `late.ts`',
    '- `a.ts`\n````md\n```\n## 예시\n```\n````',
    '- `a.ts`\n````md\n```\n- `in.ts`\n```\n````\n- `b.ts`',
    '- `a.ts`\n````md\n```\n````',
    '- `a.ts`\n````md\n```\n````\n- `after.ts`',
    '```\n<!--\n```\n- `x.ts`\n-->',
    '```\n<!--\n```\n- `y.ts`\n-->',
    '- 읽기만: `r.ts`\n- `a.ts`',
    '- `r.ts`\n- `a.ts`',
    '~~~\n```\n- `t.ts`\n~~~\n- `u.ts`',
  ];
  const plans = [plan(null), ...related.map((r) => plan(r))];
  // 뒤의 섹션("진행 로그")만 다른 계획도 견준다
  plans.push(plan(RELATED).replace('`log/not-scope.ts`', '`log/other.ts`'));
  plans.push(plan('- `a.ts`\n````md\n```\n````').replace('`log/not-scope.ts`', '`log/other.ts`'));
  const seen = plans.map((p) => ({ paths: JSON.stringify(planScopePaths(p)), hash: hashOf(p) }));
  let differing = 0;
  for (const a of seen)
    for (const b of seen) {
      if (a.paths === b.paths) continue;
      differing++;
      assert.notEqual(a.hash, b.hash, `${a.paths} / ${b.paths}`);
    }
  assert.ok(differing > 50, String(differing));
});

test('inScope: 글자 그대로의 경로, glob, 폴더 아래', () => {
  assert.equal(inScope('src/a.ts', ['src/a.ts']), true);
  assert.equal(inScope('src/b.ts', ['src/a.ts']), false);
  assert.equal(inScope('scripts/ci/a/b.ts', ['scripts/ci/**']), true);
  assert.equal(inScope('docs/x.md', ['docs/*.md']), true);
  assert.equal(inScope('docs/a/x.md', ['docs/*.md']), false);
  assert.equal(inScope('scripts/ci/a/b.ts', ['scripts/ci/']), true);
  assert.equal(inScope('scripts/ci/a/b.ts', ['scripts/ci']), true);
  assert.equal(inScope('scripts/ci-x/a.ts', ['scripts/ci']), false);
  assert.equal(inScope('scripts/ci', ['scripts/ci/']), false);
  assert.equal(inScope('a.ts', []), false);
  assert.equal(inScope('a.ts', ['/']), false);
  // 역슬래시가 든 파일 이름은 그 글자 그대로다: 폴더 경로와 같은 것으로 보지 않는다
  assert.equal(inScope('src\\a.ts', ['src/a.ts']), false);
  assert.equal(inScope('src\\x.ts', ['src/']), false);
  assert.equal(inScope('src\\a.ts', ['src\\a.ts']), true);
});

test('judgeScope: 긴 경로가 많아도 결과의 크기가 묶이고, 고치는 법과 근거는 남는다', () => {
  const files = Array.from(
    { length: 40 },
    (_, i) => `out/${String(i).padStart(2, '0')}/` + '가'.repeat(4000),
  );
  const r = judgeScope(files, ['src/']);
  assert.equal(r.outside.length, 40);
  assert.ok(r.description.startsWith(WARN_PREFIX));
  assert.ok(r.description.length <= 200, String(r.description.length));
  const size = Buffer.byteLength(JSON.stringify({ d: r.description, x: r.details }), 'utf8');
  assert.ok(size < 16_000, String(size));
  assert.ok(r.details.every((l) => l.length <= DETAIL_LINE_MAX));
  assert.ok(r.details[0].startsWith('고치는 법'));
  assert.ok(r.details[1].startsWith('근거') && r.details[1].includes('R18'));
  assert.equal(r.details[r.details.length - 1], DETAILS_CUT);
});

test('judgeScope: 파일 이름의 줄바꿈·펜스 글자가 상세의 줄을 늘리거나 요약의 코드 블록을 닫지 못한다', () => {
  const names = ['```', '~~~~', 'a\n```\n# 제목', 'b\r\n## x', 'c\u2028d', 'src\\e.ts'];
  const r = judgeScope([...names, 'src/ok.ts'], ['src/']);
  assert.deepEqual(r.outside, [...names].sort());
  // 고정 줄 둘 뒤에 파일마다 한 줄
  assert.equal(r.details.length, 2 + names.length);
  for (const l of r.details.slice(2)) {
    assert.ok(l.startsWith('- '), JSON.stringify(l));
    assert.ok(!/[\p{Cc}\u2028\u2029]/u.test(l), JSON.stringify(l));
  }
  assert.ok(r.details.includes('- ```'));
  assert.ok(r.details.includes('- a\\n```\\n# 제목'));
  assert.ok(r.details.includes('- src\\\\e.ts'));
  assert.ok(!/[\p{Cc}\u2028\u2029]/u.test(r.description), JSON.stringify(r.description));
  // 요약의 코드 블록은 상세가 끝난 자리에서 닫힌다
  const md = summaryMarkdown({
    version: 1,
    headSha: 'a'.repeat(40),
    results: [{ context: 'scope', state: r.state, description: r.description, details: r.details }],
  }).split('\n');
  const open = md.indexOf('```text');
  assert.ok(open > 0);
  assert.equal(
    md.findIndex((l, i) => i > open && /^\s*(`{3,}|~{3,})\s*$/.test(l)),
    open + 1 + r.details.length,
  );
  assert.ok(!md.some((l, i) => i > 0 && /^#{1,2}\s/.test(l)), md.join('\n'));
  // 견줄 때는 원래 글자다: 줄바꿈이 든 파일도 폴더 아래면 범위 안이다
  assert.deepEqual(judgeScope(['src/a\nb.ts'], ['src/']).outside, []);
  assert.deepEqual(judgeScope(['src/a\nb.ts'], ['src/**']).outside, []);
});

test('judgeScope: 범위 경로가 없어도 바뀐 파일이 상세에 한 줄씩 나온다', () => {
  const r = judgeScope(['src/a.ts', 'b\nc.ts', '```'], []);
  assert.ok(r.description.startsWith(WARN_PREFIX) && r.description.includes('견줄 수 없다'));
  assert.ok(!r.description.includes('src/a.ts'), r.description);
  assert.deepEqual(r.outside, ['```', 'b\nc.ts', 'src/a.ts']);
  assert.equal(r.details.length, 3 + 3);
  assert.ok(r.details[0].includes('백틱'));
  assert.ok(r.details[1].startsWith('고치는 법') && r.details[2].startsWith('근거'));
  assert.deepEqual(r.details.slice(3), ['- ```', '- b\\nc.ts', '- src/a.ts']);
  // 많으면 30개까지만 적고, 긴 경로는 크기 상한에 묶인다
  const many = judgeScope(
    Array.from({ length: 31 }, (_, i) => `f${String(i).padStart(2, '0')}.ts`),
    [],
  );
  assert.equal(many.details.filter((l) => /^- f\d\d\.ts$/.test(l)).length, 30);
  assert.ok(many.details.includes('… 외 1개'));
  const long = judgeScope(
    Array.from({ length: 40 }, (_, i) => `${'가'.repeat(4000)}${i}`),
    [],
  );
  assert.ok(long.details.every((l) => l.length <= DETAIL_LINE_MAX));
  assert.equal(long.details.at(-1), DETAILS_CUT);
  assert.ok(Buffer.byteLength(JSON.stringify(long.details)) < 16_000);
});

/**
 * GitHub이 표의 행을 칸으로 가르는 규칙(GFM 표): 바로 앞에 역슬래시가 없는 `|`에서만 가르고,
 * 칸의 글자에서 `|` 바로 앞의 역슬래시 하나를 뗀다. 역슬래시 쌍을 먼저 묶지 않는다
 * (GitHub의 Markdown API로 확인했다. 계획 20261122-size-scope-warn의 진행 로그)
 */
function tableCells(row: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (row[i] === '|') {
      cells.push(cur);
      cur = '';
    } else cur += row[i];
  }
  cells.push(cur);
  // 행의 첫 `|` 앞과 끝 `|` 뒤는 칸이 아니다
  return cells.slice(1, -1).map((c) => c.trim());
}

/** 코드 스팬의 안쪽 글자(CommonMark: 구분 백틱은 길이가 같고, 안이 공백으로 시작하고 끝나면 하나씩 뗀다) */
function codeSpanText(cell: string): string | null {
  const m = /^(`+)([\s\S]*?)(`+)$/.exec(cell);
  if (!m || m[1] !== m[3]) return null;
  // 안에 같은 길이의 백틱 줄이 있으면 거기서 먼저 닫힌다
  if ((m[2].match(/`+/g) ?? []).some((x) => x.length === m[1].length)) return null;
  const t = m[2];
  return t.startsWith(' ') && t.endsWith(' ') && t.trim() ? t.slice(1, -1) : t;
}

test('summaryMarkdown: 표의 설명은 코드 스팬이라 파일 이름이 글자 그대로 보인다(굵게·링크·HTML·표 칸이 되지 않는다)', () => {
  const names = [
    '**approved**.md',
    '_x_.ts',
    '[a](https://example.invalid)',
    '<b>x</b>',
    'a|b',
    '`c`',
    '``d` e',
    '~~f~~',
    '&amp;',
    '@someone',
    '#1',
    ':tada:',
    'https://example.invalid/x',
    'g\\|h',
    '$x$',
  ];
  const descriptions = [
    ...names.map((n) => judgeScope([n], ['src/']).description),
    // 설명에 역슬래시 하나 뒤의 `|`, 둘 뒤의 `|`, 끝의 역슬래시가 직접 든 경우
    'x\\|y',
    'x\\\\|y',
    '|x|',
    'x\\',
    ' 앞뒤 공백 ',
  ];
  for (const description of descriptions) {
    const md = summaryMarkdown({
      version: 1,
      headSha: 'a'.repeat(40),
      results: [{ context: 'scope', state: 'success', description, details: [] }],
    });
    const rows = md.split('\n').filter((l) => l.startsWith('| scope | '));
    assert.equal(rows.length, 1, md);
    // 행이 정확히 세 칸으로 갈리고, 셋째 칸이 코드 스팬 하나이며 그 안의 글자가 설명 그대로다
    const cells = tableCells(rows[0]);
    assert.equal(cells.length, 3, rows[0]);
    assert.equal(cells[0], 'scope');
    assert.equal(codeSpanText(cells[2]), description, rows[0]);
  }
  // 상세의 코드 블록에는 showPath를 거친 글자가 한 줄로 있다
  for (const name of names) {
    const r = judgeScope([name], ['src/']);
    const md = summaryMarkdown({
      version: 1,
      headSha: 'a'.repeat(40),
      results: [
        { context: 'scope', state: r.state, description: r.description, details: r.details },
      ],
    });
    assert.ok(md.split('\n').includes(`- ${name.replace(/\\/g, '\\\\')}`), md);
  }
  assert.equal(cellCode('a\nb|c'), '` a b\\|c `');
  assert.equal(cellCode('a\r\n\u2028b'), '` a b `');
  assert.equal(cellCode(''), '');
  assert.equal(cellCode(' \n'), '');
  assert.equal(cellCode('`'), '`` ` ``');
  // 필수 판정의 설명도 같은 규칙이다
  const md = summaryMarkdown({
    version: 1,
    headSha: 'a'.repeat(40),
    results: [{ context: 'check', state: 'failure', description: 'x **y**', details: [] }],
  });
  assert.ok(md.includes('| check | 실패 | ` x **y** ` |'), md);
});

type Files = Record<string, string | null>;

/** base 커밋과 PR 브랜치 커밋(null은 삭제)을 둔 리포. 계획은 files에 직접 넣는다 */
function repo(files: Files, baseFiles: Record<string, string> = {}, branch = BRANCH) {
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig()));
  for (const [f, c] of Object.entries(baseFiles)) write(root, f, c);
  const base = commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', branch], root);
  for (const [f, c] of Object.entries(files)) {
    if (c === null) sh('git', ['rm', '-q', '-r', f], root);
    else write(root, f, c);
  }
  const head = commitAll(root, 'change');
  return { root, base, head, branch };
}
const PLAN_FILES = (related: string | null, dir = ACTIVE): Files => ({
  [`${dir}/plan.md`]: plan(related),
  [`${dir}/index.json`]: JSON.stringify({
    plan: ID,
    steps: [{ step: 0, name: 's0', status: 'completed' }],
  }),
  [`${dir}/step0.md`]:
    '# Step 0: s0\n\n## 작업\n- 만든다\n\n## Acceptance Criteria\n```bash\ntrue\n```\n',
});

test('scopeCheck: 바뀐 파일이 모두 범위 안이면 통과다', () => {
  const r = scopeCheck(
    repo({
      ...PLAN_FILES(RELATED),
      'src/a.ts': 'x\n',
      'src/lib/deep/b.ts': 'x\n',
      'docs/n.md': 'x\n',
    }),
  );
  assert.equal(r.state, 'success');
  assert.equal(r.description, '통과 (바뀐 파일 3개가 모두 계획의 관련 파일 안)');
  assert.deepEqual(r.outside, []);
  assert.deepEqual(r.details, []);
});

test('scopeCheck: 범위 밖 파일(삭제 포함)과 읽기만 항목의 파일은 경고로 나온다', () => {
  const r = scopeCheck(
    repo(
      {
        ...PLAN_FILES(RELATED),
        'src/a.ts': 'x\n',
        'zeta/new.ts': 'x\n',
        'gone.ts': null,
        'src/read.ts': 'y\n',
        // 다른 섹션에 적힌 경로는 범위가 아니다
        'log/not-scope.ts': 'x\n',
        'other/in-scope-section.ts': 'x\n',
      },
      { 'gone.ts': 'x\n', 'src/read.ts': 'x\n' },
    ),
  );
  assert.equal(r.state, 'success');
  const want = [
    'gone.ts',
    'log/not-scope.ts',
    'other/in-scope-section.ts',
    'src/read.ts',
    'zeta/new.ts',
  ];
  assert.deepEqual(r.outside, want);
  assert.ok(r.description.startsWith(WARN_PREFIX), r.description);
  assert.ok(r.description.includes('5개'), r.description);
  assert.ok(r.description.includes('gone.ts, log/not-scope.ts'), r.description);
  assert.ok(r.description.includes('외 3개'), r.description);
  assert.ok(r.details[0].includes('고치는 법') && r.details[0].includes('병합을 막지 않는다'));
  assert.ok(r.details[1].includes('근거') && r.details[1].includes('R18'));
  assert.deepEqual(
    r.details.slice(2),
    want.map((f) => `- ${f}`),
  );
});

test('scopeCheck: 계획 자신의 파일은 늘 범위 안이다(active, completed, 옮긴 계획의 삭제)', () => {
  // 관련 파일에 계획 폴더가 없어도 통과
  const active = scopeCheck(repo({ ...PLAN_FILES(RELATED), 'src/a.ts': 'x\n' }));
  assert.equal(active.description, '통과 (바뀐 파일 1개가 모두 계획의 관련 파일 안)');
  // base의 active/ 계획을 completed/로 옮긴 PR: active/의 삭제도 범위 안이다
  const base: Record<string, string> = {};
  for (const [f, c] of Object.entries(PLAN_FILES(RELATED))) base[f] = c as string;
  const moved = scopeCheck(
    repo({ [ACTIVE]: null, ...PLAN_FILES(RELATED, DONE), 'src/a.ts': 'x\n' }, base),
  );
  assert.equal(moved.description, '통과 (바뀐 파일 1개가 모두 계획의 관련 파일 안)');
  // 이름이 비슷한 다른 계획의 폴더는 계획 자신의 파일이 아니다
  const other = scopeCheck(
    repo({ ...PLAN_FILES(RELATED), [`${ACTIVE}-x/plan.md`]: 'x\n', [`${ACTIVE}.md.bak`]: 'x\n' }),
  );
  assert.deepEqual(other.outside, [`${ACTIVE}-x/plan.md`, `${ACTIVE}.md.bak`]);
});

test('scopeCheck: 계획 파일만 바뀐 PR은 통과이고, 경로가 없는데 다른 파일이 바뀌면 경고다', () => {
  for (const related of [RELATED, '', null])
    assert.equal(scopeCheck(repo(PLAN_FILES(related))).description, '통과 (계획 파일만 바뀌었다)');
  for (const related of [null, '<!-- 바꿀 파일 `x.ts` -->', '- src/a.ts(백틱 없음)']) {
    const r = scopeCheck(repo({ ...PLAN_FILES(related), 'src/a.ts': 'x\n', 'b.ts': 'x\n' }));
    assert.equal(r.state, 'success');
    assert.ok(r.description.startsWith(WARN_PREFIX), r.description);
    assert.ok(r.description.includes('견줄 수 없다'), r.description);
    assert.deepEqual(r.outside, ['b.ts', 'src/a.ts']);
    assert.deepEqual(r.details.slice(-2), ['- b.ts', '- src/a.ts']);
  }
});

test('scopeCheck: 소규모 계획도 같은 규칙이고, 계획에 이어지지 않는 브랜치는 보지 않는다', () => {
  const small = `docs/exec-plans/active/${ID}.md`;
  const text = `${FRONT.replace('size: medium', 'size: small')}# 데모\n\n- 목표: x\n- 변경: y\n- 검증: z\n\n## 관련 파일·문서\n\n- \`src/a.ts\`\n`;
  const r = scopeCheck(
    repo({ [small]: text, 'src/a.ts': 'x\n', 'src/b.ts': 'x\n' }, {}, `fix/${ID}`),
  );
  assert.deepEqual(r.outside, ['src/b.ts']);
  assert.ok(r.description.startsWith(WARN_PREFIX));

  const NONE = '계획이 없어 범위를 보지 않는다';
  for (const branch of [`revert/${'a'.repeat(40)}`, 'claim/1']) {
    const x = repo({ ...PLAN_FILES(RELATED), 'zeta.ts': 'x\n' }, {}, branch);
    assert.equal(scopeCheck(x).description, NONE);
  }
  // 브랜치는 계획 꼴인데 계획 파일이 없다
  assert.equal(scopeCheck(repo({ 'zeta.ts': 'x\n' })).description, NONE);
});

test('scopeCheck: 해시에 묶이지 않는 자리에 경로를 더해도 그 파일의 경고는 남는다', () => {
  const tricky = (late: string) => '- `a.ts`\n````md\n```\n## 예시\n```\n````\n' + late;
  const before = repo({ ...PLAN_FILES(tricky('')), 'a.ts': 'x\n', 'late.ts': 'x\n' });
  const after = repo({ ...PLAN_FILES(tricky('- `late.ts`')), 'a.ts': 'x\n', 'late.ts': 'x\n' });
  assert.equal(planHash(before.root, ACTIVE), planHash(after.root, ACTIVE));
  for (const r of [before, after]) {
    const s = scopeCheck(r);
    assert.deepEqual(s.outside, ['late.ts']);
    assert.ok(s.description.startsWith(WARN_PREFIX), s.description);
  }
});

test('scopeCheck: 범위 밖 파일이 31개면 30개만 적고 나머지는 수로 적는다', () => {
  const files: Files = { ...PLAN_FILES(RELATED) };
  for (let i = 0; i < 31; i++) files[`out/f${String(i).padStart(2, '0')}.ts`] = 'x\n';
  const r = scopeCheck(repo(files));
  assert.equal(r.outside.length, 31);
  assert.equal(r.details.filter((l) => /^- out\/f\d\d\.ts$/.test(l)).length, 30);
  assert.ok(
    r.details.some((l) => l.includes('외 1개')),
    r.details.join('\n'),
  );
});

test('scopeCheck: 계획은 HEAD 커밋에 추적된 일반 파일로만 읽는다(심볼릭 링크를 따라가지 않는다)', async () => {
  // PR 트리 밖의 파일: 따라가 읽으면 src/ 전체가 범위가 된다
  const outside = tmp();
  write(outside, 'plan.md', plan('- `src/`'));
  write(outside, `${ID}.md`, plan('- `src/`'));
  const cases: Array<{ name: string; link: string; target: string; branch: string }> = [
    {
      name: '소규모 계획 파일이 링크',
      link: `docs/exec-plans/active/${ID}.md`,
      target: path.join(outside, `${ID}.md`),
      branch: `feat/${ID}`,
    },
    { name: '계획 폴더가 링크', link: ACTIVE, target: outside, branch: BRANCH },
    {
      name: '폴더 안의 plan.md가 링크',
      link: `${ACTIVE}/plan.md`,
      target: path.join(outside, 'plan.md'),
      branch: BRANCH,
    },
    { name: 'completed 쪽의 계획 폴더가 링크', link: DONE, target: outside, branch: BRANCH },
  ];
  for (const c of cases) {
    const root = path.join(tmp(), 'pr');
    gitInit(root);
    write(root, 'harness.config.json', JSON.stringify(fixtureConfig()));
    const base = commitAll(root, 'init');
    sh('git', ['checkout', '-q', '-b', c.branch], root);
    write(root, 'src/a.ts', 'x\n');
    sh('git', ['add', 'src/a.ts'], root);
    // 링크는 작업 트리에 만들지 않고 링크 객체(모드 120000, 내용은 가리키는 경로)를 색인에 바로 넣는다. 판정은 HEAD
    // 커밋의 트리만 읽는다. Windows는 권한이 없으면 링크를 만들 수 없다(Issue #228)
    const blob = runSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: c.target });
    sh(
      'git',
      ['update-index', '--add', '--cacheinfo', `120000,${blob.stdout.trim()},${c.link}`],
      root,
    );
    sh('git', ['commit', '-q', '-m', 'change'], root);
    const head = sh('git', ['rev-parse', 'HEAD'], root);
    assert.match(sh('git', ['ls-tree', 'HEAD', '--', c.link], root), /^120000 blob /, c.name);
    assert.throws(
      () => scopeCheck({ root, base, branch: c.branch }),
      /일반 (파일이|폴더가) 아니다/,
      c.name,
    );
    assert.throws(() => readPlanAtHead(root, ID), /일반 (파일이|폴더가) 아니다/, c.name);
    const g = await runGates({
      root,
      cfg: loadConfig(root),
      base,
      branch: c.branch,
      headSha: head,
    });
    const scope = g.results.find((x) => x.context === 'scope')!;
    assert.equal(scope.state, 'error', c.name);
    assert.equal(g.results.find((x) => x.context === 'pr-size')!.state, 'success', c.name);
  }
  // 커밋하지 않은 작업 폴더의 계획은 읽지 않는다: 범위 경로를 더해도 경고는 남는다
  const r = repo({ ...PLAN_FILES(RELATED), 'zeta.ts': 'x\n' });
  write(r.root, `${ACTIVE}/plan.md`, plan(`${RELATED}\n- \`zeta.ts\``));
  assert.deepEqual(scopeCheck(r).outside, ['zeta.ts']);
  // 폴더 자리에 일반 파일이 있으면(링크가 아니다) 그 꼴의 계획이 없는 것이다
  const plain = repo({ [ACTIVE]: 'x\n', 'zeta.ts': 'x\n' });
  assert.equal(scopeCheck(plain).description, '계획이 없어 범위를 보지 않는다');
});

const find = (rs: GateResult[], c: string) => rs.find((x) => x.context === c)!;

test('runGates: scope를 pr-size 뒤에 내고, 경고여도 필수 판정은 그대로다', async () => {
  assert.ok(!(GATE_CONTEXTS as readonly string[]).includes('scope'));
  assert.deepEqual([...WARN_CONTEXTS], ['pr-size', 'scope']);
  const gates = async (r: ReturnType<typeof repo>) =>
    runGates({
      root: r.root,
      cfg: loadConfig(r.root),
      base: r.base,
      branch: BRANCH,
      headSha: r.head,
    });
  const inside = await gates(repo({ ...PLAN_FILES(RELATED), 'src/a.ts': 'x\n' }));
  const outside = await gates(
    repo({ ...PLAN_FILES(RELATED), 'src/a.ts': 'x\n', 'zeta.ts': 'x\n' }),
  );
  for (const r of [inside, outside])
    assert.deepEqual(
      r.results.map((x) => x.context),
      [...RECORDED_CONTEXTS],
    );
  assert.deepEqual(
    outside.results.slice(-2).map((x) => x.context),
    ['pr-size', 'scope'],
  );
  assert.equal(isWarning(find(inside.results, 'scope')), false);
  const s = find(outside.results, 'scope');
  assert.equal(s.state, 'success');
  assert.equal(isWarning(s), true);
  assert.ok(s.details.includes('- zeta.ts'));
  assert.deepEqual(
    GATE_CONTEXTS.map((c) => find(outside.results, c).state),
    GATE_CONTEXTS.map((c) => find(inside.results, c).state),
  );
});

test('runGates: 계획 파일을 읽을 수 없으면 scope만 error이고 pr-size는 그대로다', async () => {
  const r = repo({ 'src/a.ts': 'x\n', [`${ACTIVE}/plan.md/keep.txt`]: 'x\n' });
  mkdirSync(path.join(r.root, ACTIVE, 'plan.md'), { recursive: true });
  const g = await runGates({
    root: r.root,
    cfg: loadConfig(r.root),
    base: r.base,
    branch: BRANCH,
    headSha: r.head,
  });
  assert.deepEqual(
    g.results.map((x) => x.context),
    [...RECORDED_CONTEXTS],
  );
  assert.equal(find(g.results, 'scope').state, 'error');
  assert.equal(find(g.results, 'pr-size').state, 'success');
});

test('gatesOutput: 결과 파일에서 scope가 빠지거나 상세가 빠져도 요약에는 범위 경고와 파일 목록이 남는다', () => {
  const s = judgeScope(['zeta/a.ts', 'zeta/b.ts', 'zeta/c.ts', 'src/a.ts'], ['src/']);
  assert.deepEqual(s.outside, ['zeta/a.ts', 'zeta/b.ts', 'zeta/c.ts']);
  /** 필수 판정의 상세가 pad바이트쯤인 결과에 pr-size(통과)와 scope(경고)를 더한다 */
  const results = (pad: number): GateResults => ({
    version: 1,
    headSha: 'a'.repeat(40),
    results: [
      ...GATE_CONTEXTS.map((context, i) => ({
        context,
        state: 'success' as const,
        description: '통과',
        details: i === 0 ? Array.from({ length: Math.floor(pad / 100) }, () => 'r'.repeat(88)) : [],
      })),
      {
        context: 'pr-size',
        state: 'success',
        description: '통과 (변경 4줄 / 상한 400줄)',
        details: [],
      },
      { context: 'scope', state: s.state, description: s.description, details: s.details },
    ],
  });
  const required = (r: GateResults): GateResults => ({
    ...r,
    results: r.results.filter((g) => (GATE_CONTEXTS as readonly string[]).includes(g.context)),
  });
  // 상세만 빠지는 크기: 필수 판정이 상한 바로 아래이고 scope의 상세를 더하면 넘는다
  let pad = 80_000;
  while (resultsBytes(results(pad + 100)) <= RESULTS_MAX_BYTES) pad += 100;
  const slim = results(pad + 100);
  // 경고 판정이 통째로 빠지는 크기
  while (resultsBytes(required(results(pad + 100))) <= RESULTS_MAX_BYTES) pad += 100;
  const drop = results(pad);
  const contexts = (file: string) =>
    (JSON.parse(file) as GateResults).results.map((g) => g.context);

  const a = gatesOutput(slim);
  assert.ok(Buffer.byteLength(a.file, 'utf8') <= RESULTS_MAX_BYTES);
  assert.deepEqual(contexts(a.file), [...RECORDED_CONTEXTS]);
  assert.ok(!a.file.includes('zeta/a.ts\n') && !a.file.includes('"zeta/c.ts"'));
  const b = gatesOutput(drop);
  assert.ok(Buffer.byteLength(b.file, 'utf8') <= RESULTS_MAX_BYTES);
  assert.deepEqual(contexts(b.file), [...GATE_CONTEXTS]);
  for (const o of [a, b]) {
    assert.ok(o.summary.includes('| scope | 경고 |'), o.summary.slice(0, 600));
    assert.ok(o.summary.includes('### scope'));
    for (const f of s.outside) assert.ok(o.summary.split('\n').includes(`- ${f}`), f);
  }
});

test('gates 명령: 크기 상한이 발동해도 요약 파일에는 범위 경고와 범위 밖 파일 목록이 남는다', async () => {
  // 필수 판정(risk-gate)의 상세를 키운다: 경로 규칙 열 개가 모두 맞는 파일은 근거 줄을 열 개 낸다
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  const riskPaths = Array.from({ length: 10 }, (_, k) => ({
    glob: `pad/${'d'.repeat(k + 1)}*/**`,
    risk: 'normal',
  }));
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig({ riskPaths })));
  const base = commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', BRANCH], root);
  for (const [f, c] of Object.entries(PLAN_FILES(RELATED))) write(root, f, c as string);
  write(root, 'src/a.ts', 'x\n');
  const name = (i: number) => `${'d'.repeat(40)}/${String(i).padStart(4, '0')}${'f'.repeat(40)}`;
  let count = 0;
  const grow = (n: number): string => {
    for (; count < n; count++) write(root, `pad/${name(count)}.md`, 'x\n');
    return commitAll(root, `files ${n}`);
  };
  const gates = (headSha: string) =>
    runGates({ root, cfg: loadConfig(root), base, branch: BRANCH, headSha });
  // 결과가 상한을 처음 넘을 때까지 파일을 하나씩 늘린다(파일 하나가 늘리는 크기가 scope의 상세보다 작다)
  let head = grow(50);
  let r = await gates(head);
  while (resultsBytes(r) <= RESULTS_MAX_BYTES) {
    assert.ok(count < 200, String(resultsBytes(r)));
    head = grow(count + 1);
    r = await gates(head);
  }
  const scope = find(r.results, 'scope');
  assert.equal(isWarning(scope), true);
  // 범위 밖 파일 줄(고정 줄 둘 뒤의 것. 30개와 `… 외 N개`)
  const outside = scope.details.slice(2).filter((l) => l.startsWith('- pad/'));
  assert.equal(outside.length, 30);

  const out = path.join(tmp(), 'gates.json');
  const summary = path.join(tmp(), 'summary.md');
  sh(
    process.execPath,
    [
      path.join(HARNESS_ROOT, 'scripts/harness.ts'),
      'gates',
      ...['--repo', root, '--config-root', root, '--base', base, '--head-ref', BRANCH],
      ...['--out', out, '--summary', summary],
    ],
    root,
  );
  // 결과 파일: 상한 이하이고 범위 밖 파일 줄이 없다(scope의 상세가 빠졌다)
  const file = readFileSync(out, 'utf8');
  assert.ok(Buffer.byteLength(file, 'utf8') <= RESULTS_MAX_BYTES);
  const written = JSON.parse(file) as GateResults;
  assert.deepEqual(find(written.results, 'scope').details, [WARN_DETAILS_DROPPED]);
  assert.equal(find(written.results, 'scope').description, scope.description);
  assert.deepEqual(
    GATE_CONTEXTS.map((c) => find(written.results, c)),
    GATE_CONTEXTS.map((c) => find(r.results, c)),
  );
  // 요약 파일: 범위 경고 행과 범위 밖 파일 목록이 그대로다
  const md = readFileSync(summary, 'utf8').split('\n');
  assert.ok(md.some((l) => l.startsWith('| scope | 경고 |')));
  assert.ok(md.includes('### scope'));
  for (const l of outside) assert.ok(md.includes(l), l);
});

test('레이어: scripts/gates/scope.ts는 scripts/ci/의 파일을 import하지 않는다', () => {
  const src = readFileSync(path.join(HARNESS_ROOT, 'scripts/gates/scope.ts'), 'utf8');
  assert.ok(!src.includes('../ci/'), 'gates/는 ci/보다 아래 층이다');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judge, keyFailures, stepTotals, type Attempt } from '../lib/attempts.ts';
import { run } from '../lib/exec.ts';
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

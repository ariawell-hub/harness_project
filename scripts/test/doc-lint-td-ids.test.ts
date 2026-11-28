// doc-lint가 기술 부채 표에서 같은 id가 두 행 이상에 나오면 오류를 내는지 본다(Issue #251).
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { docLint } from '../gates/doc-lint.ts';
import { loadConfig } from '../lib/config.ts';
import { commitAll, fixtureConfig, gitInit, tmp, write } from './helpers.ts';

const RULE = 'R8 기술 부채 id';
const TRACKER = 'docs/exec-plans/tech-debt-tracker.md';
const FRONT = '---\nstatus: active\nrelated_code: []\nreview_cycle: on-change\n---\n';

/** 표 행 */
const row = (id: string, what: string) => `| ${id.padEnd(6)} | ${what} | 열림 |`;

/** 머리말·제목·표 머리 다음에 행들, 그 뒤에 본문을 둔 표 글자 */
function tracker(rows: string[], tail: string[] = []): string {
  return [
    FRONT.trimEnd(),
    '# 기술 부채',
    '',
    '| id     | 내용 | 상태 |',
    '| ------ | ---- | ---- |',
    ...rows,
    '',
    ...tail,
  ].join('\n');
}

/** 그 줄의 번호(1부터) */
const lineOf = (text: string, line: string) => text.split('\n').indexOf(line) + 1;

/** 설정·지도·색인과 표(없으면 null)를 둔 리포. 커밋까지 한다 */
function repo(table: string | null, exclude: string[] = []): string {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ docLint: { agentsMdMaxLines: 10, exclude } })),
  );
  write(root, 'AGENTS.md', '# 지도\n\n- [목차](docs/index.md)\n');
  write(
    root,
    'docs/index.md',
    `${FRONT}# 목차\n` +
      (table === null ? '' : '\n- [기술 부채](exec-plans/tech-debt-tracker.md)\n'),
  );
  if (table !== null) write(root, TRACKER, table);
  commitAll(root);
  return root;
}

const mine = (root: string) =>
  docLint(root, loadConfig(root)).errors.filter((e) => e.rule === RULE);

test('td-ids: 같은 id가 두 행에 있으면 오류 하나이고, 글에 id와 두 행 번호가 있다', () => {
  const a = row('TD-1', '먼저 더한 행');
  const b = row('TD-2', '다른 행');
  const c = row('TD-1', '나중에 더한 행');
  const text = tracker([a, b, c]);
  const errs = mine(repo(text));
  assert.equal(errs.length, 1, JSON.stringify(errs));
  assert.match(errs[0].what, /TD-1(?!\d)/);
  for (const n of [lineOf(text, a), lineOf(text, c)]) {
    assert.ok(new RegExp(`(?<!\\d)${n}(?!\\d)`).test(errs[0].what), `${n}: ${errs[0].what}`);
  }
  assert.ok(!/TD-2(?!\d)/.test(errs[0].what), errs[0].what);
  assert.match(errs[0].how, /다음 빈 번호/);
});

test('td-ids: id 둘이 각각 겹치면 오류가 둘이다', () => {
  const text = tracker([
    row('TD-70', 'a'),
    row('TD-70', 'b'),
    row('TD-71', 'c'),
    row('TD-71', 'd'),
    row('TD-7', 'TD-70과 앞자리만 같은 다른 id'),
  ]);
  const errs = mine(repo(text));
  assert.equal(errs.length, 2, JSON.stringify(errs));
  assert.ok(errs.some((e) => /TD-70(?!\d)/.test(e.what)));
  assert.ok(errs.some((e) => /TD-71(?!\d)/.test(e.what)));
  assert.ok(!errs.some((e) => /TD-7(?!\d)/.test(e.what)), JSON.stringify(errs));
});

test('td-ids: id가 모두 다르면 오류가 없고, 표 밖의 글에 적은 같은 id는 세지 않는다', () => {
  const text = tracker(
    [row('TD-1', 'a'), row('TD-2', 'b'), row('TD-10', 'c')],
    ['TD-1은 위 표의 행이다.', '', '- TD-2를 처리할 때 TD-1도 본다.', '', '`| TD-1 | 인용 |`'],
  );
  assert.deepEqual(mine(repo(text)), []);
});

test('td-ids: 표가 검사 대상 목록에 없으면 이 규칙을 보지 않는다(파일 없음, docLint.exclude)', () => {
  // (ㄱ) 표 파일을 만들지 않는다: 오류도 예외도 없다
  assert.deepEqual(mine(repo(null)), []);
  // (ㄴ) 중복 id 표를 두고 그 경로를 제외한다
  const dup = tracker([row('TD-1', 'a'), row('TD-1', 'b')]);
  assert.equal(mine(repo(dup)).length, 1, '제외하지 않으면 걸리는 표다');
  assert.deepEqual(mine(repo(dup, [TRACKER])), []);
});

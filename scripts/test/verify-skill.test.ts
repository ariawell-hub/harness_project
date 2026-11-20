// web-verify 스킬 래퍼와 절차서 4절이 같은 명령과 같은 절차 문서를 가리키는지 본다(계획 20261119-pilot-prep 수용 기준 10).
// 스킬과 절차서는 얇은 안내이고 원본은 scripts/verify/와 profiles/web/README.md다(설계서 13.1절). 둘이 어긋나면
// Claude Code(스킬)와 Codex(절차서)가 다른 방식으로 검증하게 된다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { HARNESS_ROOT } from './helpers.ts';

const read = (rel: string) => readFileSync(path.join(HARNESS_ROOT, rel), 'utf8');
const SKILL = '.claude/skills/web-verify/SKILL.md';
const COMMAND = 'node scripts/harness.ts verify';
const README = 'profiles/web/README.md';
const SUMMARY = 'evidence/summary.md';

/** frontmatter(첫 `---`와 다음 `---` 사이)의 `키: 값`과 본문 */
function parseSkill(text: string): { meta: Map<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  assert.ok(m, 'frontmatter가 없다');
  const meta = new Map<string, string>();
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return { meta, body: m[2] };
}

test('web-verify 스킬: 이름과 설명이 있고 본문이 명령·절차 문서·증거 요약을 가리킨다', () => {
  assert.ok(existsSync(path.join(HARNESS_ROOT, SKILL)), `${SKILL}이 없다`);
  const { meta, body } = parseSkill(read(SKILL));
  assert.equal(meta.get('name'), 'web-verify');
  assert.ok((meta.get('description') ?? '').length > 0, 'description이 비었다');
  for (const needle of [COMMAND, README, SUMMARY])
    assert.ok(body.includes(needle), `스킬 본문에 ${needle}이 없다`);
  // 시나리오 하나만 돌리는 꼴: `--` 뒤의 인자만 구현에 넘어간다
  assert.match(body, /node scripts\/harness\.ts verify -- e2e\//);
});

test('web-verify 스킬: local/의 파일을 올리라고 하지 않고, 올리지 말라고 적는다', () => {
  const { body } = parseSkill(read(SKILL));
  const lines = body.split('\n').filter((l) => l.includes('local/'));
  assert.ok(lines.length > 0, 'local/에 대한 규칙이 없다');
  for (const l of lines) assert.match(l, /올리지 않는다/, l);
});

test('web-verify 스킬: 얇은 래퍼다(검증 로직이나 Playwright 사용법을 옮겨 쓰지 않는다)', () => {
  const { body } = parseSkill(read(SKILL));
  assert.ok(body.split('\n').length <= 40, '본문이 길다: 절차의 원본은 profiles/web/README.md다');
  for (const word of ['page.goto', 'allowFailedRequest', 'allowConsoleError', 'playwright.config'])
    assert.equal(body.includes(word), false, `스킬 본문에 ${word}가 있다`);
});

test('절차서 4절: 스킬과 같은 명령, 같은 절차 문서, 증거 요약을 가리킨다', () => {
  const workflow = read('docs/harness/workflow.md');
  const m = /^## 4\.[^\n]*\n([\s\S]*?)^## 5\./m.exec(workflow);
  assert.ok(m, '절차서 4절을 찾지 못했다');
  const section = m[1];
  for (const needle of [COMMAND, README, SUMMARY])
    assert.ok(section.includes(needle), `절차서 4절에 ${needle}이 없다`);
  const lines = section.split('\n').filter((l) => l.includes('local/'));
  assert.ok(lines.length > 0, '절차서 4절에 local/에 대한 규칙이 없다');
  for (const l of lines) assert.match(l, /올리지 않는다/, l);
});

test('웹 프로파일 README: verify 절이 있고 올려도 되는 것(evidence/)과 안 되는 것(local/)을 가른다', () => {
  assert.ok(existsSync(path.join(HARNESS_ROOT, README)), `${README}이 없다`);
  const readme = read(README);
  const m = /^## verify\n([\s\S]*)$/m.exec(readme);
  assert.ok(m, 'README에 verify 절이 없다');
  for (const needle of ['evidence/', 'local/', COMMAND])
    assert.ok(m[1].includes(needle), `README의 verify 절에 ${needle}이 없다`);
  assert.equal(readme.split('\n')[0].includes('초안'), false, 'README 첫머리에 "초안"이 남아 있다');
});

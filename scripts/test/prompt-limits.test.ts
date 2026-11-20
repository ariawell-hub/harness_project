// Codex 프롬프트(scripts/cross-review/prompt-codex.md)의 길이 제한 안내가 판정 형식의 제한(scripts/ci/verdict.ts의 LIMITS)과 맞는지 본다.
// 안내에 없는 제한을 넘기면 판정 전체가 버려진다(Issue #161: resolutions의 note 300자가 안내에 없었다).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { LIMITS } from '../ci/verdict.ts';
import { HARNESS_ROOT } from './helpers.ts';

/** `LIMITS`의 키마다 안내에 있어야 하는 문구 */
const PHRASES: Record<keyof typeof LIMITS, string> = {
  summary: `\`summary\` ${LIMITS.summary}자`,
  findings: `\`findings\` ${LIMITS.findings}개`,
  file: `\`file\` ${LIMITS.file}자`,
  title: `\`title\` ${LIMITS.title}자`,
  evidence: `\`evidence\` ${LIMITS.evidence}자`,
  suggestion: `\`suggestion\` ${LIMITS.suggestion}자`,
  resolutions: `\`resolutions\` ${LIMITS.resolutions}개`,
  note: `\`note\` ${LIMITS.note}자`,
  reproPath: `\`path\` ${LIMITS.reproPath}자`,
  reproContent: `\`content\` ${LIMITS.reproContent}자`,
  repros: `재현 테스트는 판정 하나에 ${LIMITS.repros}개까지`,
};

test('prompt-codex.md의 길이 제한 안내에 판정 형식의 제한이 모두 있고 숫자가 같다', () => {
  const text = readFileSync(
    path.join(HARNESS_ROOT, 'scripts/cross-review/prompt-codex.md'),
    'utf8',
  );
  const lines = text.split('\n').filter((l) => l.startsWith('- 길이 제한: '));
  assert.equal(lines.length, 1, '길이 제한 줄이 하나가 아니다');
  const line = lines[0];
  // LIMITS에 키가 늘면 여기서 걸린다: 안내와 이 표를 함께 고친다
  assert.deepEqual(Object.keys(PHRASES).sort(), Object.keys(LIMITS).sort());
  for (const [key, phrase] of Object.entries(PHRASES))
    assert.ok(line.includes(phrase), `${key}: 안내에 "${phrase}"가 없다`);
  // 안내의 숫자는 LIMITS의 값뿐이다(옛 값이나 다른 숫자가 남아 있지 않다)
  const numbers = (line.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);
  assert.deepEqual(
    numbers,
    Object.values(LIMITS).sort((a, b) => a - b),
  );
  assert.match(line, /넘으면 판정 전체가 버려진다\.$/);
});

test('공통 프롬프트(prompt.md)의 재현 테스트 개수도 판정 형식의 제한과 같다', () => {
  // 두 프롬프트는 같은 판정에 함께 쓰인다. 한쪽만 고치면 서로 다른 상한을 전하게 된다(PR #162의 F1)
  const text = readFileSync(path.join(HARNESS_ROOT, 'scripts/cross-review/prompt.md'), 'utf8');
  const lines = text.split('\n').filter((l) => l.includes('판정 하나에 재현 테스트는'));
  assert.equal(lines.length, 1, '재현 테스트 개수 줄이 하나가 아니다');
  assert.ok(
    lines[0].includes(`판정 하나에 재현 테스트는 ${LIMITS.repros}개까지다`),
    `prompt.md의 재현 테스트 개수가 ${LIMITS.repros}개가 아니다`,
  );
});

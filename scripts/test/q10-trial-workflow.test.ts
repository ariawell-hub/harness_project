// 워크플로 q10-trial(.github/workflows/q10-trial.yml)의 구조: 손으로만 돌고, 읽기 권한뿐이며,
// 비밀·보호 환경·캐시를 쓰지 않는다(설계서 10.4절). 워크플로 파일은 제작자가 올린다(docs/SECURITY.md의
// "워크플로 변경 절차"). 파일이 없거나 리포의 패치와 다르면 이 테스트가 실패해 check가 통과하지 못한다.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { HARNESS_ROOT } from './helpers.ts';

const FILE = path.join(HARNESS_ROOT, '.github/workflows/q10-trial.yml');
const PATCH = path.join(HARNESS_ROOT, 'lab/q10-db/q10-trial-workflow.patch');
const CHECK = readFileSync(path.join(HARNESS_ROOT, '.github/workflows/check.yml'), 'utf8');

function workflow(): string {
  assert.ok(existsSync(FILE), '.github/workflows/q10-trial.yml이 없다(제작자가 올린다)');
  return readFileSync(FILE, 'utf8');
}

/** 주석을 뺀 줄(줄 끝의 `# …`도 뺀다). 구조 단언이 주석의 글에 걸리지 않게 한다 */
function code(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/(^|\s)#.*$/, ''))
    .filter((l) => l.trim());
}

/** `key:` 줄 아래에 더 깊이 들여 쓴 줄들 */
function blockUnder(lines: string[], head: RegExp): string[] {
  const at = lines.findIndex((l) => head.test(l));
  assert.ok(at >= 0, `줄이 없다: ${head}`);
  const indent = lines[at].search(/\S/);
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (l.search(/\S/) <= indent) break;
    out.push(l);
  }
  return out;
}

test('q10-trial: 워크플로 파일이 리포의 패치와 글자 그대로 같다', () => {
  const patch = readFileSync(PATCH, 'utf8').split('\n');
  assert.equal(
    patch.filter((l) => l.startsWith('diff --git ')).length,
    1,
    '패치는 파일 하나만 다룬다',
  );
  assert.ok(patch.includes('+++ b/.github/workflows/q10-trial.yml'));
  assert.ok(patch.includes('--- /dev/null'), '새 파일을 만드는 패치다');
  const added = patch
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1));
  assert.equal(workflow(), `${added.join('\n')}\n`);
});

test('q10-trial: 손으로만 돈다(workflow_dispatch뿐)', () => {
  const lines = code(workflow());
  assert.deepEqual(
    blockUnder(lines, /^on:\s*$/).map((l) => l.trim()),
    ['workflow_dispatch:'],
  );
  for (const trigger of [
    'pull_request',
    'pull_request_target',
    'push',
    'schedule',
    'workflow_run',
    'workflow_call',
  ])
    assert.ok(
      !lines.some((l) => new RegExp(`^\\s*${trigger}:`).test(l)),
      `트리거가 있다: ${trigger}`,
    );
});

test('q10-trial: 권한은 contents: read뿐이고 비밀·보호 환경·캐시를 쓰지 않는다', () => {
  const text = workflow();
  const lines = code(text);
  assert.equal(lines.filter((l) => /^\s*permissions:/.test(l)).length, 1, 'permissions는 한 번');
  assert.ok(lines.includes('permissions:'), 'permissions는 최상위에 있다');
  assert.deepEqual(
    blockUnder(lines, /^permissions:\s*$/).map((l) => l.trim()),
    ['contents: read'],
  );
  assert.doesNotMatch(text, /write/i);
  assert.doesNotMatch(text, /secrets/i);
  assert.ok(!lines.some((l) => /^\s*environment:/.test(l)), 'environment를 쓰지 않는다');
  assert.ok(!lines.some((l) => /actions\/cache|^\s*cache:/.test(l)), '캐시를 쓰지 않는다');
  assert.ok(!lines.some((l) => /^\s*concurrency:/.test(l)));
});

test('q10-trial: 액션은 커밋 SHA로 고정하고, checkout·setup-node는 check.yml과 같다', () => {
  const lines = code(workflow());
  const uses = lines
    .filter((l) => /\buses:/.test(l))
    .map((l) => l.replace(/^.*uses:\s*/, '').trim());
  assert.equal(uses.length, 3);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u);
  const pinned = (text: string, action: string) =>
    code(text)
      .map((l) => new RegExp(`uses:\\s*(${action}@[0-9a-f]{40})`).exec(l)?.[1])
      .filter(Boolean);
  for (const action of ['actions/checkout', 'actions/setup-node']) {
    const here = pinned(workflow(), action);
    assert.equal(here.length, 1, action);
    assert.ok(pinned(CHECK, action).includes(here[0]), `${action}의 SHA가 check.yml과 다르다`);
  }
  assert.ok(
    uses.includes('actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9'),
    'upload-artifact v7.0.2',
  );
  const node = (text: string) => /node-version:\s*'([^']+)'/.exec(text)?.[1];
  assert.ok(node(workflow()));
  assert.equal(node(workflow()), node(CHECK), 'Node 버전이 check.yml과 다르다');
  assert.ok(lines.some((l) => /^\s*persist-credentials: false$/.test(l)));
});

test('q10-trial: Linux와 Windows 러너에서 절차를 돌리고 결과 폴더를 산출물로 올린다', () => {
  const lines = code(workflow());
  assert.ok(lines.some((l) => /^\s*runs-on: \$\{\{ matrix\.os \}\}$/.test(l)));
  assert.ok(lines.some((l) => /^\s*os: \[ubuntu-latest, windows-latest\]$/.test(l)));
  assert.ok(lines.some((l) => /^\s*fail-fast: false$/.test(l)));
  assert.ok(lines.some((l) => /^\s*timeout-minutes: \d+$/.test(l)));
  const runs = lines.filter((l) => /^\s*(- )?run:/.test(l)).map((l) => l.replace(/^.*run:\s*/, ''));
  assert.deepEqual(runs, ['corepack enable', 'node lab/q10-db/run.ts --skip-fmt']);
  // run에 식을 넣지 않는다(여러 줄 블록도 쓰지 않는다)
  for (const r of runs) assert.doesNotMatch(r, /\$\{\{|^[|>]/);
  assert.ok(lines.some((l) => /^\s*path: lab\/q10-db\/results\/$/.test(l)));
  assert.ok(lines.some((l) => /^\s*if-no-files-found: error$/.test(l)));
});

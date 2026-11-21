// 작업 트리에 남은 병합 충돌 표식 줄을 게이트가 찾는지 본다(Issue #175, TD-30).
// 이 파일에는 충돌 표식 줄을 두지 않는다: 표식 문자열은 반복으로 조립한다.
import assert from 'node:assert/strict';
import { chmodSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { conflictMarkers } from '../gates/conflict-markers.ts';
import { runSync } from '../lib/exec.ts';
import { commitAll, fixtureConfig, gitInit, HARNESS_ROOT, sh, tmp, write } from './helpers.ts';

const START = '<'.repeat(7);
const END = '>'.repeat(7);
const MID = '='.repeat(7);
const RULE = 'R7 충돌 표식';
const RULE_FAILED = 'R7 충돌 표식 검사 실패';

/** 2번째 줄에 시작 표식, 4번째 줄에 구분 줄, 6번째 줄에 끝 표식이 있는 충돌 블록 */
const BLOCK = ['a', `${START} HEAD`, 'ours', MID, 'theirs', `${END} other`, 'b', ''].join('\n');

const cli = (args: string[], cwd: string) =>
  runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/harness.ts'), ...args], { cwd });

/** 설정과 지도만 둔 리포. 커밋은 하지 않는다 */
function repo(): string {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig()));
  write(root, 'AGENTS.md', '# 지도\n');
  return root;
}

test('conflict-markers: 완전한 충돌 블록은 파일 한 건으로 알리고 줄 내용은 옮기지 않는다', () => {
  const root = repo();
  write(root, 'src/a.ts', BLOCK);
  commitAll(root);
  const p = conflictMarkers(root);
  assert.equal(p.length, 1);
  assert.equal(p[0].rule, RULE);
  assert.ok(p[0].what.includes('src/a.ts:2'), p[0].what);
  assert.ok(p[0].what.includes('표식 2줄'), p[0].what);
  assert.ok(!p[0].what.includes('HEAD'), p[0].what);
  assert.ok(!p[0].what.includes('other'), p[0].what);
  assert.ok(p[0].how.length > 0);
  assert.ok(p[0].doc.length > 0);
});

test('conflict-markers: 표식 하나만 남은 파일도 걸린다', () => {
  const root = repo();
  write(root, 'end-only.txt', `x\ny\n${END} origin/main\n`);
  write(root, 'start-only.txt', `${START} HEAD\nx\n`);
  write(root, 'bare.txt', `x\n${START}\ny\n`);
  commitAll(root);
  const p = conflictMarkers(root);
  assert.deepEqual(
    p.map((x) => x.rule),
    [RULE, RULE, RULE],
  );
  assert.ok(p[0].what.includes('bare.txt:2'), p[0].what);
  assert.ok(p[0].what.includes('표식 1줄'), p[0].what);
  assert.ok(p[1].what.includes('end-only.txt:3'), p[1].what);
  assert.ok(p[2].what.includes('start-only.txt:1'), p[2].what);
});

test('conflict-markers: 커밋하지 않은 새 파일은 걸리고 무시되는 파일은 걸리지 않는다', () => {
  const root = repo();
  write(root, '.gitignore', '*.log\n');
  commitAll(root);
  write(root, 'new.txt', BLOCK);
  write(root, 'ignored.log', BLOCK);
  const p = conflictMarkers(root);
  assert.equal(p.length, 1);
  assert.ok(p[0].what.includes('new.txt:2'), p[0].what);
});

test('conflict-markers: 표식 모양이 아닌 줄은 걸리지 않는다', () => {
  const root = repo();
  write(
    root,
    'doc.md',
    [
      '제목',
      MID,
      `  ${START} 들여쓴 줄`,
      `문장 중간의 ${START} HEAD 와 ${END} other`,
      `${START}< 여덟 개`,
      `${END}> 여덟 개`,
      `${START}HEAD`,
      `${END}other`,
      '',
    ].join('\n'),
  );
  commitAll(root);
  assert.deepEqual(conflictMarkers(root), []);
});

test('conflict-markers: 줄 끝이 CRLF여도 걸린다', () => {
  const root = repo();
  write(root, 'crlf.txt', `a\r\n${START}\r\nx\r\n${END} other\r\n`);
  commitAll(root);
  const p = conflictMarkers(root);
  assert.equal(p.length, 1);
  assert.ok(p[0].what.includes('crlf.txt:2'), p[0].what);
  assert.ok(p[0].what.includes('표식 2줄'), p[0].what);
});

test('conflict-markers: 바이너리 파일은 걸리지 않는다', () => {
  const root = repo();
  write(root, 'data.bin', `\0\u0001\n${START} HEAD\n${END} other\n`);
  commitAll(root);
  assert.deepEqual(conflictMarkers(root), []);
});

test('conflict-markers: 경로를 그대로 내고 파일마다 한 건을 경로 순으로 낸다', () => {
  const root = repo();
  // Windows는 파일 이름에 콜론을 쓸 수 없다
  const colon = process.platform === 'win32' ? 'a-콜론.txt' : 'a:콜론.txt';
  const names = ['b 공백.txt', colon, 'c/한글 이름.md'];
  for (const n of names) write(root, n, BLOCK);
  commitAll(root);
  const p = conflictMarkers(root);
  assert.equal(p.length, 3);
  assert.ok(p[0].what.startsWith(`${colon}:2`), p[0].what);
  assert.ok(p[1].what.startsWith('b 공백.txt:2'), p[1].what);
  assert.ok(p[2].what.startsWith('c/한글 이름.md:2'), p[2].what);
});

test('conflict-markers: 커밋이 없는 리포의 새 파일도 본다', () => {
  const root = repo();
  write(root, 'new.txt', BLOCK);
  const p = conflictMarkers(root);
  assert.equal(p.length, 1);
  assert.ok(p[0].what.includes('new.txt:2'), p[0].what);
});

test('conflict-markers: 사용자의 git 설정이 달라도 결과가 같다', () => {
  const root = repo();
  write(root, 'src/a.ts', BLOCK);
  commitAll(root);
  const before = conflictMarkers(root);
  assert.equal(before.length, 1);
  sh('git', ['config', 'grep.patternType', 'fixed'], root);
  sh('git', ['config', 'grep.column', 'true'], root);
  sh('git', ['config', 'color.grep', 'always'], root);
  assert.deepEqual(conflictMarkers(root), before);
});

/** 권한으로 읽기를 막을 수 없는 환경(Windows, 관리자 권한 실행)인가 */
const CANNOT_LOCK = process.platform === 'win32' || process.getuid?.() === 0;

/** 표식이 든 추적 파일 하나의 읽기 권한을 없앤 리포. 되돌리는 함수를 함께 준다 */
function lockedRepo(): { root: string; unlock: () => void } {
  const root = repo();
  write(root, 'locked.txt', BLOCK);
  write(root, 'clean.txt', 'a\n');
  commitAll(root);
  const locked = path.join(root, 'locked.txt');
  chmodSync(locked, 0o000);
  return { root, unlock: () => chmodSync(locked, 0o644) };
}

/** 두 실행 모두 종료 코드 1이고 출력에 그 글자가 있다 */
function assertCliFails(root: string, runs: string[][], text: string): void {
  for (const args of runs) {
    const r = cli(args, root);
    const out = r.stdout + r.stderr;
    assert.equal(r.code, 1, `${args.join(' ')}\n${out}`);
    assert.ok(out.includes(text), `${args.join(' ')}\n${out}`);
  }
}

test('conflict-markers: 읽을 수 없는 파일이 있으면 표식 없음이 아니라 검사 실패다', () => {
  if (CANNOT_LOCK) return;
  const { root, unlock } = lockedRepo();
  try {
    const p = conflictMarkers(root);
    assert.equal(p.length, 1);
    assert.equal(p[0].rule, RULE_FAILED);
  } finally {
    unlock();
  }
  const after = conflictMarkers(root);
  assert.equal(after.length, 1);
  assert.equal(after[0].rule, RULE);
});

test('conflict-markers: 읽을 수 없는 추적 파일에서 R4 검사가 작업 트리를 견주는 실행은 그 예외로 끝난다', () => {
  if (CANNOT_LOCK) return;
  const { root, unlock } = lockedRepo();
  try {
    // 비교 기준이 있고 --ci가 아니다: 먼저 도는 R4 검사의 git diff가 그 파일을 읽지 못한다(계획의 수용 기준 3)
    assertCliFails(
      root,
      [['bypass-scan'], ['check', '--only', 'bypass-scan', '--no-cache']],
      'git diff',
    );
  } finally {
    unlock();
  }
});

test('conflict-markers: 읽을 수 없는 추적 파일에서 R4 검사가 작업 트리를 읽지 않는 실행은 검사 실패를 알린다', () => {
  if (CANNOT_LOCK) return;
  // --ci: R4 검사가 커밋끼리 견준다
  const ci = lockedRepo();
  try {
    assertCliFails(
      ci.root,
      [
        ['bypass-scan', '--ci'],
        ['check', '--only', 'bypass-scan', '--ci'],
      ],
      RULE_FAILED,
    );
  } finally {
    ci.unlock();
  }
  // 비교 기준이 없다: 기본 브랜치(main)도 origin/main도 없는 리포
  const noBase = lockedRepo();
  try {
    sh('git', ['branch', '-m', 'work'], noBase.root);
    assertCliFails(
      noBase.root,
      [['bypass-scan'], ['check', '--only', 'bypass-scan', '--no-cache']],
      RULE_FAILED,
    );
  } finally {
    noBase.unlock();
  }
});

test('conflict-markers: 읽을 수 없는 새 폴더가 있으면 명령도 검사 실패를 알린다', () => {
  if (CANNOT_LOCK) return;
  const root = repo();
  write(root, 'clean.txt', 'a\n');
  commitAll(root);
  write(root, 'newdir/f.txt', BLOCK);
  const dir = path.join(root, 'newdir');
  chmodSync(dir, 0o000);
  try {
    const p = conflictMarkers(root);
    assert.equal(p.length, 1);
    assert.equal(p[0].rule, RULE_FAILED);
    for (const args of [['bypass-scan'], ['check', '--only', 'bypass-scan', '--no-cache']]) {
      const r = cli(args, root);
      const out = r.stdout + r.stderr;
      assert.equal(r.code, 1, `${args.join(' ')}\n${out}`);
      assert.ok(out.includes(RULE_FAILED), `${args.join(' ')}\n${out}`);
    }
  } finally {
    chmodSync(dir, 0o755);
  }
  const after = conflictMarkers(root);
  assert.equal(after.length, 1);
  assert.equal(after[0].rule, RULE);
  assert.ok(after[0].what.includes('newdir/f.txt:2'), after[0].what);
});

test('conflict-markers: 검사를 하지 못하면 통과가 아니라 실패 한 건이다', () => {
  const dir = tmp();
  write(dir, 'a.txt', BLOCK);
  const p = conflictMarkers(dir);
  assert.equal(p.length, 1);
  assert.equal(p[0].rule, RULE_FAILED);
  assert.ok(p[0].what.includes('git grep'), p[0].what);
  assert.ok(p[0].how.includes('git status'), p[0].how);
});

test('conflict-markers: bypass-scan 명령과 check의 bypass-scan 단계가 실패하고, 표식을 지우면 통과한다', () => {
  const root = repo();
  write(root, 'src/a.ts', BLOCK);
  commitAll(root);

  const scan = cli(['bypass-scan'], root);
  const scanOut = scan.stdout + scan.stderr;
  assert.equal(scan.code, 1, scanOut);
  assert.ok(scanOut.includes(RULE), scanOut);
  assert.ok(scanOut.includes('src/a.ts'), scanOut);
  assert.ok(scanOut.includes('bypass-scan: 1건'), scanOut);

  const check = cli(['check', '--only', 'bypass-scan', '--no-cache'], root);
  const checkOut = check.stdout + check.stderr;
  assert.equal(check.code, 1, checkOut);
  assert.ok(checkOut.includes('✗ bypass-scan'), checkOut);
  assert.ok(checkOut.includes(RULE), checkOut);

  write(root, 'src/a.ts', 'a\nours\nb\n');
  const scan2 = cli(['bypass-scan'], root);
  assert.equal(scan2.code, 0, scan2.stdout + scan2.stderr);
  assert.ok((scan2.stdout + scan2.stderr).includes('bypass-scan: 통과'));
  const check2 = cli(['check', '--only', 'bypass-scan', '--no-cache'], root);
  assert.equal(check2.code, 0, check2.stdout + check2.stderr);
});

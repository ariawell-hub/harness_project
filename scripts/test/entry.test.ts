// isEntry: 스크립트가 직접 실행됐는지를 실제 경로로 판정한다(Issue #237)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { isEntry } from '../lib/entry.ts';

/**
 * 파일 둘(a.ts, b.ts)이 든 폴더와 그 폴더를 가리키는 링크(Windows는 정션, macOS·Linux는 심볼릭 링크).
 * aUrl은 모듈의 import.meta.url처럼 링크를 푼 실제 경로의 URL이다
 */
function fixture(): { dir: string; link: string; a: string; b: string; aUrl: string } {
  const base = mkdtempSync(path.join(tmpdir(), 'harness-entry-'));
  const dir = path.join(base, 'real');
  const link = path.join(base, 'link');
  mkdirSync(dir);
  const a = path.join(dir, 'a.ts');
  const b = path.join(dir, 'b.ts');
  writeFileSync(a, 'export {};\n');
  writeFileSync(b, 'export {};\n');
  symlinkSync(dir, link, 'junction');
  return { dir, link, a, b, aUrl: pathToFileURL(realpathSync(a)).href };
}

test('isEntry: 같은 파일이면 참이다(절대 경로, 링크를 거친 경로, 현재 폴더 기준 상대 경로)', () => {
  const f = fixture();
  assert.equal(isEntry(f.aUrl, f.a), true, '절대 경로');
  assert.equal(isEntry(f.aUrl, path.join(f.link, 'a.ts')), true, '링크를 거친 경로');
  assert.equal(isEntry(f.aUrl, path.relative(process.cwd(), f.a)), true, '상대 경로');
  // node --test는 테스트 파일마다 프로세스를 띄워 그 파일을 실행한다
  assert.equal(isEntry(import.meta.url, process.argv[1]), true, '실행 중인 파일');
});

test('isEntry: 다른 파일, argv1 없음, 없는 파일이면 거짓이다', () => {
  const f = fixture();
  assert.equal(isEntry(f.aUrl, f.b), false, '다른 파일');
  assert.equal(isEntry(f.aUrl, path.join(f.link, 'b.ts')), false, '링크를 거친 다른 파일');
  assert.equal(isEntry(f.aUrl, undefined), false, 'argv1 없음');
  assert.equal(isEntry(f.aUrl, ''), false, 'argv1 빈 문자열');
  // undefined가 실행 경로(process.argv[1])로 바뀌지 않는다: 실행 중인 파일의 URL로도 거짓
  assert.equal(isEntry(import.meta.url, undefined), false, '실행 중인 파일, argv1 없음');
  assert.equal(isEntry(f.aUrl, path.join(f.dir, 'none.ts')), false, '없는 파일');
  assert.equal(
    isEntry(pathToFileURL(path.join(f.dir, 'none.ts')).href, f.a),
    false,
    '모듈 쪽이 없는 파일',
  );
});

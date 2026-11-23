// pnpm-version.ts 테스트: `pnpm --version`의 출력에서 버전만 읽는다(Issue #233).
//   node --test lab/q10-db/test/pnpm-version.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readPnpmVersion } from '../pnpm-version.ts';

/** CI 러너에서 Corepack이 pnpm을 처음 받을 때 표준 오류에 쓰는 줄(2026-11-23 실행 45177957783의 로그) */
const COREPACK_NOTICE =
  '! Corepack is about to download https://registry.npmjs.org/pnpm/-/pnpm-10.34.5.tgz\n';

test('표준 출력의 버전을 읽는다', () => {
  assert.equal(readPnpmVersion({ stdout: '10.34.5\n', stderr: '' }), '10.34.5');
});

test('표준 오류에 Corepack의 다운로드 안내가 있어도 표준 출력의 버전을 읽는다', () => {
  assert.equal(readPnpmVersion({ stdout: '10.34.5\n', stderr: COREPACK_NOTICE }), '10.34.5');
});

test('표준 오류만 있으면 버전이 없다(빈 글)', () => {
  assert.equal(readPnpmVersion({ stdout: '', stderr: COREPACK_NOTICE }), '');
});

test('Windows의 줄 끝(CRLF)과 앞뒤 공백을 뺀다', () => {
  assert.equal(readPnpmVersion({ stdout: '10.34.5\r\n', stderr: '' }), '10.34.5');
  assert.equal(readPnpmVersion({ stdout: '  10.34.5  \r\n\r\n', stderr: '' }), '10.34.5');
});

test('표준 출력이 여러 줄이면 비어 있지 않은 마지막 줄이다', () => {
  assert.equal(readPnpmVersion({ stdout: 'note\r\n10.34.5\r\n\r\n', stderr: '' }), '10.34.5');
});

test('출력이 없으면(null 포함) 빈 글이다', () => {
  assert.equal(readPnpmVersion({ stdout: '', stderr: '' }), '');
  assert.equal(readPnpmVersion({ stdout: null, stderr: null }), '');
});

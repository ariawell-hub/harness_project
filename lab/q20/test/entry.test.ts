// lab/q20/report.ts를 node로 직접 실행하면 main이 돈다(Windows 경로 포함).
// 진입점 검사가 `file://${argv[1]}` 비교면 Windows에서 항상 거짓이라, 검사 없이 종료 코드 0으로 끝났다.
// deploy.ts·patch-id.ts의 같은 검사는 시험 소스와 함께 지웠다(step6, README의 마지막 커밋 SHA 참고).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

function run(tool: string): { code: number | null; stderr: string } {
  const file = fileURLToPath(new URL(`../${tool}`, import.meta.url));
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  return { code: r.status, stderr: r.stderr };
}

test('report.ts: 인자 없이 실행하면 사용법을 출력하고 종료 코드 2', () => {
  const r = run('report.ts');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /사용법/);
});

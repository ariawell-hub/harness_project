// Q10 확정 상태의 테스트(계획 20261121-q10-confirm step1): 결과 파일이 확정 조건을 채우고,
// 문서들(ADR-0007, ADR 목록, 설계서 18·19절, 기술 부채 TD-14 행, 웹 프로파일 README, 이 폴더의 README)이
// 같은 확정 상태를 말한다. 한 곳만 고치고 다른 곳에 잠정 상태가 남으면 실패한다.
//   node --test lab/q10-db/test/confirmed.test.ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkPlatform,
  checkPnpm,
  checkQ10,
  confirmProblems,
  readRepoPackageManager,
  RESULTS_DIR,
} from '../check-results.ts';
import { readRows, readTable, type Row } from '../verify-artifacts.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** 리포의 글 파일. 줄 끝은 LF로 맞춘다(Windows에서 CRLF로 받아도 같은 판정) */
const read = (rel: string): string =>
  readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const ADR = 'docs/decisions/ADR-0007-db-postgres-drizzle.md';
const LAB_README = 'lab/q10-db/README.md';

/** ADR "알려진 한계"에 글자 그대로 있어야 하는 두 문장(step1 작업 4) */
const WINDOWS_BASIS = 'Windows 네이티브의 확정 근거는 CI의 Windows 러너에서 받은 산출물이다.';
const OWNER_PC =
  '제작자의 Windows PC에서는 2026-11-23에 절차가 통과했으나 결과 파일을 남기지 않아 확정 근거로 쓰지 않는다.';

/** `## <제목>`부터 다음 `## ` 앞(없으면 문서 끝)까지. 그런 절이 없으면 실패한다 */
function section(doc: string, heading: string): string {
  const lines = doc.split('\n');
  const start = lines.findIndex((l) => l === `## ${heading}`);
  assert.ok(start >= 0, `"## ${heading}" 절이 없다`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}

const resultFiles = (): string[] =>
  readdirSync(RESULTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();
const readResult = (f: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(RESULTS_DIR, f), 'utf8')) as Record<string, unknown>;

/**
 * README "잰 머신" 표의 행: 파일 이름(경로를 뺀 것) → 행. 표는 출처 확인(verify-artifacts.ts)과 같은 파서로 읽는다
 * (칸 나누기는 GFM대로 이스케이프된 세로줄을 칸 안의 글자로 두고, 실행 칸 전체가 주소 꼴일 때만 번호를 읽는다)
 */
function measuredRows(): Map<string, Row> {
  return new Map(readRows(read(LAB_README)).map((r) => [r.file, r]));
}

/** 표의 실행 칸에 적힌 실행 번호 전부 */
function runNumbers(): string[] {
  const runs = new Set<string>();
  for (const { run } of measuredRows().values()) if (run !== null) runs.add(String(run));
  return [...runs];
}

test('results/의 결과 파일로 확정 조건(confirmProblems)이 0건이다(세 환경 모두 통과)', () => {
  const pm = readRepoPackageManager();
  const checked = resultFiles().map((f) => {
    const name = f.slice(0, -'.json'.length);
    const result = readResult(f);
    return {
      name,
      bad: [...checkPlatform(result, name), ...checkQ10(result), ...checkPnpm(result, pm)],
    };
  });
  assert.deepEqual(confirmProblems(checked), []);
});

test('linux-*와 win32-* 결과가 하나 이상씩 있고, packages·pnpm이 darwin-arm64.json과 같다', () => {
  const files = resultFiles();
  const darwin = readResult('darwin-arm64.json');
  for (const prefix of ['linux-', 'win32-']) {
    const mine = files.filter((f) => f.startsWith(prefix));
    assert.ok(mine.length >= 1, `${prefix} 결과 파일이 없다`);
    for (const f of mine) {
      const r = readResult(f);
      assert.deepEqual(r.packages, darwin.packages, `${f}의 packages가 darwin-arm64.json과 다르다`);
      assert.equal(r.pnpm, darwin.pnpm, `${f}의 pnpm이 darwin-arm64.json과 다르다`);
    }
  }
});

test('README "잰 머신" 표에 결과 파일마다 행이 있고, linux-*·win32-* 행에는 실행 주소가 있다', () => {
  // 출처 확인이 받는 꼴(포매터가 쓰는 꼴)이어야 한다. 아니면 행을 하나도 읽지 않는다
  assert.deepEqual(readTable(read(LAB_README)).problems, []);
  const rows = measuredRows();
  for (const f of resultFiles()) {
    const row = rows.get(f);
    assert.ok(row, `잰 머신 표에 ${f}의 행이 없다`);
    if (f.startsWith('linux-') || f.startsWith('win32-'))
      assert.ok(
        row.run !== null,
        `${f}의 실행 칸이 실행 주소(https://github.com/<owner>/<repo>/actions/runs/<숫자>)가 아니다: ${row.runCell}`,
      );
  }
});

test('ADR-0007의 상태 줄이 "- 상태: 채택"으로 시작하고 잠정이 없다', () => {
  const status = read(ADR)
    .split('\n')
    .filter((l) => l.startsWith('- 상태:'));
  assert.equal(status.length, 1, '상태 줄이 하나가 아니다');
  assert.ok(status[0].startsWith('- 상태: 채택'), `상태 줄: ${status[0]}`);
  assert.ok(!status[0].includes('잠정'), `상태 줄에 잠정이 있다: ${status[0]}`);
});

test('ADR-0007: 잠정 상태의 말이 없고, 확정 조건·알려진 한계·결과 절이 확정을 말한다', () => {
  const doc = read(ADR);
  for (const word of ['잠정', '아직 재지 않았다', 'TD-14'])
    assert.ok(!doc.includes(word), `ADR에 "${word}"가 남아 있다`);

  const confirm = section(doc, '확정 조건');
  for (const f of resultFiles())
    assert.ok(confirm.includes(f), `"확정 조건" 절에 결과 파일 ${f}가 없다`);
  const runs = runNumbers();
  assert.ok(runs.length >= 1, 'README의 잰 머신 표에 실행 번호가 없다');
  for (const n of runs) assert.ok(confirm.includes(n), `"확정 조건" 절에 실행 ${n}이 없다`);

  const limits = section(doc, '알려진 한계');
  assert.ok(limits.includes(WINDOWS_BASIS), `"알려진 한계"에 "${WINDOWS_BASIS}"가 없다`);
  assert.ok(limits.includes(OWNER_PC), `"알려진 한계"에 "${OWNER_PC}"가 없다`);

  const q10 = section(doc, '결과')
    .split('\n')
    .filter((l) => l.includes('Q10'));
  assert.ok(q10.length >= 1, '"결과" 절에 Q10이 든 줄이 없다');
  for (const l of q10) assert.ok(l.includes('확정'), `"결과" 절의 Q10 줄에 확정이 없다: ${l}`);
});

test('ADR 목록: ADR-0007의 행에 채택이 있고 잠정이 없다', () => {
  const rows = read('docs/decisions/index.md')
    .split('\n')
    .filter((l) => l.startsWith('|') && l.includes('ADR-0007'));
  assert.equal(rows.length, 1, 'ADR 목록에 ADR-0007의 행이 하나가 아니다');
  assert.ok(rows[0].includes('채택'), `ADR-0007의 행에 채택이 없다: ${rows[0]}`);
  assert.ok(!rows[0].includes('잠정'), `ADR-0007의 행에 잠정이 있다: ${rows[0]}`);
});

test('설계서: 18절 Q10 행과 19절 "현재 위치"가 확정을 말한다', () => {
  const lines = read('docs/harness/design.md').split('\n');
  const q10 = lines.filter((l) => l.startsWith('| Q10 '));
  assert.equal(q10.length, 1, '설계서에 "| Q10 "으로 시작하는 행이 하나가 아니다');
  for (const word of ['확정', 'ADR-0007'])
    assert.ok(q10[0].includes(word), `Q10 행에 "${word}"가 없다`);
  for (const word of ['잠정', 'TD-14'])
    assert.ok(!q10[0].includes(word), `Q10 행에 "${word}"가 남아 있다`);

  const now = lines.filter((l) => l.startsWith('- **현재 위치'));
  assert.equal(now.length, 1, '설계서에 "- **현재 위치" 줄이 하나가 아니다');
  for (const word of ['잠정', '실측이 남았다'])
    assert.ok(!now[0].includes(word), `현재 위치 줄에 "${word}"가 남아 있다`);
  if (now[0].includes('Q10'))
    assert.ok(now[0].includes('확정'), '현재 위치 줄이 Q10을 말하는데 확정이 없다');
});

test('기술 부채 표: TD-14 행이 있고 lab/q10-db 항목(ADR-0007)이 빠졌다', () => {
  const rows = read('docs/exec-plans/tech-debt-tracker.md')
    .split('\n')
    .filter((l) => l.startsWith('| TD-14 '));
  assert.equal(rows.length, 1, '"| TD-14 "로 시작하는 행이 하나가 아니다');
  for (const word of ['lab/q10-db', 'ADR-0007'])
    assert.ok(!rows[0].includes(word), `TD-14 행에 "${word}"가 남아 있다`);
});

test('웹 프로파일 README: ADR-0007 링크가 든 문단(DB 절 첫 문단)이 확정을 말한다', () => {
  const db = section(read('profiles/web/README.md'), 'DB');
  const paragraph = db.split('\n\n').find((p) => p.includes('ADR-0007-db-postgres-drizzle.md'));
  assert.ok(paragraph, 'DB 절에 ADR-0007 링크가 든 문단이 없다');
  assert.ok(paragraph.includes('확정'), 'DB 절 첫 문단에 확정이 없다');
  for (const word of ['잠정', 'macOS에서만 쟀다'])
    assert.ok(!paragraph.includes(word), `DB 절 첫 문단에 "${word}"가 남아 있다`);
});

test('lab/q10-db/README.md: 잠정 상태의 말과 TD-14가 없다', () => {
  const doc = read(LAB_README);
  for (const word of ['아직 재지 않았다', 'ADR-0007은 잠정이다', 'TD-14'])
    assert.ok(!doc.includes(word), `README에 "${word}"가 남아 있다`);
});

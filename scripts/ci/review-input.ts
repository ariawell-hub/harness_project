// 검증자 입력 폴더(10.4절). 검증자는 셸이 없고 읽기 범위가 pr/뿐이라, base 스크립트가
// 변경 파일 목록·diff·맥락을 pr/.harness-review/에 써 준다. PR이 넣은 같은 이름의 폴더는 지우고 다시 만든다.
// 여기 적는 값(브랜치 이름, 경로)은 PR에서 온 데이터다. 검증자 프롬프트가 신뢰할 수 없는 데이터로 다룬다.
import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { changedFiles, type Risk } from '../gates/risk-gate.ts';
import { git } from '../lib/git.ts';
import { findPlan, parseBranch, stepFile } from '../lib/plan.ts';

export const REVIEW_DIR = '.harness-review';
export const MAX_DIFF_BYTES = 400_000;
const CHECKLIST = 'scripts/cross-review/checklist.md';

export interface ReviewInputOptions {
  /** PR head 체크아웃(데이터) */
  root: string;
  /** merge-base */
  base: string;
  branch: string;
  risk: Risk;
  reasons: string[];
  maxDiffBytes?: number;
}

/** 상한을 넘는 diff를 줄 경계에서 자르고 표시를 붙인다 */
function capFile(file: string, max: number): boolean {
  const size = statSync(file).size;
  if (size <= max) return false;
  const buf = Buffer.alloc(max);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, max, 0);
  } finally {
    closeSync(fd);
  }
  const cut = buf.lastIndexOf(0x0a);
  const head = buf.subarray(0, cut < 0 ? 0 : cut + 1);
  const note = `\n[diff가 ${size}바이트라 ${head.length}바이트에서 잘렸다. 나머지는 changed.txt의 파일을 직접 읽어라]\n`;
  writeFileSync(file, Buffer.concat([head, Buffer.from(note)]));
  return true;
}

export function writeReviewInput(o: ReviewInputOptions): void {
  const dir = path.join(o.root, REVIEW_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir);

  const files = changedFiles(o.root, o.base);
  writeFileSync(
    path.join(dir, 'changed.txt'),
    files.map((f) => (f.binary ? `${f.path}\t(바이너리)` : f.path)).join('\n') + '\n',
  );

  const diff = path.join(dir, 'diff.patch');
  // 외부 diff 도구·textconv는 쓰지 않는다(PR 트리의 설정으로 실행되는 것을 남기지 않는다)
  git(
    [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      `--output=${diff}`,
      `${o.base}...HEAD`,
    ],
    o.root,
  );
  const truncated = capFile(diff, o.maxDiffBytes ?? MAX_DIFF_BYTES);

  const b = parseBranch(o.branch);
  const ref = b ? findPlan(o.root, b.id) : null;
  const step = ref?.dir && b && b.step !== null ? stepFile(ref, b.step) : null;
  const lines = [
    '# 검증 입력 (base 스크립트가 만든 파일)',
    '',
    `- 계획: ${ref ? ref.file : '찾지 못함'}`,
    `- 이 PR의 step 파일: ${step ?? '없음(소규모 계획이거나 step 브랜치가 아니다)'}`,
    `- 위험도: ${o.risk}`,
    ...(o.reasons.length ? o.reasons.map((r) => `  - ${r}`) : ['  - 해당 경로 규칙 없음']),
    `- 체크리스트: ${CHECKLIST}`,
    `- 바뀐 파일: ${REVIEW_DIR}/changed.txt (${files.length}개)`,
    `- diff: ${REVIEW_DIR}/diff.patch${truncated ? ' (잘렸다. 파일을 직접 읽어라)' : ''}`,
  ];
  writeFileSync(path.join(dir, 'context.md'), lines.join('\n') + '\n');
}

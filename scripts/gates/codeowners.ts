// CODEOWNERS 생성·검사(10.4절 보호 경로, 운영 전환 체크리스트 2).
// 단일 원본은 harness.config.json의 protectedPaths와 github.owner다. `.github/CODEOWNERS`는 손으로 고치지 않고
// `node scripts/harness.ts codeowners --write`로 만든다. 어긋나면 `check`(doc-lint 단계)가 실패한다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import type { Problem } from '../lib/util.ts';

export const CODEOWNERS_FILE = '.github/CODEOWNERS';

const RULE = 'codeowners';
const DOC = 'docs/harness/design.md 10.4절(보호 경로, 운영 전환 체크리스트 2)';
const REGENERATE =
  '`node scripts/harness.ts codeowners --write`로 다시 만든다(손으로 고치지 않는다)';
/** CODEOWNERS 패턴으로 그대로 옮길 수 있는 경로: 글자·숫자·`.`·`_`·`-`와 조각 안의 `*`만 쓴 조각들 */
const SEGMENTS = /^[A-Za-z0-9._*-]+(\/[A-Za-z0-9._*-]+)*$/;
/** GitHub 계정 이름. 다른 글자가 섞이면 CODEOWNERS 줄이 깨진다 */
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/**
 * 보호 경로 glob 하나 → CODEOWNERS 패턴. `X/**`(폴더 전체)는 `/X/`, 그 밖은 앞에 `/`를 붙인다.
 * 옮길 수 없으면(중간의 `**`, `?`, 대괄호, 공백 등) null이다. 두 문법이 같은 파일을 가리키는 꼴만 받는다
 */
export function codeownersPattern(glob: string): string | null {
  const dir = glob.endsWith('/**');
  const body = dir ? glob.slice(0, -3) : glob;
  if (!SEGMENTS.test(body) || body.includes('**')) return null;
  return `/${body}${dir ? '/' : ''}`;
}

/** protectedPaths → CODEOWNERS 본문. 소유자는 @<cfg.github.owner>, 순서는 설정 순서다 */
export function codeownersText(cfg: HarnessConfig): string {
  const lines = [
    '# 생성 파일: `node scripts/harness.ts codeowners --write`. 손으로 고치지 않는다.',
    '# 원본: harness.config.json의 protectedPaths(보호 경로)와 github.owner(제작자 계정). 설계서 10.4절',
  ];
  for (const g of cfg.protectedPaths) {
    const p = codeownersPattern(g);
    // 옮길 수 없는 glob은 쓰지 않는다. codeownersProblems가 문제로 알린다
    if (p) lines.push(`${p} @${cfg.github.owner}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * 파일이 없거나 생성 결과와 다르면 문제를 돌려준다. 옮길 수 없는 glob과 소유자 형식도 본다.
 * missingOk: 파일이 없는 것은 문제로 보지 않는다(구축 단계의 `check`. CODEOWNERS는 운영 단계에 추가한다, 0.2절)
 */
export function codeownersProblems(
  root: string,
  cfg: HarnessConfig,
  o: { missingOk?: boolean } = {},
): Problem[] {
  const out: Problem[] = [];
  const add = (what: string, how: string) => out.push({ rule: RULE, what, how, doc: DOC });
  if (!LOGIN.test(cfg.github.owner))
    add(
      `github.owner(${JSON.stringify(cfg.github.owner)})가 GitHub 계정 이름 형식이 아니다`,
      'harness.config.json의 github.owner에 제작자 계정 이름을 적는다',
    );
  for (const g of cfg.protectedPaths) {
    if (codeownersPattern(g) === null)
      add(
        `보호 경로 ${JSON.stringify(g)}는 CODEOWNERS 패턴으로 옮길 수 없다`,
        'protectedPaths에는 `X/**`(폴더 전체)나 `**`·`?`·대괄호가 없는 경로만 적는다',
      );
  }
  const file = path.join(root, CODEOWNERS_FILE);
  if (!existsSync(file)) {
    if (!o.missingOk) add(`${CODEOWNERS_FILE}가 없다`, REGENERATE);
    return out;
  }
  const actual = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const want = codeownersText(cfg).split('\n');
  const n = Math.max(actual.length, want.length);
  for (let i = 0; i < n; i++) {
    if (actual[i] === want[i]) continue;
    add(`${CODEOWNERS_FILE}가 protectedPaths에서 만든 내용과 다르다(${i + 1}번째 줄)`, REGENERATE);
    break;
  }
  return out;
}

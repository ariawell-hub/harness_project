// revert-check(10.3절): `revert/<SHA>` PR이 main의 그 커밋을 정확히 되돌리는지 본다.
// 통과하면 plan-gate의 계획 요구와 review/* 판정을 대신한다. 조건은 둘이다:
//   (1) PR의 변경이 대상 커밋의 정확한 역적용이다(경로·모드·blob SHA 단위)
//   (2) 대상 커밋의 main `check`가 실패했다(GitHub Actions의 check run. 호출자가 조회해 넘긴다)
// git은 root에서 읽기만 한다. PR 유래 값(브랜치 이름)은 형식을 검사한 뒤에만 쓴다.
import { gitTry } from '../lib/git.ts';

/** 대상 커밋의 main `check` 최신 결론. 조회하지 못했으면 null */
export type TargetCheck = 'failure' | 'success' | 'none' | null;

export interface RevertCheck {
  /** 브랜치가 revert/<40자 소문자 hex>인가 */
  applies: boolean;
  /** 정확한 역적용이고 대상의 main check가 실패했는가 */
  verified: boolean;
  target: string | null;
  state: 'success' | 'failure' | 'error';
  description: string;
  details: string[];
}

const SHA = /^[0-9a-f]{40}$/;
const BRANCH = /^revert\/([0-9a-f]{40})$/;
/** details에 적는 경로 수 상한 */
const PATH_LIMIT = 20;
const DOC = 'docs/harness/design.md 10.3절 revert-check';

export function revertTarget(branch: string): string | null {
  return BRANCH.exec(branch)?.[1] ?? null;
}

/**
 * `git diff --raw -z`의 항목을 경로 → "옛모드 새모드 옛blob 새blob 상태"로 읽는다. 읽지 못하면 null.
 * 줄 단위 diff나 patch-id는 쓰지 않는다(공백·줄 위치를 무시한다)
 */
function rawDiff(root: string, from: string, to: string): Map<string, string> | null {
  const r = gitTry(['diff', '--raw', '--no-renames', '--no-abbrev', '-z', from, to], root);
  if (!r.ok) return null;
  const parts = r.stdout.split('\0');
  const out = new Map<string, string>();
  for (let i = 0; i + 1 < parts.length; i += 2) {
    if (!parts[i].startsWith(':')) return null;
    out.set(parts[i + 1], parts[i].slice(1));
  }
  return out;
}

const listed = (paths: string[]) =>
  paths.slice(0, PATH_LIMIT).join(', ') +
  (paths.length > PATH_LIMIT ? ` 외 ${paths.length - PATH_LIMIT}개` : '');

export function revertCheck(o: {
  root: string;
  /** PR head와 base 브랜치의 merge-base */
  base: string;
  branch: string;
  targetCheck: TargetCheck;
}): RevertCheck {
  const target = revertTarget(o.branch);
  if (!target)
    return {
      applies: false,
      verified: false,
      target: null,
      state: 'success',
      description: 'revert PR 아님',
      details: [],
    };
  if (!SHA.test(o.base)) throw new Error('base가 40자리 소문자 hex가 아니다');

  const problems: string[] = [];
  const short = target.slice(0, 12);
  const firstParent = gitTry(['rev-list', '--first-parent', o.base], o.root);
  const onMain = firstParent.ok && firstParent.stdout.split('\n').includes(target);
  if (!onMain) problems.push(`대상 ${short}이 main의 first-parent 이력에 없다`);
  else {
    const parents = gitTry(['rev-list', '--parents', '-n', '1', target], o.root)
      .stdout.trim()
      .split(' ')
      .slice(1);
    if (parents.length !== 1)
      problems.push(
        parents.length ? `대상 ${short}이 병합 커밋이다` : `대상 ${short}에 부모가 없다`,
      );
    else {
      const want = rawDiff(o.root, target, parents[0]);
      const got = rawDiff(o.root, o.base, 'HEAD');
      if (!want || !got) problems.push('변경 목록을 읽지 못했다(git diff --raw)');
      else if (!want.size) problems.push(`대상 ${short}이 바꾼 파일이 없다`);
      else {
        const extra = [...got.keys()].filter((p) => !want.has(p));
        const missing = [...want.keys()].filter((p) => !got.has(p));
        const differ = [...got.keys()].filter((p) => want.has(p) && want.get(p) !== got.get(p));
        if (extra.length) problems.push(`대상이 바꾸지 않은 파일을 바꿨다: ${listed(extra)}`);
        if (missing.length) problems.push(`대상이 바꾼 파일을 되돌리지 않았다: ${listed(missing)}`);
        if (differ.length)
          problems.push(
            `되돌린 결과가 대상의 부모와 다르다(내용·모드, 또는 대상 뒤에 main이 다시 바꿨다): ${listed(differ)}`,
          );
      }
    }
  }
  if (o.targetCheck === 'success') problems.push(`대상 ${short}의 main check가 성공이다`);
  if (o.targetCheck === 'none')
    problems.push(`대상 ${short}에 끝난 main check 기록이 없다(진행 중·취소 포함)`);

  if (problems.length) {
    const more = problems.length > 1 ? ` 외 ${problems.length - 1}건` : '';
    return {
      applies: true,
      verified: false,
      target,
      state: 'failure',
      description: problems[0].split(':')[0] + more,
      details: [
        ...problems,
        '  고치는 법: revert PR은 `git revert <SHA>`의 결과만 담는다. 다른 변경은 계획이 있는 일반 PR로 올려라',
        `  근거: ${DOC}`,
      ],
    };
  }
  if (o.targetCheck === null)
    return {
      applies: true,
      verified: false,
      target,
      state: 'error',
      description: `대상 ${short}의 main check 결과를 조회하지 못했다`,
      details: [`근거: ${DOC}`],
    };
  return {
    applies: true,
    verified: true,
    target,
    state: 'success',
    description: `revert 확인: ${short}의 정확한 역적용, 대상의 main check 실패`,
    details: [],
  };
}

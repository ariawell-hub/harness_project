// 계획을 링크를 따라가지 않고 읽는다(Issue #194, 설계서 10.4절 "심볼릭 링크").
// PR 트리를 데이터로 읽는 판정 코드(plan-gate, risk-gate의 계획 위험도, 계획 해시, 검증자 계획, 검증 입력)가 쓴다.
// 작업 트리에서 읽는다(커밋하지 않은 계획도 읽는다: 로컬 plan-gate와 runner도 같은 판정을 부른다). 다만 계획 자리의
// 어느 단계든 심볼릭 링크·서브모듈이면 읽지 않고 PlanPathError를 던진다. git 색인도 본다: core.symlinks=false로
// 받은 체크아웃(CI의 PR 트리)에서는 링크가 대상 경로를 담은 일반 파일이라 작업 트리만으로는 알 수 없다.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gitTry } from './git.ts';
import { planCandidates, type PlanRef } from './plan.ts';

/** 계획 자리가 일반 파일·폴더가 아니다(심볼릭 링크·서브모듈·다른 종류). place는 리포 기준 경로 */
export class PlanPathError extends Error {
  readonly place: string;
  constructor(place: string, why: string) {
    super(`계획 자리가 일반 파일·폴더가 아니다(심볼릭 링크·서브모듈): ${place} — ${why}`);
    this.name = 'PlanPathError';
    this.place = place;
  }
}

export interface PlanReader {
  /** findPlan과 같은 후보 순서. 후보의 계획 파일이 있으면 그 후보 */
  find(id: string): PlanRef | null;
  /** 계획 안 파일의 글. 없으면 null */
  read(rel: string): string | null;
  /** 계획 폴더의 이름 목록. 없으면 [] */
  list(rel: string): string[];
}

/**
 * 색인에서 모드가 심볼릭 링크(120000)·서브모듈(160000)인 경로. git 리포가 아니면 null(색인이 없다).
 * 그 밖의 이유로 색인을 읽지 못하면 던진다(fail-closed)
 */
function linkedInIndex(root: string): Set<string> | null {
  const r = gitTry(['ls-files', '-s', '-z'], root);
  if (!r.ok) {
    if (/not a git repository/i.test(r.stderr)) return null;
    throw new Error(`계획 자리를 확인할 git 색인을 읽지 못했다: ${r.stderr.trim().split('\n')[0]}`);
  }
  const out = new Set<string>();
  for (const rec of r.stdout.split('\0')) {
    const m = /^(\d{6}) [0-9a-f]+ \d\t([\s\S]+)$/.exec(rec);
    if (m && (m[1] === '120000' || m[1] === '160000')) out.add(m[2]);
  }
  return out;
}

/** 경로의 단계들: a/b/c → a, a/b, a/b/c */
function places(rel: string): string[] {
  const parts = rel.split('/');
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** 계획을 링크를 따라가지 않고 읽는 객체. 색인은 처음 필요할 때 한 번만 읽는다 */
export function planReader(root: string): PlanReader {
  let index: Set<string> | null | undefined;
  /** 끝 자리가 있으면 true, 없으면 false. 어느 단계든 링크·서브모듈·다른 종류면 던진다 */
  const check = (rel: string, last: 'file' | 'dir'): boolean => {
    const steps = places(rel);
    // 맨 먼저 root 자체: 링크면 git과 그 아래 자리의 lstat이 링크를 따라간다(자리 이름은 '.').
    // git(색인 읽기)을 부르기 전에 본다. 끝의 '/'를 떼어 본다(끝에 '/'가 붙은 경로의 lstat은 링크를 따라간다)
    const top = lstatSync(path.resolve(root));
    if (top.isSymbolicLink()) throw new PlanPathError('.', '리포 폴더 자체가 심볼릭 링크다');
    if (!top.isDirectory()) throw new PlanPathError('.', '리포 폴더가 폴더가 아니다');
    // 그다음 색인: 작업 트리에 그 자리가 없어도(색인에만 링크로 있어도) 거절한다
    if (index === undefined) index = linkedInIndex(root);
    for (const p of steps)
      if (index?.has(p)) throw new PlanPathError(p, '색인에 심볼릭 링크·서브모듈로 있다');
    for (const [i, p] of steps.entries()) {
      let st;
      try {
        st = lstatSync(path.join(root, p));
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return false;
        throw e;
      }
      if (st.isSymbolicLink()) throw new PlanPathError(p, '심볼릭 링크다');
      const want = i === steps.length - 1 ? last : 'dir';
      if (want === 'dir' && !st.isDirectory()) throw new PlanPathError(p, '폴더가 아니다');
      if (want === 'file' && !st.isFile()) throw new PlanPathError(p, '일반 파일이 아니다');
    }
    return true;
  };
  return {
    find: (id) => planCandidates(id).find((ref) => check(ref.file, 'file')) ?? null,
    read: (rel) => (check(rel, 'file') ? readFileSync(path.join(root, rel), 'utf8') : null),
    list: (rel) => {
      const names = check(rel, 'dir') ? readdirSync(path.join(root, rel)) : [];
      // 작업 트리에는 없고 색인에만 링크·서브모듈로 있는 바로 아래 항목의 이름도 넣는다. 목록은 던지지 않는다:
      // 그 이름을 읽는 쪽(read)이 색인으로 거절한다. 작업 트리 목록에 없는 step 링크를 계획 해시가 놓치지 않고,
      // 해시가 읽지 않는 같은 폴더의 링크는 결과를 바꾸지 않는다
      for (const p of index ?? []) {
        const name = p.startsWith(`${rel}/`) ? p.slice(rel.length + 1) : '';
        if (name && !name.includes('/') && !names.includes(name)) names.push(name);
      }
      return names;
    },
  };
}

export function findPlanSafe(root: string, id: string): PlanRef | null {
  return planReader(root).find(id);
}

export function readPlanFile(root: string, rel: string): string | null {
  return planReader(root).read(rel);
}

export function listPlanDir(root: string, rel: string): string[] {
  return planReader(root).list(rel);
}

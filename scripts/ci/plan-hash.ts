// 계획 검증(G1)의 결속 기준(10.3절): 계획 핵심 섹션의 해시와 "계획만 바꾼 PR" 판정.
// 해시에 넣는 것: plan.md의 목표·수용 기준, 범위, 관련 파일 섹션과 계획 폴더의 모든 step<N>.md의 작업·AC·금지사항 섹션.
// 넣지 않는 것: frontmatter, 진행·의사결정 로그, index.json, 폴더 위치(active/·completed/), step의 "읽어야 할 파일".
// 완료 처리로는 해시가 바뀌지 않는다.
// PR 트리는 데이터로만 읽는다(base 스크립트가 실행한다).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { changedFiles } from '../gates/risk-gate.ts';
import { gitTry, showFile } from '../lib/git.ts';
import {
  STEP_BOUND_SECTIONS,
  findPlan,
  findPlanAt,
  parseBranch,
  parseDoc,
  planCandidates,
  section,
} from '../lib/plan.ts';

/** 제목이 이 말로 시작하는 섹션(lib/plan.ts의 section과 같은 규칙) */
const PLAN_SECTIONS = ['목표와 수용 기준', '범위', '관련 파일'] as const;
const STEP_FILE_RE = /^step(0|[1-9]\d*)\.md$/;

interface PlanSource {
  /** 리포 루트 기준 경로의 내용. 없으면 null */
  read: (file: string) => string | null;
  /** 폴더 바로 아래의 파일 이름 */
  list: (dir: string) => string[];
}

/** 줄 끝 공백과 섹션 앞뒤 빈 줄을 뗀다. 줄 안의 글자는 그대로 둔다 */
function normalize(content: string | null): string {
  return (content ?? '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function hashFrom(src: PlanSource, planDir: string): string | null {
  const plan = src.read(`${planDir}/plan.md`);
  if (plan === null) return null;
  const body = parseDoc(plan).body;
  const parts: [string, string][] = PLAN_SECTIONS.map((s) => [
    `plan:${s}`,
    normalize(section(body, s)),
  ]);
  const steps = src
    .list(planDir)
    .map((name) => STEP_FILE_RE.exec(name))
    .filter((m) => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);
  for (const n of steps) {
    const text = parseDoc(src.read(`${planDir}/step${n}.md`) ?? '').body;
    for (const s of STEP_BOUND_SECTIONS) parts.push([`step${n}:${s}`, normalize(section(text, s))]);
  }
  // 이름과 본문의 경계가 섞이지 않게 목록을 JSON으로 만든다
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/** 작업 트리에 있는 계획의 해시(sha256 hex 64자). plan.md가 없으면 예외 */
export function planHash(root: string, planDir: string): string {
  const h = hashFrom(
    {
      read: (f) =>
        existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), 'utf8') : null,
      list: (d) => (existsSync(path.join(root, d)) ? readdirSync(path.join(root, d)) : []),
    },
    planDir,
  );
  if (h === null) throw new Error(`${planDir}/plan.md가 없어 계획 해시를 계산할 수 없다`);
  return h;
}

/** 그 커밋에 있는 계획의 해시. plan.md가 없으면 null */
export function planHashAt(root: string, rev: string, planDir: string): string | null {
  return hashFrom(
    {
      read: (f) => showFile(root, rev, f),
      list: (d) => {
        const r = gitTry(['ls-tree', '--name-only', '-z', rev, `${d}/`], root);
        return r.ok
          ? r.stdout
              .split('\0')
              .filter(Boolean)
              .map((p) => p.slice(p.lastIndexOf('/') + 1))
          : [];
      },
    },
    planDir,
  );
}

export interface PlanHashes {
  /** 지금(작업 트리) 계획의 해시 */
  hash: string;
  /** merge-base에 있는 같은 계획의 해시. 계획이 없었으면 null */
  baseHash: string | null;
}

/** 브랜치의 계획(step 폴더 형식)의 지금 해시와 base의 해시. 계획 폴더가 없으면 null */
export function planHashes(root: string, base: string, branch: string): PlanHashes | null {
  const b = parseBranch(branch);
  const ref = b ? findPlan(root, b.id) : null;
  if (!b || !ref?.dir) return null;
  const hash = planHash(root, ref.dir);
  const baseRef = findPlanAt((f) => showFile(root, base, f), b.id);
  return { hash, baseHash: baseRef?.dir ? planHashAt(root, base, baseRef.dir) : null };
}

export interface PlanMode {
  /** plan: PR이 바꾼 파일이 이 브랜치 계획의 폴더 안뿐이다(코드 변경 없음). 그 밖은 code */
  mode: 'plan' | 'code';
  /** 지금 계획의 해시. 계획 폴더가 없거나 계산하지 못하면 '' */
  hash: string;
}

/**
 * 판정 워크플로의 plan job이 쓴다. 계획 승인(G1)은 mode가 plan인 head의 판정으로만 남긴다(4.1절).
 * 커밋 하나가 아니라 merge-base 대비 PR 전체 변경으로 본다. 판정하지 못하면 code다.
 */
export function planMode(o: { root: string; base: string; branch: string }): PlanMode {
  const b = parseBranch(o.branch);
  const ref = b ? findPlan(o.root, b.id) : null;
  if (!b || !ref?.dir) return { mode: 'code', hash: '' };
  let hash: string;
  try {
    hash = planHash(o.root, ref.dir);
  } catch {
    return { mode: 'code', hash: '' };
  }
  const dirs = planCandidates(b.id).flatMap((c) => (c.dir ? [`${c.dir}/`] : []));
  try {
    const files = changedFiles(o.root, o.base);
    const only = files.length > 0 && files.every((f) => dirs.some((d) => f.path.startsWith(d)));
    return { mode: only ? 'plan' : 'code', hash };
  } catch {
    return { mode: 'code', hash };
  }
}

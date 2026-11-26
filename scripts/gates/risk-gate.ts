// risk-gate (10.1·10.3절, R13·R20). 위험도를 정하고, "높음"이면 제작자 계정의 head 승인을 확인한다.
// 위험도는 올릴 수만 있다(B11): 계획 risk, 경로별 최소 위험도, 보호 경로(stage), 판정할 수 없는 파일 형식, 신호 중 최댓값.
// 설정(cfg)은 main 쪽이다. PR 트리의 설정으로 판정하지 않는다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import { git } from '../lib/git.ts';
import { RISKS, findPlan, parseBranch, parseDoc } from '../lib/plan.ts';
import { globToRegExp, matchesAny } from '../lib/util.ts';

export type Risk = 'low' | 'normal' | 'high';
const ORDER: Record<Risk, number> = { low: 0, normal: 1, high: 2 };
const LABEL: Record<Risk, string> = { low: '낮음', normal: '보통', high: '높음' };

export interface RiskSignal {
  risk: Risk;
  reason: string;
}

export interface ChangedFile {
  path: string;
  binary: boolean;
}

/** merge-base 대비 바뀐 파일(삭제 포함). 바이너리는 numstat이 `-\t-`로 낸다 */
export function changedFiles(root: string, base: string): ChangedFile[] {
  const out = git(['diff', '--numstat', '-z', '--no-renames', `${base}...HEAD`], root);
  const files: ChangedFile[] = [];
  for (const rec of out.split('\0')) {
    const m = /^(\S+)\t(\S+)\t([\s\S]+)$/.exec(rec);
    if (m) files.push({ path: m[3], binary: m[1] === '-' && m[2] === '-' });
  }
  return files;
}

export interface AssessOptions {
  root: string;
  base: string;
  branch: string;
  cfg: HarnessConfig;
  signals: RiskSignal[];
}

function planRisk(root: string, branch: string): Risk | null {
  const b = parseBranch(branch);
  if (!b) return null;
  const ref = findPlan(root, b.id);
  if (!ref) return null;
  const f = path.join(root, ref.file);
  if (!existsSync(f)) return null;
  const risk = parseDoc(readFileSync(f, 'utf8')).frontmatter?.risk;
  return typeof risk === 'string' && (RISKS as readonly string[]).includes(risk)
    ? (risk as Risk)
    : null;
}

export function assessRisk(o: AssessOptions): { risk: Risk; reasons: string[] } {
  const found: RiskSignal[] = [];
  const pr = planRisk(o.root, o.branch);
  if (pr) found.push({ risk: pr, reason: `계획 risk: ${pr}` });
  const protectedRisk: Risk = o.cfg.stage === 'operation' ? 'high' : 'normal';
  for (const f of changedFiles(o.root, o.base)) {
    if (f.binary)
      found.push({ risk: 'high', reason: `판정할 수 없는 파일 형식(바이너리): ${f.path}` });
    for (const r of o.cfg.riskPaths) {
      if (globToRegExp(r.glob).test(f.path))
        found.push({ risk: r.risk, reason: `경로 ${r.glob}: ${f.path}` });
    }
    if (matchesAny(f.path, o.cfg.protectedPaths))
      found.push({ risk: protectedRisk, reason: `보호 경로(${o.cfg.stage}): ${f.path}` });
  }
  found.push(...o.signals);
  const risk = found.reduce<Risk>((m, s) => (ORDER[s.risk] > ORDER[m] ? s.risk : m), 'low');
  // 최댓값을 만든 이유만, 같은 이유는 한 번
  const reasons = [...new Set(found.filter((s) => s.risk === risk).map((s) => s.reason))];
  return { risk, reasons };
}

export interface Review {
  user: string;
  state: string;
  commitId: string;
  submittedAt: string;
}

/** GitHub 리뷰 API 원본(JSON 배열, 또는 `gh api --paginate --slurp`의 배열의 배열). 형식이 다르면 null */
export function parseReviews(raw: string): Review[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const out: Review[] = [];
  for (const x of data.flat(1) as unknown[]) {
    const r = x as {
      user?: { login?: unknown };
      state?: unknown;
      commit_id?: unknown;
      submitted_at?: unknown;
    } | null;
    if (
      !r ||
      typeof r.user?.login !== 'string' ||
      typeof r.state !== 'string' ||
      typeof r.commit_id !== 'string'
    )
      return null;
    out.push({
      user: r.user.login,
      state: r.state,
      commitId: r.commit_id,
      submittedAt: typeof r.submitted_at === 'string' ? r.submitted_at : '',
    });
  }
  return out;
}

const DECISIVE = ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'];

/** 제작자 계정의 마지막 판정 리뷰(승인·변경 요청·철회). 없으면 null */
export function lastOwnerDecision(reviews: Review[], owner: string): Review | null {
  if (!owner) return null;
  const mine = reviews
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.user.toLowerCase() === owner.toLowerCase() && DECISIVE.includes(r.state))
    .sort((a, b) => a.r.submittedAt.localeCompare(b.r.submittedAt) || a.i - b.i);
  return mine.at(-1)?.r ?? null;
}

/** check suite 하나(승인 head 판정용) */
export interface Suite {
  appId: number;
  headBranch: string | null;
  createdAt: string;
}

/** `gates`가 읽어 오는 승인 자료 */
export interface ApprovalData {
  /** PR 커밋 SHA → 그 커밋의 check suite */
  suites: Record<string, Suite[]>;
  /** PR head 강제 push 이벤트 시각들 */
  forcePushedAt: string[];
}

/** 승인 판정에 필요한 자료와 이어받기 판정 */
export interface ApprovalContext extends ApprovalData {
  /** PR head 브랜치 이름 */
  headBranch: string;
  /** GitHub Actions App id(부르는 쪽이 넘긴다. gates/는 ci/를 가져오지 않는다) */
  actionsAppId: number;
  /** H0에서 지금 head로 승인을 이어받을 수 있으면 null, 아니면 그 이유 */
  carry: (h0: string) => string | null;
}

export type OwnerApproval =
  { approved: true; from: 'head' | string } | { approved: false; why: string };

/** 승인 head의 첫 suite가 리뷰 제출에 이만큼(초) 가까우면 승인 head가 모호하다고 본다 */
export const APPROVAL_WINDOW_SECONDS = 60;

/** ISO 시각 → 초. 읽지 못하면 NaN */
const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * 제작자 승인 판정(10.3절 승인 결속, Issue #250). 리뷰의 `commitId`는 쓰지 않는다(GitHub이 새 head로 옮겨 보고한다).
 * 승인 head(H0)는 리뷰 제출 때 PR head였던 커밋이다: 커밋마다 Actions App이 PR head 브랜치에서 만든 check suite의
 * 가장 이른 생성 시각을 보고, 그 시각이 제출보다 엄격히 앞선 커밋 중 가장 늦은 것. suite는 push 뒤에만 생기므로
 * H0는 제출 때의 head이거나 그보다 앞선 커밋이다(앞선 커밋이면 이어받기 조건이 더 엄격해질 뿐이다).
 * 같은 초·시계 차이·승인 직전 push(60초 창)와 H0 뒤의 강제 push는 모호하다고 보고 승인으로 보지 않는다
 */
export function ownerApproval(
  o: { reviews: Review[]; owner: string; headSha: string } & ApprovalContext,
): OwnerApproval {
  const last = lastOwnerDecision(o.reviews, o.owner);
  if (!last || last.state !== 'APPROVED')
    return { approved: false, why: '제작자의 마지막 판정 리뷰가 승인이 아니다' };
  const submitted = seconds(last.submittedAt);
  if (!Number.isFinite(submitted))
    return { approved: false, why: '승인 리뷰의 제출 시각을 읽지 못했다' };
  let h0: string | null = null;
  let h0At = -Infinity;
  let tie = false;
  for (const [sha, list] of Object.entries(o.suites)) {
    const mine = list.filter((x) => x.appId === o.actionsAppId && x.headBranch === o.headBranch);
    if (!mine.length) continue;
    const times = mine.map((x) => seconds(x.createdAt));
    if (times.some((t) => !Number.isFinite(t)))
      return { approved: false, why: `check suite 시각을 읽지 못했다(${sha.slice(0, 12)})` };
    const first = Math.min(...times);
    if (first >= submitted) continue;
    if (first > h0At) {
      h0 = sha;
      h0At = first;
      tie = false;
    } else if (first === h0At) tie = true;
  }
  if (!h0)
    return {
      approved: false,
      why: '승인 head를 정하지 못했다(리뷰 전에 생긴 Actions check suite가 없다)',
    };
  if (tie)
    return {
      approved: false,
      why: '첫 check suite 시각이 같은 커밋이 둘 이상이라 승인 head가 모호하다',
    };
  if (h0At >= submitted - APPROVAL_WINDOW_SECONDS)
    return {
      approved: false,
      why: `승인 직전 ${APPROVAL_WINDOW_SECONDS}초 안에 head가 바뀌어 승인 head가 모호하다`,
    };
  for (const at of o.forcePushedAt) {
    const t = seconds(at);
    if (!Number.isFinite(t) || t >= h0At)
      return {
        approved: false,
        why: '승인 head가 나온 뒤 강제 push가 있어 승인 head를 정할 수 없다',
      };
  }
  if (h0 === o.headSha) return { approved: true, from: 'head' };
  const no = o.carry(h0);
  if (no === null) return { approved: true, from: h0 };
  return { approved: false, why: `승인 head ${h0.slice(0, 12)}에서 이어받을 수 없다: ${no}` };
}

export interface RiskGateResult {
  state: 'success' | 'failure' | 'error';
  description: string;
  details: string[];
  risk: Risk;
}

export function riskGate(
  o: AssessOptions & {
    headSha: string;
    reviews: Review[] | null;
    /** 승인 자료. 승인 리뷰가 있을 때만 쓴다. 읽지 못했으면 null(주지 않은 것도 같다) */
    approval?: ApprovalContext | null;
  },
): RiskGateResult {
  const { risk, reasons } = assessRisk(o);
  const why = reasons[0] ?? '해당 경로 규칙 없음';
  const more = reasons.length > 1 ? ` 외 ${reasons.length - 1}건` : '';
  const details = reasons.map((r) => `위험도 ${LABEL[risk]}: ${r}`);
  if (risk !== 'high')
    return { state: 'success', description: `위험도 ${LABEL[risk]}: ${why}${more}`, details, risk };
  if (o.reviews === null)
    return {
      state: 'error',
      description: '위험도 높음: 리뷰를 조회하지 못해 제작자 승인을 확인할 수 없다',
      details,
      risk,
    };
  const owner = o.cfg.github.owner;
  const need = (reason: string): RiskGateResult => ({
    state: 'failure',
    description: `위험도 높음: 제작자 head 승인 필요 — ${why}${more}`,
    details: [
      ...details,
      `승인 판정: ${reason}`,
      `고치는 법: 제작자(${owner})에게 현재 head(${o.headSha.slice(0, 12)}) 승인을 요청하라. 승인 뒤 main 병합만 더한 갱신은 승인을 이어받고, 그 밖의 커밋이 생기면 다시 승인해야 한다(10.3절)`,
    ],
    risk,
  });
  if (lastOwnerDecision(o.reviews, owner)?.state !== 'APPROVED')
    return need('제작자의 마지막 판정 리뷰가 승인이 아니다');
  if (!o.approval)
    return {
      state: 'error',
      description:
        '위험도 높음: 승인 자료(check suite·강제 push 이력)를 조회하지 못해 제작자 승인을 확인할 수 없다',
      details,
      risk,
    };
  const a = ownerApproval({ ...o.approval, reviews: o.reviews, owner, headSha: o.headSha });
  if (!a.approved) return need(a.why);
  if (a.from === 'head')
    return {
      state: 'success',
      description: `위험도 높음, 제작자 head 승인: ${why}${more}`,
      details,
      risk,
    };
  return {
    state: 'success',
    description: `위험도 높음, 제작자 head 승인 이어받음 ${a.from.slice(0, 12)}: ${why}${more}`,
    details: [
      ...details,
      `승인 판정: 승인 head ${a.from.slice(0, 12)} 뒤로 main 병합만 더했고 PR 내용이 같아 이어받았다`,
    ],
    risk,
  };
}

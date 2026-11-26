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

/** 제작자 계정의 마지막 판정 리뷰가 head SHA에 대한 승인인가(10.3절 승인 결속) */
export function ownerApprovedHead(reviews: Review[], owner: string, headSha: string): boolean {
  if (!owner) return false;
  const mine = reviews
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.user.toLowerCase() === owner.toLowerCase() && DECISIVE.includes(r.state))
    .sort((a, b) => a.r.submittedAt.localeCompare(b.r.submittedAt) || a.i - b.i);
  const last = mine.at(-1)?.r;
  return !!last && last.state === 'APPROVED' && last.commitId === headSha;
}

export interface RiskGateResult {
  state: 'success' | 'failure' | 'error';
  description: string;
  details: string[];
  risk: Risk;
}

export function riskGate(
  o: AssessOptions & { headSha: string; reviews: Review[] | null },
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
  if (ownerApprovedHead(o.reviews, o.cfg.github.owner, o.headSha))
    return {
      state: 'success',
      description: `위험도 높음, 제작자 head 승인: ${why}${more}`,
      details,
      risk,
    };
  return {
    state: 'failure',
    description: `위험도 높음: 제작자 head 승인 필요 — ${why}${more}`,
    details: [
      ...details,
      `고치는 법: 제작자(${o.cfg.github.owner})에게 현재 head(${o.headSha.slice(0, 12)}) 승인을 요청하라. 새 커밋이 생기면 다시 승인해야 한다(10.3절)`,
    ],
    risk,
  };
}

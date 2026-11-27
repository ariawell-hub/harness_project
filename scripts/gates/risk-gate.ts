// risk-gate (10.1·10.3절, R13·R20). 위험도를 정하고, "높음"이면 제작자 계정의 head 승인을 확인한다.
// 위험도는 올릴 수만 있다(B11): 계획 risk, 경로별 최소 위험도, 보호 경로(stage), 판정할 수 없는 파일 형식, 신호 중 최댓값.
// 설정(cfg)은 main 쪽이다. PR 트리의 설정으로 판정하지 않는다.
import { isIsoInstant, type HarnessConfig } from '../lib/config.ts';
import { git } from '../lib/git.ts';
import { RISKS, parseBranch, parseDoc } from '../lib/plan.ts';
import { planReader } from '../lib/plan-read.ts';
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
  // 계획 자리의 링크는 따라가지 않고 던진다(assessRisk가 던져 risk-gate는 error, Issue #194)
  const reader = planReader(root);
  const ref = reader.find(b.id);
  if (!ref) return null;
  const text = reader.read(ref.file);
  if (text === null) return null;
  const risk = parseDoc(text).frontmatter?.risk;
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

/** 제작자 계정의 마지막 판정 리뷰(승인·변경 요청·철회). 없으면 undefined */
export function lastOwnerDecision(reviews: Review[], owner: string): Review | undefined {
  if (!owner) return undefined;
  const mine = reviews
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.user.toLowerCase() === owner.toLowerCase() && DECISIVE.includes(r.state))
    .sort((a, b) => a.r.submittedAt.localeCompare(b.r.submittedAt) || a.i - b.i);
  return mine.at(-1)?.r;
}

/** 제작자 계정의 마지막 판정 리뷰가 head SHA에 대한 승인인가(10.3절 승인 결속) */
export function ownerApprovedHead(reviews: Review[], owner: string, headSha: string): boolean {
  const last = lastOwnerDecision(reviews, owner);
  return !!last && last.state === 'APPROVED' && last.commitId === headSha;
}

/** 규칙 세트의 제작자 절차와 확인 방법(docs/SECURITY.md) */
const DISMISS_DOC = 'docs/SECURITY.md "오래된 승인 철회 규칙 세트 (제작자)"';
/** ISO 시각을 초 단위로(읽지 못하면 null) */
const epochSec = (iso: string): number | null => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : Math.floor(t / 1000);
};

/** 그 PR의 실제 base 브랜치와, 그 브랜치에 오래된 승인 철회 규칙이 켜져 있는가(Issue #250, `readDismissRule`) */
export interface DismissRule {
  base: string;
  on: boolean;
}

export interface RiskGateResult {
  state: 'success' | 'failure' | 'error';
  description: string;
  details: string[];
  risk: Risk;
}

/**
 * 위험도 높음일 때의 순서(Issue #250): 리뷰를 못 읽음 → error, 제작자의 마지막 판정 리뷰가 승인이 아님 → failure,
 * 오래된 승인 철회 규칙을 확인하지 못함(`dismissRule` 없음·null) → error, 규칙이 없음(`on` false) → failure,
 * base가 기본 브랜치가 아님(전환 시각은 기본 브랜치의 것이다) → failure,
 * 전환 시각(`github.dismissStaleSince`)이 없거나 시각이 아님 → failure, 승인이 전환 시각보다 엄격히 뒤(초 단위)가 아님 →
 * failure, 그 밖에는 리뷰의 커밋이 head면 success. GitHub이 새 커밋 push 때 승인을 철회하므로(규칙) 리뷰의 커밋이 head로
 * 옮겨진 것은 main 병합만 더한 갱신이다(step0 실측, lab/approval-binding)
 */
export function riskGate(
  o: AssessOptions & {
    headSha: string;
    reviews: Review[] | null;
    /** 그 PR의 실제 base 브랜치와 그 브랜치의 오래된 승인 철회 규칙. 확인하지 못했으면 null, 읽지 않았으면 undefined */
    dismissRule?: DismissRule | null;
    /** 미리 계산한 위험도(runGates가 규칙을 읽을지 정할 때 계산했다). 없으면 여기서 계산한다 */
    assessed?: { risk: Risk; reasons: string[] };
  },
): RiskGateResult {
  const { risk, reasons } = o.assessed ?? assessRisk(o);
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
  const last = lastOwnerDecision(o.reviews, o.cfg.github.owner);
  if (last?.state === 'APPROVED') {
    if (o.dismissRule === undefined || o.dismissRule === null)
      return {
        state: 'error',
        description:
          '위험도 높음: 오래된 승인 철회 규칙을 확인하지 못해 제작자 승인을 head에 묶을 수 없다',
        details: [
          ...details,
          `복구: 판정 job이 PR(GET pulls/<번호>)과 그 base 브랜치의 규칙(GET rules/branches/<base>)을 읽지 못했다. 일시적인 API 오류면 판정을 다시 돌리고, 계속되면 ${DISMISS_DOC}의 확인 방법으로 규칙과 토큰을 본다`,
        ],
        risk,
      };
    if (!o.dismissRule.on)
      return {
        state: 'failure',
        description: '위험도 높음: 오래된 승인 철회 규칙이 없어 제작자 승인을 head에 묶을 수 없다',
        details: [
          ...details,
          `고치는 법: 제작자가 이 PR의 base 브랜치에 "Dismiss stale pull request approvals when new commits are pushed"를 켠 규칙 세트를 만든다(${DISMISS_DOC}). 봇은 규칙을 바꾸지 않는다(R20)`,
        ],
        risk,
      };
    // 전환 시각은 기본 브랜치에서 잰 것이다. 다른 base에는 그 브랜치에서 규칙을 켠 시각을 모른다(#258 판정 F25)
    if (o.dismissRule.base !== o.cfg.github.defaultBranch)
      return {
        state: 'failure',
        description: `위험도 높음: 기본 브랜치가 아닌 base(${o.dismissRule.base})에는 승인 전환 시각이 없어 제작자 승인을 셀 수 없다`,
        details: [
          ...details,
          `고치는 법: 기본 브랜치(${o.cfg.github.defaultBranch})를 base로 한 PR로 올린다. 다른 브랜치에 규칙 세트를 켜고 그 시각을 설정에 두는 일은 하네스가 아직 다루지 않는다(${DISMISS_DOC})`,
        ],
        risk,
      };
    const since = o.cfg.github.dismissStaleSince;
    if (!isIsoInstant(since))
      return {
        state: 'failure',
        description:
          '위험도 높음: 설정 github.dismissStaleSince(규칙을 켠 시각)가 없어 승인을 셀 수 없다',
        details: [
          ...details,
          `고치는 법: main의 harness.config.json에 github.dismissStaleSince를 규칙 세트를 켠 ISO 시각(봇이 처음 본 시각, 예: 2026-11-26T16:18:41Z)으로 넣는다(${DISMISS_DOC})`,
        ],
        risk,
      };
    const at = epochSec(last.submittedAt);
    const from = epochSec(since);
    if (at === null || from === null || at <= from)
      return {
        state: 'failure',
        description: '위험도 높음: 규칙을 켜기 전의 승인이라 현재 head를 다시 승인해야 한다',
        details: [
          ...details,
          `고치는 법: 제작자(${o.cfg.github.owner})에게 현재 head(${o.headSha.slice(0, 12)})를 다시 승인받는다. 전환 시각 ${since}보다 엄격히 뒤(초 단위)에 제출된 승인만 센다(같은 초의 승인은 규칙을 켜기 직전일 수 있다)`,
        ],
        risk,
      };
    if (last.commitId === o.headSha)
      return {
        state: 'success',
        description: `위험도 높음, 제작자 head 승인: ${why}${more}`,
        details,
        risk,
      };
  }
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

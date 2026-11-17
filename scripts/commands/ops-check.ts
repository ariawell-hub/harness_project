// ops-check (10.4절 운영 전환 체크리스트 1~3): 리포 설정과 봇 토큰을 읽기만으로 확인한다.
// 설정은 제작자가 바꾼다(R20, docs/SECURITY.md). 확인하지 못한 항목은 ok로 내지 않는다:
// 운영 전환 PR이 이 명령의 종료 코드를 근거로 쓴다. 토큰 값은 읽지도 출력하지도 않는다.
import { compareRequiredChecks, toRequiredChecks } from '../ci/protection.ts';
import { GATE_CONTEXTS, LEDGER_CONTEXT, REVIEW_CONTEXTS } from '../ci/results.ts';
import { CODEOWNERS_FILE, codeownersProblems } from '../gates/codeowners.ts';
import type { HarnessConfig } from '../lib/config.ts';
import type { GitHubPort } from '../lib/github.ts';

export interface OpsItem {
  /** 10.4절 체크리스트 번호 */
  n: 1 | 2 | 3;
  state: 'ok' | 'fail' | 'unknown';
  lines: string[];
}

interface Input {
  root: string;
  cfg: HarnessConfig;
  gh: GitHubPort;
}

const TITLES: Record<OpsItem['n'], string> = {
  1: '필수 체크 등록·출처',
  2: 'CODEOWNERS와 코드 오너 리뷰 필수',
  3: '봇 토큰의 workflow 권한 회수',
};
const MARK = { ok: '✓', fail: '✗', unknown: '?' } as const;
/** Actions가 직접 내는 필수 체크. 나머지는 모두 검증 App이 쓴다(0.2절) */
const ACTIONS_CHECK = 'check';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

/** 1번: 10.3절의 필수 체크가 모두 설정에 있고, 등록과 출처가 설정과 같다 */
function requiredChecks({ cfg, gh }: Input): OpsItem {
  const lines: string[] = [];
  let bad = false;
  const fail = (s: string) => {
    bad = true;
    lines.push(`✗ ${s}`);
  };
  for (const c of [ACTIONS_CHECK, ...GATE_CONTEXTS, ...REVIEW_CONTEXTS, LEDGER_CONTEXT]) {
    if (!cfg.ci.requiredChecks.some((x) => x.context === c))
      fail(`${c}: 설정(ci.requiredChecks)에 없다`);
  }
  for (const c of cfg.ci.requiredChecks) {
    if (c.context !== ACTIONS_CHECK && c.source !== 'recorder')
      fail(`${c.context}: 설정의 출처가 검증 App이 아니다(${c.source})`);
  }
  let raw: unknown;
  try {
    raw = gh.branchInfo(cfg.github.defaultBranch);
  } catch (e) {
    lines.push(`? 등록된 필수 체크를 읽지 못했다: ${message(e)}`);
    return { n: 1, state: bad ? 'fail' : 'unknown', lines };
  }
  const r = compareRequiredChecks(toRequiredChecks(raw), cfg.ci);
  lines.push(...r.lines);
  return { n: 1, state: bad || !r.ok ? 'fail' : 'ok', lines };
}

/**
 * 2번: CODEOWNERS 파일이 protectedPaths에서 만든 내용과 같다. 이 항목이 보증하는 것은 파일이다.
 * "코드 오너 리뷰 필수" 설정은 읽을 수 있을 때만 판정한다. 봇 토큰은 보호 규칙을 읽을 권한이 없어,
 * 그 근거는 시험 PR(보호 경로를 바꾼 PR이 제작자 승인 없이 병합되지 않는다)이다
 */
function codeowners({ root, cfg, gh }: Input): OpsItem {
  const lines: string[] = [];
  const problems = codeownersProblems(root, cfg);
  for (const p of problems) lines.push(`✗ ${p.what}. 고치는 법: ${p.how}`);
  if (!problems.length)
    lines.push(`✓ ${CODEOWNERS_FILE}: 보호 경로 ${cfg.protectedPaths.length}개와 같다`);
  let required: boolean | null = null;
  try {
    required = gh.codeOwnerReviewRequired(cfg.github.defaultBranch);
  } catch {
    required = null;
  }
  if (required === true) lines.push('✓ 코드 오너 리뷰 필수가 켜져 있다');
  else if (required === false) lines.push('✗ 코드 오너 리뷰 필수가 꺼져 있다');
  else
    lines.push(
      '? 코드 오너 리뷰 필수 설정은 봇 토큰으로 읽을 수 없다. 설정은 시험 PR(protected-needs-owner, 체크리스트 6)로 확인한다',
    );
  return { n: 2, state: problems.length || required === false ? 'fail' : 'ok', lines };
}

/** 3번: 이 머신의 gh 계정이 봇이고, 그 토큰의 권한 범위에 workflow가 없다 */
function botToken({ cfg, gh }: Input): OpsItem {
  const notes = [
    '· 이 항목은 이 명령을 실행한 머신의 토큰만 본다',
    '· 제작자 확인: revert environment의 시크릿 REVERT_BOT_TOKEN을 같은 새 토큰으로 바꿨다(봇은 읽을 수 없다)',
    '· 제작자 확인: 에이전트가 조작하는 브라우저 프로필에 제작자 GitHub 로그인이 없다(docs/SECURITY.md)',
  ];
  let me: string;
  let scopes: string[] | null;
  try {
    me = gh.me();
    scopes = gh.tokenScopes();
  } catch (e) {
    return {
      n: 3,
      state: 'unknown',
      lines: [`? 토큰의 권한 범위를 읽지 못했다: ${message(e)}`, ...notes],
    };
  }
  const lines: string[] = [];
  let state: OpsItem['state'] = 'ok';
  if (me !== cfg.github.bot) {
    state = 'fail';
    lines.push(`✗ 이 머신의 gh 계정(${me})이 봇 계정(${cfg.github.bot})이 아니다`);
  }
  if (scopes === null) {
    if (state === 'ok') state = 'unknown';
    lines.push(
      '? 응답에 권한 범위 머리말(x-oauth-scopes)이 없다(세분화 토큰). 워크플로 파일 push 거부는 시험 PR로 확인한다',
    );
  } else if (scopes.includes('workflow')) {
    state = 'fail';
    lines.push(`✗ 봇 토큰에 workflow 권한이 있다(범위: ${scopes.join(', ')})`);
  } else lines.push(`✓ 봇 토큰에 workflow 권한이 없다(범위: ${scopes.join(', ') || '없음'})`);
  return { n: 3, state, lines: [...lines, ...notes] };
}

export function opsCheck(o: Input): OpsItem[] {
  return [requiredChecks(o), codeowners(o), botToken(o)];
}

/** 항목마다 `✓`/`✗`/`?`와 제목 한 줄, 그 아래 이유 */
export function formatOps(items: readonly OpsItem[]): string[] {
  return items.flatMap((i) => [
    `${MARK[i.state]} ${i.n}. ${TITLES[i.n]}`,
    ...i.lines.map((l) => `    ${l}`),
  ]);
}

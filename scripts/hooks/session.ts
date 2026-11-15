// 세션 훅 진입점(Issue #78 step3). Claude Code의 SessionStart·Stop 훅이 stdin으로 JSON을 넘긴다.
//   SessionStart(startup): `harness.ts start`를 실행해 결과를 세션 문맥으로 내보낸다(AGENTS.md "세션 시작 절차").
//   Stop                 : 현재 작업자의 열린 PR이 무엇을 기다리는지 사용자에게 알린다(systemMessage).
// 알림용이다. 어떤 오류에도 종료 코드 0으로 끝나고 세션·종료를 막지 않는다(fail-open).
// 금지 훅(guard.ts)의 fail-closed와는 별개다. 출력에 토큰·환경 변수 값을 넣지 않는다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSync } from '../lib/exec.ts';
import { getGitHub, type PullRequest } from '../lib/github.ts';

type Json = Record<string, unknown>;

export interface SessionDeps {
  env: NodeJS.ProcessEnv;
  /** `harness.ts start`의 출력. 실패하면 던진다 */
  runStart: (cwd: string) => string;
  /** 현재 작업자(봇 계정)의 열린 PR */
  listPRs: (cwd: string) => PullRequest[];
}

/** PR 하나가 무엇을 기다리는지, 누가 풀어야 하는지 */
export function describePr(pr: PullRequest): string {
  const head = `- PR #${pr.number}(${pr.head}): `;
  if (pr.mergeState === 'DIRTY')
    return `${head}main과 충돌 — 봇이 origin/main을 병합해 풀어야 한다`;
  if (pr.mergeState === 'BEHIND')
    return `${head}main에 뒤처짐 — 봇이 origin/main을 병합해 갱신해야 한다`;
  if (pr.checks === 'failure') {
    const failing = pr.failingChecks.join(', ');
    if (pr.failingChecks.length === 1 && pr.failingChecks[0] === 'risk-gate') {
      return pr.isDraft
        ? `${head}초안(risk-gate는 승인 대기) — 봇이 끝낸 뒤 pr-ready로 승인을 요청해야 한다`
        : `${head}승인 대기(risk-gate) — 제작자가 현재 head를 승인해야 한다`;
    }
    return `${head}체크 실패(${failing}) — 봇이 원인을 고쳐야 한다`;
  }
  if (pr.checks === 'pending') return `${head}체크 진행 중 — CI를 기다린다`;
  if (pr.isDraft) return `${head}초안 — 봇이 끝낸 뒤 초안을 해제해야 한다`;
  return `${head}병합 대기 — 자동 병합이 켜져 있으면 GitHub이 병합한다`;
}

export function stopMessage(prs: PullRequest[]): string | null {
  if (!prs.length) return null;
  return ['하네스: 열린 내 PR의 대기 상태', ...prs.map(describePr)].join('\n');
}

/** 훅 입력을 받아 stdout에 쓸 문자열을 돌려준다. 내보낼 것이 없으면 빈 문자열 */
export function handle(payload: Json, deps: SessionDeps): string {
  // runner가 띄운 세션(HARNESS_SESSION=1)은 runner가 start·PR을 맡는다
  if (deps.env.HARNESS_SESSION) return '';
  const event = payload.hook_event_name;
  const cwd = deps.env.CLAUDE_PROJECT_DIR ?? (typeof payload.cwd === 'string' ? payload.cwd : '.');
  if (event === 'SessionStart') {
    // 재개·압축·/clear·fork 때는 돌리지 않는다: start는 main을 당기고 worktree를 정리한다
    if (payload.source !== 'startup') return '';
    try {
      return [
        '하네스 세션 시작 절차 결과(훅이 `node scripts/harness.ts start`를 실행했다. 다시 실행하지 않아도 된다):',
        '',
        deps.runStart(cwd).trim(),
      ].join('\n');
    } catch {
      return '하네스: 훅이 세션 시작 절차를 실행하지 못했다. `node scripts/harness.ts start`를 직접 실행하라.';
    }
  }
  if (event === 'Stop') {
    if (payload.stop_hook_active) return '';
    try {
      const msg = stopMessage(deps.listPRs(cwd));
      return msg ? JSON.stringify({ systemMessage: msg }) : '';
    } catch {
      return '';
    }
  }
  return '';
}

const HARNESS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'harness.ts');

const realDeps: SessionDeps = {
  env: process.env,
  runStart: (cwd) => {
    const r = runSync(process.execPath, [HARNESS, 'start'], { cwd, timeoutMs: 100_000 });
    const out = `${r.stdout}\n${r.stderr}`.trim();
    if (r.timedOut || !out) throw new Error('start 실패');
    return out;
  },
  listPRs: (cwd) => getGitHub(cwd).listMyOpenPRs(),
};

function main(): void {
  try {
    const payload = JSON.parse(readFileSync(0, 'utf8') || '{}') as Json;
    const out = handle(payload, realDeps);
    if (out) process.stdout.write(out + '\n');
  } catch {
    // 알림용 훅은 세션을 막지 않는다
  }
  process.exit(0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

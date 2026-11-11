// 실패 기록 (8.3절, 9.2절). `$(git rev-parse --git-dir)/harness/attempts.jsonl`에 남긴다.
// git이 추적하지 않는 위치라 캐시·승인에 영향이 없고, 에이전트가 손으로 고치지 않는다.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { harnessStateDir, type RepoInfo } from './git.ts';

export interface Attempt {
  ts: string;
  plan: string;
  step: number | null;
  /** 실패 키: 검사 이름 또는 지적 ID. 예) check:lint, ac:pnpm test x.spec.ts, session:timeout */
  key: string;
  ok: boolean;
  kind: 'check' | 'ac' | 'session' | 'plan' | 'pr' | 'review';
  /** 환경 장애(사용량 한도·네트워크)는 실패로 세지 않는다 */
  env?: boolean;
  durationMs?: number;
  detail?: string;
}

export function attemptsFile(info: RepoInfo): string {
  return path.join(harnessStateDir(info, 'worktree'), 'attempts.jsonl');
}

export function recordAttempt(info: RepoInfo, a: Omit<Attempt, 'ts'>): void {
  const entry: Attempt = { ts: new Date().toISOString(), ...a };
  if (entry.detail && entry.detail.length > 4000) entry.detail = entry.detail.slice(-4000);
  appendFileSync(attemptsFile(info), JSON.stringify(entry) + '\n');
}

export function readAttempts(info: RepoInfo): Attempt[] {
  const file = attemptsFile(info);
  if (!existsSync(file)) return [];
  const out: Attempt[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as Attempt);
    } catch {
      // 깨진 줄은 무시
    }
  }
  return out;
}

export const RESET_KEY = '__reset__';

/** 제작자 답변(needs-human 해제) 뒤에는 그 계획의 실패 횟수를 새로 센다 */
function effective(list: Attempt[], plan: string): Attempt[] {
  let idx = -1;
  list.forEach((a, i) => {
    if (a.plan === plan && a.key === RESET_KEY) idx = i;
  });
  return list.slice(idx + 1);
}

/** 키별 누적 실패 수. 그 키가 마지막으로 통과한 뒤의 실패만 센다(방법 전환은 초기화하지 않음) */
export function keyFailures(list: Attempt[], plan: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of effective(list, plan)) {
    if (a.plan !== plan || a.env) continue;
    if (a.ok) counts.set(a.key, 0);
    else counts.set(a.key, (counts.get(a.key) ?? 0) + 1);
  }
  for (const [k, v] of counts) if (v === 0) counts.delete(k);
  return counts;
}

export interface StepTotals {
  failedChecks: number;
  sessionMinutes: number;
  sessions: number;
}

/** step 총량(9.2절): 실패한 check 실행 수와 세션 실행 시간 합계(대기 시간 제외) */
export function stepTotals(list: Attempt[], plan: string, step: number | null): StepTotals {
  let failedChecks = 0;
  let ms = 0;
  let sessions = 0;
  for (const a of effective(list, plan)) {
    if (a.plan !== plan || a.step !== step || a.env) continue;
    if (a.kind === 'check' && !a.ok) failedChecks++;
    if (a.kind === 'session') {
      sessions++;
      ms += a.durationMs ?? 0;
    }
  }
  return { failedChecks, sessionMinutes: ms / 60000, sessions };
}

export interface Verdict {
  action: 'continue' | 'switch' | 'stop';
  key?: string;
  count?: number;
  reason?: string;
}

/** 3회/5회 규칙과 총량 상한 판정 */
export function judge(
  list: Attempt[],
  plan: string,
  step: number | null,
  limits: {
    switchAt: number;
    stopAt: number;
    stepFailedCheckLimit: number;
    stepSessionMinutesLimit: number;
  },
): Verdict {
  const counts = keyFailures(list, plan);
  let worstKey: string | undefined;
  let worst = 0;
  for (const [k, v] of counts) {
    if (v > worst) {
      worst = v;
      worstKey = k;
    }
  }
  if (worst >= limits.stopAt) {
    return {
      action: 'stop',
      key: worstKey,
      count: worst,
      reason: `실패 키 ${worstKey} ${worst}회`,
    };
  }
  const t = stepTotals(list, plan, step);
  if (t.failedChecks >= limits.stepFailedCheckLimit) {
    return { action: 'stop', reason: `step 총량 상한: 실패한 check ${t.failedChecks}회` };
  }
  if (t.sessionMinutes >= limits.stepSessionMinutesLimit) {
    return {
      action: 'stop',
      reason: `step 총량 상한: 세션 실행 시간 ${Math.round(t.sessionMinutes)}분`,
    };
  }
  if (worst >= limits.switchAt) return { action: 'switch', key: worstKey, count: worst };
  return { action: 'continue', key: worstKey, count: worst };
}

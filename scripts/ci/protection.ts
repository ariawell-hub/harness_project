// main 필수 상태 체크의 등록과 출처 확인(0.2절, 10.4절 운영 전환 체크리스트 1, TD-2).
// 봇은 보호 설정을 바꿀 수 없다(R20). 여기서는 등록된 내용을 읽어 설정(ci.requiredChecks)과 비교만 한다.
// 체크 요약 API(statusCheckRollup)는 출처를 보지 않으므로 쓰지 않는다(10.3절, Q20).
import type { HarnessConfig } from '../lib/config.ts';

/** GitHub Actions App id. `check`처럼 PR 코드를 실행하는 체크의 출처다 */
export const ACTIONS_APP_ID = 15368;

export interface RegisteredCheck {
  context: string;
  /** 출처 App. null이면 "아무 출처"로 등록된 것이다 */
  appId: number | null;
}

/** `GET repos/{repo}/branches/{branch}` 응답 → 등록된 필수 체크 */
export function toRequiredChecks(raw: unknown): RegisteredCheck[] {
  const checks = (raw as { protection?: { required_status_checks?: { checks?: unknown } } } | null)
    ?.protection?.required_status_checks?.checks;
  if (!Array.isArray(checks)) return [];
  return checks
    .filter((c): c is { context: string; app_id?: unknown } => typeof c?.context === 'string')
    .map((c) => ({ context: c.context, appId: typeof c.app_id === 'number' ? c.app_id : null }));
}

export function compareRequiredChecks(
  actual: RegisteredCheck[],
  ci: Pick<HarnessConfig['ci'], 'requiredChecks' | 'recorderAppId'>,
): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const bad = (s: string) => {
    ok = false;
    lines.push(`✗ ${s}`);
  };
  if (ci.requiredChecks.some((c) => c.source === 'recorder') && !ci.recorderAppId)
    bad('ci.recorderAppId가 없어 검증 App 출처를 확인할 수 없다');
  for (const w of ci.requiredChecks) {
    const a = actual.find((x) => x.context === w.context);
    const expected = w.source === 'actions' ? ACTIONS_APP_ID : ci.recorderAppId;
    if (!a) bad(`${w.context}: 필수 체크로 등록되지 않았다`);
    else if (!expected || a.appId !== expected)
      bad(
        `${w.context}: 출처가 다르다(등록 ${a.appId ?? '아무 출처'}, 기대 ${w.source} ${expected ?? '?'})`,
      );
    else lines.push(`✓ ${w.context}: 출처 ${w.source}(${expected})`);
  }
  for (const a of actual) {
    if (!ci.requiredChecks.some((w) => w.context === a.context))
      bad(`${a.context}: 등록되어 있지만 설정에 없다`);
  }
  return { ok, lines };
}

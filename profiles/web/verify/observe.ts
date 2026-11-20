// verify fixture의 판단 부분(설계서 11.1절): 어떤 요청이 앱 주소 밖인가, 의도한 실패 선언이 어떤 항목에 맞는가,
// 관찰 기록에 무엇을 남기는가. Playwright를 쓰지 않는다: 하네스 리포의 테스트가 이 파일을 직접 불러 확인한다.
// 이 파일은 보호 경로다.

/** 항목 하나에 적는 글자 수와 분류별 항목 수의 한도 */
export const TEXT_MAX = 2000;
export const ITEMS_MAX = 1000;

export type Pattern = string | RegExp;

export interface ConsoleError {
  text: string;
}
export interface FailedRequest {
  url: string;
  reason: string;
  /** 앱 주소 밖으로 가려던 요청이다. 선언으로 뺄 수 없다 */
  blocked: boolean;
}
/** 관찰 기록. 형식은 scripts/verify/judge.ts의 Observation(version 1)이다 */
export interface Observed {
  version: 1;
  consoleErrors: ConsoleError[];
  failedRequests: FailedRequest[];
  allowed: { consoleErrors: number; failedRequests: number };
}

/** 네트워크를 쓰지 않는 스킴. 그 밖의 스킴(file: 등)은 앱 주소 밖으로 본다 */
const NO_NETWORK = new Set(['data:', 'blob:', 'about:']);

/** 요청의 URL이 앱 주소 밖인가: 출처(스킴·호스트·포트)가 앱과 정확히 같아야 안이다 */
export function requestOutside(raw: string, app: URL): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  if (NO_NETWORK.has(url.protocol)) return false;
  return url.origin !== app.origin;
}

/** 웹소켓의 URL이 앱 주소 밖인가: ws://<앱 호스트:포트>만 안이다(wss는 밖이다) */
export function socketOutside(raw: string, app: URL): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return true;
  }
  return !(url.protocol === 'ws:' && url.host === app.host);
}

export const clip = (text: string): string =>
  text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}…` : text;

/** 의도한 실패의 선언으로 받을 수 있는 값인지 확인한다 */
export function checked(pattern: Pattern): Pattern {
  if (pattern instanceof RegExp) return pattern;
  if (typeof pattern !== 'string' || pattern === '')
    throw new Error(
      '의도한 실패의 선언은 비어 있지 않은 문자열이나 정규식이어야 한다(빈 문자열은 모든 항목에 맞는다)',
    );
  return pattern;
}

/** 선언이 이 항목에 맞는가. 문자열은 들어 있으면 맞고, 정규식은 맞으면 맞다 */
export function matches(pattern: Pattern, text: string): boolean {
  if (typeof pattern === 'string') return text.includes(pattern);
  // g·y 플래그는 앞 검사의 위치를 기억한다. 항목마다 같은 플래그의 새 정규식으로 처음 위치부터 본다.
  // 플래그를 떼어 내지 않는다: y는 "그 위치에서 맞아야 한다"는 조건이기도 하다(떼면 선언보다 넓게 맞는다)
  return new RegExp(pattern.source, pattern.flags).test(text);
}

/**
 * 시나리오가 끝났을 때 관찰 기록을 만든다. 두 분류는 따로 뺀다: 콘솔 에러 선언은 콘솔 에러만, 요청 선언은 실패한 요청만.
 * 앱 주소 밖으로 가려던 요청(blocked)은 어느 선언으로도 빼지 않는다.
 * 한도를 넘어 적지 못한 것이 있으면 선언으로 뺄 수 없는 항목으로 남긴다(조용히 통과시키지 않는다)
 */
export function settle(seen: {
  consoleErrors: readonly ConsoleError[];
  failedRequests: readonly FailedRequest[];
  allowConsole: readonly Pattern[];
  allowRequests: readonly Pattern[];
  /** 한도를 넘어 적지 못한 건수 */
  dropped: number;
}): Observed {
  const consoleErrors = seen.consoleErrors.filter(
    (e) => !seen.allowConsole.some((p) => matches(p, e.text)),
  );
  const failedRequests = seen.failedRequests.filter(
    (r) => r.blocked || !seen.allowRequests.some((p) => matches(p, r.url)),
  );
  const allowed = {
    consoleErrors: seen.consoleErrors.length - consoleErrors.length,
    failedRequests: seen.failedRequests.length - failedRequests.length,
  };
  if (seen.dropped)
    consoleErrors.push({
      text: `관찰 기록의 한도(분류별 ${ITEMS_MAX}건)를 넘어 ${seen.dropped}건을 적지 못했다`,
    });
  return { version: 1, consoleErrors, failedRequests, allowed };
}

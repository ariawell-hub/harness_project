// 발산 판정(10.2절 (7)). 순수 함수만 둔다(네트워크·git 호출 없음).
// 대응을 push한 뒤 검증자가 그 head를 판정한 원장으로 "수렴하지 않은 라운드"인지 본다.
// 되돌리기와 실패 기록은 run.ts가 한다(`revertRound`).
import type { Entry, Ledger } from '../ci/ledger.ts';

/** 대응 라운드를 올리기 전의 상태(`review.json`의 `round`에서 온다) */
export interface RoundBefore {
  /** 대응 전 열린 차단 지적(ID, 파일, 줄) */
  open: { id: string; file: string; line: number }[];
  /** 대응 전 원장의 가장 큰 지적 번호 */
  maxId: number;
  /** 대응을 push한 head */
  head: string;
}

const idNumber = (id: string) => Number(id.slice(1));
const isBlocking = (e: Entry) => e.severity === 'P0' || e.severity === 'P1';

/**
 * 대응 뒤의 원장이 발산 신호를 보이는가. 신호가 하나라도 있으면 `diverged`다.
 * - 새 차단 지적 > 해소: "새 차단 지적"은 지금 `open`인 P0·P1 중 대응 뒤에 등록된 것(번호가 `maxId`보다 크다)과
 *   대응 전에는 열려 있지 않았는데 지금 열린 것(다시 열림)이다. "해소"는 대응 전 열린 지적 중 지금 `fixed`·`rejected`·`accepted`(제작자 승인)인 것이다
 * - 회귀: 원장의 `ciFailures`에 대응 head의 실패 기록이 있다
 * - 같은 위치: 새 차단 지적 중 파일과 줄이 대응 전 열린 지적과 같은 것이 있다(위치 없는 지적은 견주지 않는다)
 * `deferred`(동결된 P1, P2·P3)는 세지 않는다. 신호는 차단 지적 기준이다.
 * `signals`는 사람이 읽을 한 줄씩이다. 지적 ID만 적고 검증자 출력(파일 경로·제목)은 넣지 않는다:
 * 실패 기록의 detail(다음 세션 프롬프트의 "직전 실패")과 계획의 진행 로그에 들어간다
 */
export function divergence(
  before: RoundBefore,
  after: Ledger,
): { diverged: boolean; signals: string[] } {
  const wasOpen = new Map(before.open.map((o) => [o.id, o]));
  const fresh = after.findings
    .filter(
      (e) =>
        isBlocking(e) &&
        e.status === 'open' &&
        (idNumber(e.id) > before.maxId || !wasOpen.has(e.id)),
    )
    .sort((a, b) => idNumber(a.id) - idNumber(b.id));
  const resolved = after.findings.filter(
    (e) =>
      wasOpen.has(e.id) &&
      (e.status === 'fixed' || e.status === 'rejected' || e.status === 'accepted'),
  );
  const signals: string[] = [];
  if (fresh.length > resolved.length)
    signals.push(
      `새 차단 지적 ${fresh.length}건(${fresh.map((e) => e.id).join(', ')})이 해소 ${resolved.length}건보다 많다`,
    );
  if (after.ciFailures.some((f) => f.head === before.head))
    signals.push('대응을 올린 head의 check가 실패했다(회귀)');
  const same = fresh.flatMap((e) => {
    if (!e.file) return [];
    const prior = before.open.find((o) => o.file === e.file && o.line === e.line);
    return prior ? [`${e.id}(${prior.id}의 자리)`] : [];
  });
  if (same.length) signals.push(`대응 전 열린 지적과 같은 위치에 새 차단 지적: ${same.join(', ')}`);
  return { diverged: signals.length > 0, signals };
}

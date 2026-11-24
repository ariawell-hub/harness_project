// `pnpm --version`의 출력에서 버전을 읽는다(Issue #233). 아무것도 실행하지 않는다.
// trial.ts는 불러오기만 해도 실측이 돌기 때문에, 테스트는 이 파일만 불러온다.

/**
 * 버전은 표준 출력에서만 읽는다. 표준 오류는 보지 않는다:
 * Corepack은 pnpm을 처음 받을 때 표준 오류에 안내 줄(`! Corepack is about to download …`)을 쓴다(CI 러너).
 * 줄 끝(Windows의 CRLF 포함)과 앞뒤 공백을 빼고, 비어 있지 않은 마지막 줄을 낸다. 없으면 빈 글.
 * 읽은 값이 리포가 고정한 버전과 같은지는 부르는 쪽(trial.ts)이 글자 그대로 견준다.
 */
export function readPnpmVersion(output: { stdout: string | null; stderr: string | null }): string {
  const lines = (output.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '');
  return lines[lines.length - 1] ?? '';
}

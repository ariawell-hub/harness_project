// 스크립트가 직접 실행됐는가(진입 판정, Issue #237).
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * moduleUrl(호출한 파일의 import.meta.url)이 이 프로세스가 실행한 파일(argv1, 호출자가 process.argv[1]을 넘긴다)인가.
 * 두 경로를 실제 경로로 풀어 견준다: 링크를 거친 경로(링크한 폴더, macOS의 /tmp·/var 아래, Windows의 정션)로
 * 실행하면 argv1은 실행한 경로 그대로이고 import.meta.url은 링크를 푼 경로라, 그대로 견주면 거짓이 되어
 * 스크립트가 아무것도 하지 않고 종료 코드 0으로 끝난다. argv1이 없거나(undefined, 빈 문자열) 어느 쪽이든 풀지
 * 못하면 거짓이다. argv1에 기본값을 두지 않는다: 명시적 undefined가 기본값으로 바뀌지 않게 한다.
 * L1 훅(scripts/hooks/guard.ts)은 이 판정을 쓰지 않고 늘 검사한다(설계서 13.1절)
 */
export function isEntry(moduleUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return (
      realpathSync.native(path.resolve(argv1)) === realpathSync.native(fileURLToPath(moduleUrl))
    );
  } catch {
    return false;
  }
}

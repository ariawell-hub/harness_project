// L1 훅 진입 파일. Claude Code·Codex의 PreToolUse 훅이 stdin으로 JSON을 넘긴다(.claude/settings.json, .codex/hooks.json).
// 차단은 종료 코드 2 + stderr 메시지(13.1절 훅 구현 규칙). 0이 아닌 다른 코드는 차단이 아니므로 쓰지 않는다.
// 내부 오류가 나도 종료 코드 2로 막는다(fail-closed): R20은 L1에 기대기 때문이다(13.2절).
//
// 실행 전용이다. 불리면 늘 검사하고, 직접 실행됐는지 판정하지 않는다(Issue #237): 실행 경로와 모듈 경로를 견주던
// 판정은 링크를 거친 경로(링크한 폴더, macOS의 /tmp·/var 아래, Windows의 정션)로 불리면 거짓이 되어 검사 없이
// 종료 코드 0으로 끝났다. 그래서 이 파일은 import하지 않는다(stdin을 읽고 프로세스를 끝낸다). 판정 코드는
// decide.ts에 있고 테스트는 그쪽을 import한다.
// 판정 모듈은 try 안에서 불러온다: 정적 import가 실패하면 Node가 종료 코드 1로 끝나 훅이 막지 못한다.
import { readFileSync } from 'node:fs';

async function main(): Promise<void> {
  let isConfigError: (e: unknown) => boolean = () => false;
  try {
    const { ConfigError } = await import('../lib/config.ts');
    isConfigError = (e) => e instanceof ConfigError;
    const { decide } = await import('./decide.ts');
    const payload = JSON.parse(readFileSync(0, 'utf8') || '{}') as Record<string, unknown>;
    const msg = decide(payload);
    if (msg) {
      process.stderr.write(`하네스 L1 훅이 차단했다.\n${msg}\n`);
      process.exit(2);
    }
    process.exit(0);
  } catch (e) {
    // 메시지를 쓰다가 다시 던져도 종료 코드 2로 끝난다
    try {
      process.stderr.write(failureMessage(e, isConfigError));
    } finally {
      process.exit(2);
    }
  }
}

/**
 * fail-closed 메시지. 어떤 값이 와도 던지지 않는다: 던진 값은 Error가 아닐 수 있고(null, 문자열, 글로 바꾸다
 * 던지는 객체), 설정 오류인지 가리다 던질 수도 있다(설정 모듈의 ConfigError가 클래스가 아닐 때)
 */
function failureMessage(e: unknown, isConfigError: (e: unknown) => boolean): string {
  let config = false;
  let why = '(설명할 수 없는 값)';
  try {
    config = isConfigError(e);
  } catch {
    // 가리지 못하면 내부 오류로 쓴다
  }
  try {
    why = e instanceof Error ? e.message : String(e);
  } catch {
    // 위의 기본 설명을 쓴다
  }
  return config
    ? `하네스 L1 훅이 설정을 읽지 못해 안전을 위해 차단했다(fail-closed): ${why}\n` +
        '고치는 법: 메인 체크아웃의 harness.config.json을 고쳐야 한다(보호 경로). 제작자에게 알려라. 근거: docs/harness/design.md 13.1절\n'
    : `하네스 L1 훅 내부 오류로 안전을 위해 차단했다(fail-closed): ${why}\n` +
        '고치는 법: scripts/hooks/guard.ts·decide.ts를 고치는 별도 계획을 만들어라. 근거: docs/harness/design.md 13.1절\n';
}

await main();

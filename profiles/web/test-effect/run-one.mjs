// 테스트 파일 하나만 Vitest로 실행한다. 웹 프로파일의 testEffect.command가 부른다(profiles/web/README.md).
//
// Vitest CLI의 파일 인자는 경로 부분 문자열 필터라서 `src/a.test.ts`를 넘기면 `src/a.test.tsx`도 돈다.
// test-effect는 종료 코드 하나로 판정하므로 다른 파일의 결과가 섞이면 안 된다. 그래서 CLI 필터를 쓰지 않고
// Node API로 include를 그 파일 하나로 바꿔 실행한다.
//
// 종료 코드: 그 파일의 테스트가 모두 통과하면 0, 하나라도 실패하거나 맞는 테스트 파일이 없으면 0이 아닌 값,
// 인자가 틀리면 2.

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === '') {
  process.stderr.write(
    '사용법: node profiles/web/test-effect/run-one.mjs <테스트 파일의 리포 안 상대 경로>\n',
  );
  process.exit(2);
}

// include는 glob이다. 경로에 든 glob 문자(Next.js의 `[id]`, `(group)` 등)가 글자 그대로 맞게 이스케이프한다
const file = args[0].replace(/\\/g, '/');
const include = [file.replace(/[\\*?[\]{}()!+@|]/g, '\\$&')];

// 인자 검사 뒤에 불러온다. Vitest는 대상 리포의 의존성이다
const { startVitest } = await import('vitest/node');
// 세 번째 인자는 설정 파일의 값을 덮어쓴다. 맞는 파일이 없으면 통과로 두지 않는다
const vitest = await startVitest('test', [], { watch: false, include, passWithNoTests: false });
if (!vitest) process.exitCode = process.exitCode || 1;
await vitest?.close();

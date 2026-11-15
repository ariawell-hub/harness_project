// 작업자 여러 개(4.5절 운영, Q19). 작업자마다 프로세스 하나로 띄운다.
// runner 루프는 동기 git·gh 호출과 프로세스 전역 상태(현재 폴더, 환경 변수)를 쓴다. 프로세스를 나누면 서로 영향이 없고
// lock·로그 구조도 작업자 하나일 때 그대로다. 같은 Issue를 함께 맡지 않는 것은 선점(claim 브랜치 push)이 지킨다(8.3절).
import { spawn } from 'node:child_process';

const PREFIX_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/;

/**
 * 작업자 이름: `<접두어>-<번호>`(번호는 1부터). 이름은 계획의 `owner`, lock 파일 이름, 정지 알림 표식에 쓰인다.
 * 접두어가 이름으로 쓸 수 없는 글자를 담았거나 수가 1 이상의 정수가 아니면 예외다. 이름은 서로 겹치지 않는다
 */
export function workerNames(prefix: string, count: number): string[] {
  if (!PREFIX_RE.test(prefix))
    throw new Error(`작업자 접두어 형식 오류(영문·숫자·_.-, 40자 이내): ${prefix.slice(0, 60)}`);
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`작업자 수는 1 이상의 정수여야 한다: ${String(count)}`);
  return Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);
}

export interface WorkersOptions {
  cwd: string;
  /** 이 CLI의 스크립트 경로(`scripts/harness.ts`) */
  script: string;
  names: readonly string[];
  /** `run` 뒤에 그대로 넘길 인자(`--tool`, `--once`, `--max-iterations`, `--no-wait`) */
  args: readonly string[];
}

/**
 * 이름마다 `node <script> run --worker <이름> …` 자식 프로세스를 띄우고 모두 끝날 때까지 기다린다.
 * - 자식의 출력은 그대로 흘려보낸다. 환경은 부모의 것을 그대로 물려준다(토큰을 따로 만들어 넘기지 않는다, R20)
 * - SIGINT·SIGTERM을 받으면 자식에게 전달한다
 * - 가장 큰 종료 코드로 끝난다. 신호로 죽었거나 띄우지 못한 자식은 1로 센다
 */
export function runWorkers(o: WorkersOptions): Promise<number> {
  const children = o.names.map((name) =>
    spawn(process.execPath, [...process.execArgv, o.script, 'run', '--worker', name, ...o.args], {
      cwd: o.cwd,
      stdio: 'inherit',
    }),
  );
  const forward = (signal: NodeJS.Signals) => {
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill(signal);
  };
  const onInt = () => forward('SIGINT');
  const onTerm = () => forward('SIGTERM');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  return Promise.all(
    children.map(
      (c) =>
        new Promise<number>((resolve) => {
          c.once('error', () => resolve(1));
          c.once('exit', (code) => resolve(code ?? 1));
        }),
    ),
  ).then((codes) => {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    return Math.max(0, ...codes);
  });
}

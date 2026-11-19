// verify의 공개 증거 요약(설계서 11.1절 "증거", 계획 20261119-pilot-prep 수용 기준 8).
// PR에 올릴 수 있는 것은 여기서 만드는 summary.json과 summary.md 둘뿐이다.
// 요약에는 실행 중에 만들어진 문자열을 넣지 않는다(콘솔 문구, URL, 시나리오 제목, 문제 문장, 거부된 요청의 호스트).
// 그런 글자에는 토큰이 찍힐 수 있고 잘라도 남는다. 넣는 것은 정해 둔 낱말, 규칙에 맞는 시나리오 경로, 숫자뿐이다.
// 올리는 쪽은 돌려준 `files`의 두 파일만 쓴다(`evidence/` 폴더를 통째로 올리지 않는다).
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isScenarioPath, type ScenarioVerdict, type Verdict } from './judge.ts';

const UNKNOWN = '(알 수 없음)';
const NO_PATH = '(경로 생략)';
const STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
/** summary.md의 표에 적는 시나리오 수 상한(PR 본문 길이). summary.json에는 모두 적는다 */
const MD_ROWS = 100;

/**
 * 전체 문제의 분류. 문제 문장(`judge.ts`와 `web.ts`가 만든다)의 정해진 앞부분으로 가른다.
 * 문장 자체는 요약에 넣지 않는다: 뒤에 실행 중에 만들어진 글자가 붙는다
 */
const CATEGORIES: [RegExp, string][] = [
  [/^앱 주소 밖으로 가려는 요청/, '앱 주소 밖 요청'],
  [/^실행기의 종료 코드가 0이 아니다/, '실행기 종료 코드 0 아님'],
  [/^보고서의 최상위 errors/, '실행기가 보고한 오류'],
  [/^(보고서가 |보고서에 |보고서의 |보고서 suite의 |spec에 test가 없다)/, '결과 파일 형식 오류'],
  [/^시나리오가 0개다/, '시나리오 없음'],
  [/^(지정하지 않은|지정한) 파일의 시나리오가 결과에/, '시나리오 집합 불일치'],
  [
    /^(실행기가 결과 파일\(report\.json\)을 쓰지 않았다|결과 파일\(report\.json\))/,
    '결과 파일 읽지 못함',
  ],
  [/^dev가 /, 'dev 준비 실패'],
  [/^실행기가 \d+초 안에 끝나지 않아/, '실행기 시간 초과'],
  [/^중단 신호를 받았다/, '중단 신호'],
  [/^띄운 프로세스를 끝내지 못했다/, '정리 실패'],
  [/^(시나리오 경로|시나리오 파일이 없다)/, '시나리오 지정 오류'],
  [/^commands\.dev가 없다/, 'dev 명령 없음'],
  [/^(verify를 끝내지 못했다|진단 파일)/, '내부 오류'],
];
const OTHER = '기타';

function categoryOf(problem: unknown): string {
  if (typeof problem !== 'string') return OTHER;
  for (const [re, label] of CATEGORIES) if (re.test(problem)) return label;
  return OTHER;
}

const count = (n: unknown): number =>
  Number.isInteger(n) && (n as number) >= 0 ? (n as number) : 0;

interface ScenarioSummary {
  file: string;
  line: number;
  status: string;
  ok: boolean;
  observation: boolean;
  consoleErrors: number | null;
  failedRequests: number | null;
  /** 실패한 요청 가운데 앱 주소 밖으로 가려던 것 */
  blockedRequests: number | null;
  /** 시나리오가 의도한 실패로 선언해 뺀 건수 */
  allowedConsoleErrors: number | null;
  allowedFailedRequests: number | null;
}

function summarize(s: ScenarioVerdict): ScenarioSummary {
  const o = s.observation;
  return {
    file: typeof s.file === 'string' && isScenarioPath(s.file) ? s.file : NO_PATH,
    line: count(s.line),
    status: typeof s.status === 'string' && STATUSES.has(s.status) ? s.status : UNKNOWN,
    ok: s.ok === true,
    observation: o !== null,
    consoleErrors: o ? o.consoleErrors.length : null,
    failedRequests: o ? o.failedRequests.length : null,
    blockedRequests: o ? o.failedRequests.filter((r) => r.blocked === true).length : null,
    allowedConsoleErrors: o ? count(o.allowed.consoleErrors) : null,
    allowedFailedRequests: o ? count(o.allowed.failedRequests) : null,
  };
}

const cell = (n: number | null) => (n === null ? '-' : String(n));

function markdown(
  ok: boolean,
  startedAt: string,
  deniedCount: number,
  scenarios: ScenarioSummary[],
  problems: { category: string; count: number }[],
): string {
  const head = [
    `**verify: ${ok ? '통과' : '실패'}**`,
    `실행 시각 ${startedAt}`,
    `시나리오 ${scenarios.length}개`,
    `거부 프록시에 닿은 요청 ${deniedCount}건`,
  ];
  if (problems.length)
    head.push(`전체 문제(분류별): ${problems.map((p) => `${p.category} ${p.count}건`).join(', ')}`);
  const lines = [
    head.join(' · '),
    '',
    // 뺀 콘솔 에러·뺀 요청: 시나리오가 의도한 실패로 선언해 건수에서 뺀 것
    '| 시나리오 | 상태 | 판정 | 콘솔 에러 | 실패한 요청 | 그중 앱 주소 밖 | 뺀 콘솔 에러 | 뺀 요청 | 관찰 기록 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const s of scenarios.slice(0, MD_ROWS)) {
    const where = s.file === NO_PATH ? NO_PATH : `\`${s.file}:${s.line}\``;
    lines.push(
      `| ${where} | ${s.status} | ${s.ok ? '통과' : '실패'} | ${cell(s.consoleErrors)} | ${cell(s.failedRequests)} | ${cell(s.blockedRequests)} | ${cell(s.allowedConsoleErrors)} | ${cell(s.allowedFailedRequests)} | ${s.observation ? '있음' : '없음'} |`,
    );
  }
  if (scenarios.length === 0) lines.push('| (시나리오 없음) | - | - | - | - | - | - | - | - |');
  if (scenarios.length > MD_ROWS)
    lines.push('', `표에는 ${MD_ROWS}개까지만 적었다(전체 ${scenarios.length}개는 summary.json).`);
  return `${lines.join('\n')}\n`;
}

/**
 * `<outDir>/evidence/`를 새로 만들고 summary.json과 summary.md 둘만 쓴다. 다른 파일은 복사하지 않는다.
 * `evidence` 자리에 이미 무언가 있거나(실행기·`dev`가 미리 둔 파일이나 링크) 출력 폴더가 실제 폴더가 아니면
 * 만들지 않고 예외를 낸다: 남이 둔 것을 증거 묶음으로 내놓거나 링크를 따라 다른 곳에 쓰지 않는다.
 * 띄운 프로세스를 모두 끝낸 뒤에 부른다
 */
export function buildEvidence(
  outDir: string,
  verdict: Verdict,
  meta: { startedAt: string; deniedCount: number },
): { dir: string; files: string[] } {
  const st = lstatSync(outDir, { throwIfNoEntry: false });
  if (!st?.isDirectory() || realpathSync(outDir) !== outDir)
    throw new Error('출력 폴더가 실제 폴더가 아니다(심볼릭 링크이거나 없다)');
  const dir = path.join(outDir, 'evidence');
  try {
    mkdirSync(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST')
      throw new Error('evidence 폴더를 만들지 못했다');
    throw new Error(
      'evidence 자리에 이미 무언가 있다(실행 중에 만들어진 것은 증거 묶음에 넣지 않는다)',
    );
  }

  const scenarios = verdict.scenarios.map(summarize);
  const counts = new Map<string, number>();
  for (const p of verdict.problems) {
    const c = categoryOf(p);
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const problems = [...counts].map(([category, n]) => ({ category, count: n }));
  const startedAt =
    typeof meta.startedAt === 'string' && ISO_TIME.test(meta.startedAt) ? meta.startedAt : UNKNOWN;
  const deniedCount = count(meta.deniedCount);
  const ok = verdict.ok === true;
  const summary = {
    version: 1,
    startedAt,
    ok,
    scenarioCount: scenarios.length,
    deniedCount,
    scenarios,
    problems,
  };
  // wx: 새로 만든 폴더라 겹칠 것이 없지만, 있으면 덮어쓰지 않고 실패한다
  writeFileSync(path.join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
    flag: 'wx',
  });
  writeFileSync(
    path.join(dir, 'summary.md'),
    markdown(ok, startedAt, deniedCount, scenarios, problems),
    {
      flag: 'wx',
    },
  );
  return { dir, files: ['summary.json', 'summary.md'] };
}

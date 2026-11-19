// verify 판정(설계서 11.1절). 순수 함수만 둔다(파일·네트워크·프로세스 없음).
// 시나리오 실행기(Playwright)의 JSON 보고서와 종료 코드를 받아 통과 여부를 정한다.
// 판단하지 못하면 실패다(fail closed). 실행기 패키지를 import하지 않는다: 보고서는 형식을 모르는 데이터로 읽는다.
import path from 'node:path';

/** fixture가 시나리오마다 붙이는 관찰 기록 첨부의 이름 */
export const OBSERVATION_NAME = 'harness-verify';

export interface Observation {
  version: 1;
  /** 콘솔의 error 메시지와 잡히지 않은 예외 */
  consoleErrors: { text: string }[];
  /** 실패한 요청, 상태 코드 400 이상인 응답, 앱 주소 밖으로 가려던 요청(blocked) */
  failedRequests: { url: string; reason: string; blocked: boolean }[];
  /** 시나리오가 "의도한 실패"로 선언해 위 목록에서 뺀 건수 */
  allowed: { consoleErrors: number; failedRequests: number };
}

export interface ScenarioVerdict {
  /** 리포 루트 기준 상대 경로(`/` 구분) */
  file: string;
  line: number;
  title: string;
  /** 마지막 결과의 상태(passed, failed, timedOut, skipped, interrupted). 결과가 없으면 빈 문자열 */
  status: string;
  ok: boolean;
  problems: string[];
  observation: Observation | null;
}

export interface Verdict {
  ok: boolean;
  scenarios: ScenarioVerdict[];
  /** 시나리오 하나에 속하지 않는 문제(보고서 형식, 실행기 종료 코드, 시나리오 집합) */
  problems: string[];
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const isCount = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0;

const TEXT_MAX = 300;
/**
 * 보고서에서 읽은 값을 문제 문구에 넣을 글자로 바꾼다. 어떤 값에도 예외를 내지 않고 값을 따라 내려가지 않는다
 * (String()·템플릿 문자열·JSON.stringify를 보고서 값에 쓰지 않는다. 보고서는 PR의 코드가 만든 데이터다)
 */
function text(v: unknown): string {
  if (typeof v === 'string') return v.length > TEXT_MAX ? `${v.slice(0, TEXT_MAX)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null) return 'null';
  if (v === undefined) return '(없음)';
  return Array.isArray(v) ? `배열(길이 ${v.length})` : typeof v === 'object' ? '객체' : typeof v;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/**
 * `verify`에 지정할 수 있는 시나리오 경로인가: `e2e/`로 시작하고 `.spec.ts`로 끝나는 상대 경로이며,
 * 영문자·숫자·`.`·`_`·`-`·`/`만 쓰고, `/`로 나눈 구간이 모두 영문자나 숫자로 시작한다
 * (빈 구간, `.`, `..`, 점이나 `-`로 시작하는 구간은 안 된다).
 * 이 규칙에 맞는 경로는 정규화해도 바뀌지 않으므로 글자 그대로 비교할 수 있고, 옵션이나 정규식으로 읽힐 문자가 없다
 */
export function isScenarioPath(p: string): boolean {
  if (typeof p !== 'string' || !p.startsWith('e2e/') || !p.endsWith('.spec.ts')) return false;
  return p.split('/').every((seg) => SEGMENT.test(seg));
}

/** 관찰 기록의 형식이 맞으면 그대로, 아니면 null */
function parseObservation(v: unknown): Observation | null {
  if (!isObj(v) || v.version !== 1) return null;
  const { consoleErrors, failedRequests, allowed } = v;
  if (!Array.isArray(consoleErrors) || !Array.isArray(failedRequests) || !isObj(allowed))
    return null;
  if (!consoleErrors.every((e) => isObj(e) && typeof e.text === 'string')) return null;
  if (
    !failedRequests.every(
      (r) =>
        isObj(r) &&
        typeof r.url === 'string' &&
        typeof r.reason === 'string' &&
        typeof r.blocked === 'boolean',
    )
  )
    return null;
  if (!isCount(allowed.consoleErrors) || !isCount(allowed.failedRequests)) return null;
  return {
    version: 1,
    consoleErrors: consoleErrors.map((e: Obj) => ({ text: e.text as string })),
    failedRequests: failedRequests.map((r: Obj) => ({
      url: r.url as string,
      reason: r.reason as string,
      blocked: r.blocked as boolean,
    })),
    allowed: {
      consoleErrors: allowed.consoleErrors,
      failedRequests: allowed.failedRequests,
    },
  };
}

/** 마지막 결과의 첨부에서 관찰 기록을 읽는다. 읽지 못하면 이유를 돌려준다 */
function readObservation(result: Obj): { observation: Observation } | { problem: string } {
  const attachments = Array.isArray(result.attachments) ? result.attachments.filter(isObj) : [];
  const found = attachments.filter((a) => a.name === OBSERVATION_NAME);
  if (found.length === 0) return { problem: `관찰 기록 첨부(${OBSERVATION_NAME})가 없다` };
  if (found.length > 1)
    return { problem: `관찰 기록 첨부(${OBSERVATION_NAME})가 ${found.length}개다` };
  const body = found[0].body;
  if (typeof body !== 'string') return { problem: '관찰 기록 첨부에 본문(base64)이 없다' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
  } catch {
    return { problem: '관찰 기록을 JSON으로 읽지 못했다' };
  }
  const observation = parseObservation(parsed);
  return observation ? { observation } : { problem: '관찰 기록의 형식이 맞지 않다(version 1)' };
}

const SHOWN = 5;
function observationProblems(o: Observation): string[] {
  const out: string[] = [];
  if (o.consoleErrors.length) {
    const shown = o.consoleErrors.slice(0, SHOWN).map((e) => text(e.text));
    out.push(`콘솔 에러 ${o.consoleErrors.length}건: ${shown.join(' | ')}`);
  }
  if (o.failedRequests.length) {
    const shown = o.failedRequests
      .slice(0, SHOWN)
      .map((r) => `${r.blocked ? '[앱 주소 밖, 차단] ' : ''}${text(r.url)} (${text(r.reason)})`);
    out.push(`실패한 요청 ${o.failedRequests.length}건: ${shown.join(' | ')}`);
  }
  return out;
}

/** 보고서의 suite를 따라 내려가며 spec을 모은다. 재귀하지 않는다(깊게 중첩된 보고서에서 멈추지 않게) */
const MAX_NODES = 100_000;
function collectSpecs(suites: unknown[]): { specs: Obj[]; problems: string[] } {
  const specs: Obj[] = [];
  const problems: string[] = [];
  const stack: unknown[] = [...suites].reverse();
  let seen = 0;
  while (stack.length) {
    const s = stack.pop();
    if (++seen > MAX_NODES) {
      problems.push(`보고서의 suite가 너무 많다(${MAX_NODES}개 초과)`);
      break;
    }
    if (!isObj(s)) {
      problems.push('보고서의 suite가 객체가 아니다');
      continue;
    }
    // specs·suites는 없어도 되지만 있으면 배열이어야 한다. 아니면 그 아래의 시나리오를 볼 수 없다
    if (Array.isArray(s.specs)) {
      for (const spec of s.specs) {
        if (isObj(spec)) specs.push(spec);
        else problems.push('보고서의 spec이 객체가 아니다');
      }
    } else if (s.specs !== undefined) problems.push('보고서 suite의 specs가 배열이 아니다');
    if (Array.isArray(s.suites))
      for (let k = s.suites.length - 1; k >= 0; k--) stack.push(s.suites[k]);
    else if (s.suites !== undefined) problems.push('보고서 suite의 suites가 배열이 아니다');
  }
  return { specs, problems };
}

/** 보고서의 파일 경로(시나리오 폴더 기준)를 리포 루트 기준 상대 경로로 바꾼다. 루트 밖이면 null */
function repoRelative(rootDir: string, file: string, root: string): string | null {
  const rel = path.relative(root, path.resolve(rootDir, file));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

/**
 * 보고서와 실행기 종료 코드로 판정한다. `o.root`는 리포 루트의 실제 경로다.
 * `o.scenarios`가 있으면 결과의 시나리오 파일 집합이 그것과 글자 그대로 같아야 한다.
 * `problems`에는 콘솔 문구와 URL이 들어간다. 에이전트가 로컬에서 원인을 보는 용도이고 공개 증거에는 쓰지 않는다
 */
export function judge(
  report: unknown,
  runnerCode: number,
  o: { root: string; scenarios?: string[] },
): Verdict {
  const problems: string[] = [];
  const scenarios: ScenarioVerdict[] = [];
  const done = (): Verdict => ({
    ok: problems.length === 0 && scenarios.length > 0 && scenarios.every((s) => s.ok),
    scenarios,
    problems,
  });

  if (runnerCode !== 0) problems.push(`실행기의 종료 코드가 0이 아니다: ${text(runnerCode)}`);
  if (!isObj(report)) {
    problems.push('보고서가 객체가 아니다');
    return done();
  }
  if (!Array.isArray(report.suites)) {
    problems.push('보고서에 suites 배열이 없다');
    return done();
  }
  if (!Array.isArray(report.errors)) problems.push('보고서에 errors 배열이 없다');
  else if (report.errors.length) {
    const first = report.errors[0];
    const message = isObj(first) ? text(first.message) : text(first);
    problems.push(`보고서의 최상위 errors ${report.errors.length}건: ${message}`);
  }
  const rootDir = isObj(report.config) ? report.config.rootDir : undefined;
  const rootDirOk = typeof rootDir === 'string' && path.isAbsolute(rootDir);
  if (!rootDirOk) problems.push('보고서의 config.rootDir이 절대 경로 문자열이 아니다');

  const collected = collectSpecs(report.suites);
  problems.push(...collected.problems);
  for (const spec of collected.specs) {
    const tests = Array.isArray(spec.tests) ? spec.tests : [];
    if (!tests.length) problems.push(`spec에 test가 없다: ${text(spec.title)}`);
    for (const t of tests) {
      const sp: string[] = [];
      let file = '';
      if (typeof spec.file !== 'string') sp.push('시나리오의 파일 경로가 문자열이 아니다');
      else if (rootDirOk) {
        const rel = repoRelative(rootDir, spec.file, o.root);
        if (rel === null) sp.push(`시나리오의 파일이 리포 루트 밖이다: ${text(spec.file)}`);
        else file = rel;
      }
      const project = isObj(t) && typeof t.projectName === 'string' ? t.projectName : '';
      const results = isObj(t) && Array.isArray(t.results) ? t.results : [];
      const last: unknown = results[results.length - 1];
      const status = isObj(last) && typeof last.status === 'string' ? last.status : '';
      if (!isObj(last)) sp.push('실행 결과가 없다');
      else if (status !== 'passed') sp.push(`상태가 passed가 아니다: ${text(last.status)}`);
      let observation: Observation | null = null;
      if (isObj(last)) {
        const read = readObservation(last);
        if ('problem' in read) sp.push(read.problem);
        else {
          observation = read.observation;
          sp.push(...observationProblems(observation));
        }
      }
      scenarios.push({
        file,
        line: typeof spec.line === 'number' && Number.isInteger(spec.line) ? spec.line : 0,
        title: `${text(spec.title)}${project ? ` [${text(project)}]` : ''}`,
        status: text(status),
        ok: sp.length === 0,
        problems: sp,
        observation,
      });
    }
  }
  if (scenarios.length === 0) problems.push('시나리오가 0개다');

  if (o.scenarios) {
    const want = new Set(o.scenarios);
    const got = new Set(scenarios.map((s) => s.file));
    const extra = [...got].filter((f) => !want.has(f));
    const missing = [...want].filter((f) => !got.has(f));
    if (extra.length)
      problems.push(
        `지정하지 않은 파일의 시나리오가 결과에 있다: ${extra.slice(0, SHOWN).map(text).join(', ')}`,
      );
    if (missing.length)
      problems.push(
        `지정한 파일의 시나리오가 결과에 없다: ${missing.slice(0, SHOWN).map(text).join(', ')}`,
      );
  }
  return done();
}

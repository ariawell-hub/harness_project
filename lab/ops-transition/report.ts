// 운영 전환 시험 결과 기록 검사(계획 20261116-ops-security step6, 설계서 10.4절 체크리스트 5).
// 기록이 완결되고(필드, n/a가 아니면 근거 1개 이상) 항목의 필수 사례가 모두 있고 pass일 때만 통과다.
// 필수가 아닌 사례는 fail·partial·n/a여도 기록이 완결되면 통과다.
//
//   node lab/ops-transition/report.ts --item <항목> | --all
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 항목 → 필수 사례 이름. 운영 전환(step7)의 근거가 되는 사례다 */
export const REQUIRED: Record<string, readonly string[]> = {
  selftest: ['ci-check', 'live'],
  flow: ['runner-unattended', 'carry-over', 'no-carry'],
  revert: ['rerun-first', 'revert-pr', 'issue-reopen', 'plan-restore', 'tampered'],
  'guard-selftest': ['protected-pr', 'non-protected-pr'],
  codeowners: ['owner-required', 'auto-merge'],
  'workflow-scope': ['push-rejected'],
  stage: ['operation-pr'],
  td38: [],
};
export const ITEMS: readonly string[] = Object.keys(REQUIRED);
/** 결과 파일이 없어도 되는 항목(있으면 기록은 완결돼야 한다) */
export const OPTIONAL_ITEMS: readonly string[] = ['td38'];

const VERDICTS = ['pass', 'fail', 'partial', 'n/a'];
export const RESULTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** 결과 하나를 검사해 문제 목록을 돌려준다. 빈 배열이면 통과 */
export function validateResult(item: string, data: unknown): string[] {
  const p: string[] = [];
  if (typeof data !== 'object' || data === null) return [`${item}: JSON 객체가 아니다`];
  const d = data as Record<string, unknown>;
  if (d.item !== item) p.push(`${item}: item 값(${String(d.item)})이 파일 이름과 다르다`);
  if (!nonEmpty(d.summary)) p.push(`${item}: summary가 비어 있다`);
  if (!Array.isArray(d.cases) || d.cases.length === 0) {
    p.push(`${item}: cases가 없다`);
    return p;
  }
  const verdictOf = new Map<string, string>();
  d.cases.forEach((c: unknown, i: number) => {
    const at = `${item}.cases[${i}]`;
    if (typeof c !== 'object' || c === null) {
      p.push(`${at}: 객체가 아니다`);
      return;
    }
    const x = c as Record<string, unknown>;
    for (const k of ['name', 'expected', 'observed'])
      if (!nonEmpty(x[k])) p.push(`${at}: ${k}가 비어 있다`);
    if (!VERDICTS.includes(String(x.verdict)))
      p.push(`${at}: verdict는 ${VERDICTS.join('|')} 중 하나여야 한다`);
    const evidence = Array.isArray(x.evidence) ? x.evidence.filter(nonEmpty) : [];
    if (x.verdict !== 'n/a' && evidence.length === 0)
      p.push(`${at}: 근거(evidence)가 없다. n/a가 아니면 실행 URL 등 근거가 1개 이상 필요하다`);
    if (nonEmpty(x.name)) {
      if (verdictOf.has(x.name)) p.push(`${at}: 이름이 같은 사례가 이미 있다(${x.name})`);
      else verdictOf.set(x.name, String(x.verdict));
    }
  });
  for (const name of REQUIRED[item] ?? []) {
    const v = verdictOf.get(name);
    if (v === undefined) p.push(`${item}: 필수 사례 ${name}가 없다`);
    else if (v !== 'pass')
      p.push(
        `${item}: 필수 사례 ${name}의 판정이 pass가 아니다(${v}). 관찰하지 못했으면 step을 끝내지 않는다`,
      );
  }
  return p;
}

/** 결과 파일들을 검사한다 */
export function checkItems(dir: string, items: readonly string[]): string[] {
  const problems: string[] = [];
  for (const item of items) {
    const f = path.join(dir, `${item}.json`);
    if (!existsSync(f)) {
      if (!OPTIONAL_ITEMS.includes(item))
        problems.push(`${item}: 결과 파일이 없다(${path.relative(process.cwd(), f)})`);
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(f, 'utf8'));
    } catch (e) {
      problems.push(`${item}: JSON 파싱 실패: ${(e as Error).message}`);
      continue;
    }
    problems.push(...validateResult(item, data));
  }
  return problems;
}

function main(argv: string[]): number {
  const i = argv.indexOf('--item');
  const items = argv.includes('--all') ? ITEMS : i >= 0 && argv[i + 1] ? [argv[i + 1]] : null;
  if (!items) {
    process.stderr.write('사용법: node lab/ops-transition/report.ts --item <항목> | --all\n');
    return 2;
  }
  const unknown = items.filter((x) => !ITEMS.includes(x));
  if (unknown.length) {
    process.stderr.write(`알 수 없는 항목: ${unknown.join(', ')} (가능: ${ITEMS.join(', ')})\n`);
    return 2;
  }
  const problems = checkItems(RESULTS_DIR, items);
  if (problems.length) {
    process.stderr.write(problems.map((x) => `- ${x}`).join('\n') + '\n');
    return 1;
  }
  process.stdout.write(`report: 통과 (${items.join(', ')})\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exit(main(process.argv.slice(2)));

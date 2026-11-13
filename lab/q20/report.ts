// Q20 결과 기록 검사(계획 20261111-q20-lab). 판정이 실패여도 기록이 완결되면 통과다.
//
//   node lab/q20/report.ts --item <항목> | --all
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ITEMS = [
  'env-ref',
  'patch-id',
  'check-source',
  'judge-claude',
  'judge-codex',
  'codex-auth',
  'merge-queue',
] as const;

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
  });
  return p;
}

/** 결과 파일들을 검사한다 */
export function checkItems(dir: string, items: readonly string[]): string[] {
  const problems: string[] = [];
  for (const item of items) {
    const f = path.join(dir, `${item}.json`);
    if (!existsSync(f)) {
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
    process.stderr.write('사용법: node lab/q20/report.ts --item <항목> | --all\n');
    return 2;
  }
  const unknown = items.filter((x) => !(ITEMS as readonly string[]).includes(x));
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

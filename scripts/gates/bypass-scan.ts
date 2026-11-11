// bypass-scan (R4): 검사를 건너뛰거나 약화시키는 표시의 신규 추가를 찾는다.
// 허용되는 것은 5.2절의 격리 주석(형식은 docs/harness/workflow.md)이 붙은 경우뿐이다.
// 주의: 이 파일 자신이 검사에 걸리지 않도록 패턴·표식 문자열을 나눠서 조립한다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import { git, gitTry } from '../lib/git.ts';
import { formatProblem, today, type Problem } from '../lib/util.ts';

const SK = 'sk' + 'ip';
const ON = 'on' + 'ly';
export const QUARANTINE = 'harness-' + 'quarantine:';
const DOC = 'docs/harness/design.md 5.1절 R4, 5.2절';

/** 코어 기본 패턴(언어 중립에 가깝게). 프로파일이 bypass.extraPatterns로 늘린다 */
export function corePatterns(): { name: string; re: RegExp }[] {
  return [
    {
      name: `테스트 .${SK}/.${ON}`,
      re: new RegExp(`\\b(?:it|test|describe|context|suite|bench)\\.(?:${SK}|${ON}|todo)\\b`),
    },
    { name: '테스트 x/f 접두어', re: /\b(?:xit|xdescribe|xtest|fit|fdescribe)\s*\(/ },
    { name: `테스트 옵션 ${SK}/${ON}`, re: new RegExp(`\\b(?:${SK}|${ON})\\s*:\\s*true\\b`) },
    { name: '린트 비활성 주석', re: new RegExp('eslint' + '-disable') },
    { name: 'TS 검사 끄기', re: new RegExp('@ts-' + '(?:ignore|nocheck)') },
    { name: '포맷 무시', re: new RegExp('prettier' + '-ignore') },
    { name: 'Python 린트·타입 무시', re: new RegExp('#\\s*(?:no' + 'qa|type:\\s*ignore)') },
    { name: `pytest ${SK}`, re: new RegExp(`pytest\\.mark\\.(?:${SK}|xfail)`) },
  ];
}

export interface AddedLine {
  file: string;
  line: number;
  text: string;
}

export function parseAddedLines(diff: string): AddedLine[] {
  const out: AddedLine[] = [];
  let file: string | null = null;
  let n = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4);
      file = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    if (raw.startsWith('--- ')) continue;
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (h) {
      n = Number(h[1]);
      continue;
    }
    if (!file) continue;
    if (raw.startsWith('+')) {
      out.push({ file, line: n, text: raw.slice(1) });
      n++;
    } else if (!raw.startsWith('-') && !raw.startsWith('\\')) n++;
  }
  return out;
}

export function knownTechDebt(root: string): Set<string> {
  const f = path.join(root, 'docs/exec-plans/tech-debt-tracker.md');
  if (!existsSync(f)) return new Set();
  const ids = new Set<string>();
  for (const m of readFileSync(f, 'utf8').matchAll(/^\|\s*(TD-\d+)\s*\|/gm)) ids.add(m[1]);
  return ids;
}

interface Quarantine {
  td: string;
  until: string;
}

export function parseQuarantine(text: string): Quarantine | null {
  const i = text.indexOf(QUARANTINE);
  if (i < 0) return null;
  const m = /(TD-\d+)\s+until=(\d{4}-\d{2}-\d{2})\s+reason="[^"]+"/.exec(text.slice(i));
  return m ? { td: m[1], until: m[2] } : { td: '', until: '' };
}

function validQuarantine(q: Quarantine | null, tds: Set<string>, now: string): string | null {
  if (!q) return '격리 주석이 없다';
  if (!q.td) return '격리 주석 형식이 틀렸다(TD-N until=YYYY-MM-DD reason="...")';
  if (!tds.has(q.td)) return `${q.td}가 tech-debt-tracker.md에 없다`;
  if (q.until < now) return `격리 기한 ${q.until}이 지났다`;
  return null;
}

export interface BypassOptions {
  base: string | null;
  /** CI: base..HEAD 커밋만 본다. 로컬: base 대비 작업 트리 + 새 파일 */
  committedOnly: boolean;
}

export function bypassScan(root: string, cfg: HarnessConfig, opts: BypassOptions): Problem[] {
  const problems: Problem[] = [];
  const skipExt = new Set(cfg.bypass.excludeExtensions ?? ['.md']);
  const patterns = [
    ...corePatterns(),
    ...(cfg.bypass.extraPatterns ?? []).map((p) => ({
      name: `프로파일 패턴 ${p}`,
      re: new RegExp(p),
    })),
  ];
  const tds = knownTechDebt(root);
  const now = today();

  // 1) 새로 추가된 줄
  let added: AddedLine[] = [];
  if (opts.base) {
    const args = opts.committedOnly
      ? ['diff', '-U0', '--no-color', '--no-ext-diff', opts.base, 'HEAD']
      : ['diff', '-U0', '--no-color', '--no-ext-diff', opts.base];
    added = parseAddedLines(git(args, root));
    if (!opts.committedOnly) {
      const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], root)
        .split('\0')
        .filter(Boolean);
      for (const f of untracked) {
        const p = path.join(root, f);
        let text: string;
        try {
          text = readFileSync(p, 'utf8');
        } catch {
          continue;
        }
        if (text.includes('\0')) continue;
        text.split('\n').forEach((t, i) => added.push({ file: f, line: i + 1, text: t }));
      }
    }
  }
  const fileCache = new Map<string, string[]>();
  const linesOf = (f: string) => {
    if (!fileCache.has(f)) {
      try {
        fileCache.set(f, readFileSync(path.join(root, f), 'utf8').split('\n'));
      } catch {
        fileCache.set(f, []);
      }
    }
    return fileCache.get(f)!;
  };
  for (const a of added) {
    if (skipExt.has(path.extname(a.file))) continue;
    for (const p of patterns) {
      if (!p.re.test(a.text)) continue;
      const lines = linesOf(a.file);
      const q = parseQuarantine(a.text) ?? parseQuarantine(lines[a.line - 2] ?? '');
      const why = validQuarantine(q, tds, now);
      if (why) {
        problems.push({
          rule: 'R4 검사 우회',
          what: `${a.file}:${a.line}에 ${p.name}가 새로 추가됐다 (${why}): ${a.text.trim().slice(0, 120)}`,
          how: '검사를 건너뛰지 말고 원인을 고쳐라. flaky 테스트만 tech-debt 등록 후 격리 주석으로 허용된다',
          doc: DOC,
        });
      }
      break;
    }
  }

  // 2) 리포 전체에서 기한이 지났거나 형식이 틀린 격리 주석
  const grep = gitTry(
    ['grep', '-n', '-I', '--untracked', '-F', QUARANTINE, '--', '.', ':(exclude)*.md'],
    root,
  );
  if (grep.ok) {
    for (const line of grep.stdout.split('\n')) {
      const m = /^([^:]+):(\d+):(.*)$/.exec(line);
      if (!m) continue;
      const why = validQuarantine(parseQuarantine(m[3]), tds, now);
      if (why) {
        problems.push({
          rule: 'R4 격리 만료',
          what: `${m[1]}:${m[2]} 격리 주석 문제: ${why}`,
          how: '원인을 고쳐 격리를 풀거나, tech-debt 항목과 기한을 바로잡아라',
          doc: DOC,
        });
      }
    }
  }
  return problems;
}

export function printProblems(list: Problem[]): void {
  for (const p of list) process.stderr.write(formatProblem(p) + '\n');
}

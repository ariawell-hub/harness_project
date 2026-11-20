// doc-lint (R8, 7.1~7.2절): 깨진 링크, 색인 누락, frontmatter 형식, AGENTS.md 줄 수 상한, 오래된 문서 표시.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import { gitTry } from '../lib/git.ts';
import { parseDoc } from '../lib/plan.ts';
import { formatProblem, matchesAny, type Problem } from '../lib/util.ts';

const DOC = 'docs/harness/design.md 7.2절, R8';
const STATUSES = ['draft', 'active', 'stable', 'deprecated'];
const CYCLES = ['on-change', 'quarterly'];
/** frontmatter·색인 검사에서 빼는 폴더(실행 계획은 자체 frontmatter, 8.2절) */
const NO_FRONTMATTER = [
  'docs/exec-plans/**',
  'docs/generated/**',
  'docs/references/**',
  'docs/**/TEMPLATE*.md',
];

export interface DocLintResult {
  errors: Problem[];
  warnings: Problem[];
}

export interface DocLintOptions {
  /**
   * 참이면 `git` 읽기(문서 목록, 커밋 시각)가 실패할 때 빈 결과로 넘기지 않고 예외를 던진다.
   * 결과를 수로 기록하는 쪽(지표 집계)이 쓴다. 기본은 거짓이고 게이트의 동작은 그대로다
   */
  strict?: boolean;
}

function listMarkdown(root: string, strict: boolean): string[] {
  const r = gitTry(
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'],
    root,
  );
  if (!r.ok) {
    if (strict) throw new Error('문서 목록을 읽지 못했다(git ls-files 실패)');
    return [];
  }
  return r.stdout
    .split('\0')
    .filter(Boolean)
    .filter((f) => existsSync(path.join(root, f)));
}

/** 코드 블록과 인라인 코드를 지운 본문 */
function stripCode(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
}

export function extractLinks(text: string): string[] {
  const out: string[] = [];
  const re = /\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
  let m: RegExpExecArray | null;
  const body = stripCode(text.replace(/<!--[\s\S]*?-->/g, ''));
  while ((m = re.exec(body))) out.push(m[1]);
  return out;
}

function isExternal(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#');
}

/** 그 경로들의 마지막 커밋 시각(초). 조회는 성공했지만 커밋 이력이 없으면 0이다 */
function lastCommitTime(root: string, paths: string[], strict: boolean): number {
  const r = gitTry(['log', '-1', '--format=%ct', '--', ...paths], root);
  const text = r.stdout.trim();
  if (strict && (!r.ok || (text !== '' && !/^\d+$/.test(text))))
    throw new Error(`커밋 시각을 읽지 못했다(git log 실패: ${paths.join(', ')})`);
  return r.ok && text ? Number(text) : 0;
}

export function docLint(root: string, cfg: HarnessConfig, o: DocLintOptions = {}): DocLintResult {
  const strict = o.strict === true;
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const exclude = cfg.docLint.exclude ?? [];
  const files = listMarkdown(root, strict).filter((f) => !matchesAny(f, exclude));

  // 1) 깨진 상대 링크
  const linked = new Map<string, Set<string>>(); // 대상 → 링크한 파일들
  for (const file of files) {
    const text = readFileSync(path.join(root, file), 'utf8');
    for (const href of extractLinks(text)) {
      if (isExternal(href)) continue;
      const clean = decodeURIComponent(href.split('#')[0].split('?')[0]);
      if (!clean) continue;
      const target = path.normalize(path.join(path.dirname(file), clean)).replace(/\\/g, '/');
      if (!existsSync(path.join(root, target))) {
        errors.push({
          rule: 'R8 깨진 링크',
          what: `${file}: 링크 대상이 없다 → ${href}`,
          how: '링크 경로를 고치거나, 옮긴 문서를 따라 갱신하라',
          doc: DOC,
        });
        continue;
      }
      const key = statSync(path.join(root, target)).isDirectory()
        ? target.replace(/\/$/, '')
        : target;
      if (!linked.has(key)) linked.set(key, new Set());
      linked.get(key)!.add(file);
    }
  }

  // 2) 색인 누락: docs/ 아래 문서는 docs/index.md 또는 같은 폴더의 index.md가 링크해야 한다
  const docsFiles = files.filter(
    (f) => f.startsWith('docs/') && f !== 'docs/index.md' && !matchesAny(f, NO_FRONTMATTER),
  );
  for (const f of docsFiles) {
    const from = linked.get(f) ?? new Set();
    const localIndex = `${path.posix.dirname(f)}/index.md`;
    const ok = from.has('docs/index.md') || (f !== localIndex && from.has(localIndex));
    if (!ok) {
      errors.push({
        rule: 'R8 색인 누락',
        what: `${f}가 docs/index.md에도 ${localIndex}에도 링크되어 있지 않다`,
        how: 'docs/index.md(또는 그 폴더의 index.md)에 한 줄 설명과 링크를 추가하라',
        doc: DOC,
      });
    }
  }

  // 3) frontmatter 형식과 오래된 문서 표시
  for (const f of docsFiles) {
    const doc = parseDoc(readFileSync(path.join(root, f), 'utf8'));
    const fm = doc.frontmatter;
    const where = `${f}: frontmatter`;
    if (!fm) {
      errors.push({
        rule: 'R8 frontmatter',
        what: `${where}가 없다`,
        how: '문서 맨 위에 status / related_code / review_cycle을 적어라',
        doc: DOC,
      });
      continue;
    }
    if (!STATUSES.includes(String(fm.status)))
      errors.push({
        rule: 'R8 frontmatter',
        what: `${where} status가 ${STATUSES.join('|')}가 아니다`,
        how: 'status 값을 고쳐라',
        doc: DOC,
      });
    if (!Array.isArray(fm.related_code))
      errors.push({
        rule: 'R8 frontmatter',
        what: `${where} related_code가 배열이 아니다`,
        how: 'related_code: [src/x/] 형식으로 적어라(없으면 [])',
        doc: DOC,
      });
    if (!CYCLES.includes(String(fm.review_cycle)))
      errors.push({
        rule: 'R8 frontmatter',
        what: `${where} review_cycle이 ${CYCLES.join('|')}가 아니다`,
        how: 'review_cycle 값을 고쳐라',
        doc: DOC,
      });
    if (
      fm.review_cycle === 'on-change' &&
      Array.isArray(fm.related_code) &&
      fm.related_code.length
    ) {
      const codeT = lastCommitTime(root, fm.related_code, strict);
      const docT = lastCommitTime(root, [f], strict);
      if (codeT && docT && codeT > docT) {
        warnings.push({
          rule: 'R8 검토 필요',
          what: `${f}: related_code(${fm.related_code.join(', ')})가 문서보다 나중에 바뀌었다`,
          how: '문서를 코드에 맞게 갱신하거나, 갱신이 필요 없는 이유를 PR에 적어라',
          doc: DOC,
        });
      }
    }
  }

  // 4) AGENTS.md 줄 수 상한
  const agents = path.join(root, 'AGENTS.md');
  if (!existsSync(agents)) {
    errors.push({
      rule: 'R8 AGENTS.md',
      what: 'AGENTS.md가 없다',
      how: '지도 문서 AGENTS.md를 만들어라',
      doc: 'docs/harness/design.md 7.1절',
    });
  } else {
    const lines = readFileSync(agents, 'utf8').trimEnd().split('\n').length;
    const max = cfg.docLint.agentsMdMaxLines;
    if (lines > max) {
      errors.push({
        rule: 'R8 AGENTS.md',
        what: `AGENTS.md가 ${lines}줄로 상한 ${max}줄을 넘는다`,
        how: '세부 내용을 docs/로 옮기고 링크만 남겨라(B2: 지도를 준다)',
        doc: 'docs/harness/design.md 7.1절',
      });
    }
  }
  return { errors, warnings };
}

export function printDocLint(r: DocLintResult): void {
  for (const w of r.warnings) process.stderr.write('경고 ' + formatProblem(w) + '\n');
  for (const e of r.errors) process.stderr.write(formatProblem(e) + '\n');
}

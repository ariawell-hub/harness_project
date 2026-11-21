// doc-lint (R8, 7.1~7.2절): 깨진 링크, 색인 누락, frontmatter 형식, AGENTS.md 줄 수 상한, 오래된 문서 표시,
// 설계서 머리말과 변경 이력의 어긋남.
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

/** 문서 목록이나 커밋 시각을 `git`으로 읽지 못했다 */
export class DocLintReadError extends Error {}

export interface DocLintOptions {
  /** 참이면 커밋 시각을 읽지 않는다(커밋이 없는 리포). "검토 필요" 경고는 나오지 않는다 */
  noHistory?: boolean;
}

function listMarkdown(root: string): string[] {
  const r = gitTry(
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'],
    root,
  );
  if (!r.ok) throw new DocLintReadError('문서 목록을 읽지 못했다(git ls-files 실패)');
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
function lastCommitTime(root: string, paths: string[]): number {
  const r = gitTry(['log', '-1', '--format=%ct', '--', ...paths], root);
  const text = r.stdout.trim();
  if (!r.ok || (text !== '' && !/^\d+$/.test(text)))
    throw new DocLintReadError(`커밋 시각을 읽지 못했다(git log 실패: ${paths.join(', ')})`);
  return text ? Number(text) : 0;
}

/** 설계서의 경로. 문서 목록에 있을 때만 머리말과 변경 이력을 견준다 */
const DESIGN_DOC = 'docs/harness/design.md';
const VERSION = String.raw`\d+(?:\.\d+)*`;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
/** `> 버전 v<버전> · … 최종 갱신: <날짜>`. 줄은 이미 LF로 나눴으므로 가운데의 `.`은 모든 글자다(`s`) */
const DESIGN_HEAD = new RegExp(`^> 버전 v(${VERSION}) · .*최종 갱신: (${DATE})\\s*$`, 's');
/** 변경 이력의 항목: 공백 둘, 붙임표, `v<버전> (<날짜>): ` */
const DESIGN_ITEM = new RegExp(`^  - v(${VERSION}) \\((${DATE})\\): `);

/** 버전을 마디마다 수로 견준다. 앞 마디가 모두 같으면 마디가 더 많은 쪽이 크다 */
function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(BigInt);
  const y = b.split('.').map(BigInt);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  }
  return x.length - y.length;
}

/** 설계서 본문에서 머리말의 버전·최종 갱신과 변경 이력이 맞는지 본다. 문제가 없으면 빈 배열 */
export function designVersionProblems(text: string): Problem[] {
  const problem = (what: string): Problem => ({
    rule: 'R8 설계서 버전',
    what,
    how: '머리말의 버전·최종 갱신을 변경 이력의 마지막 항목과 맞춰라. main을 병합하다 버전이 겹쳤으면 이 PR의 항목을 다음 번호로 올려라',
    doc: DOC,
  });
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));

  // 읽지 못하면 비교하지 않는다. 형식이 바뀌어 검사가 조용히 꺼지는 일을 막는다
  const unreadable: Problem[] = [];
  const headLine = lines.find((l) => l.startsWith('> 버전 v'));
  const head = headLine === undefined ? null : DESIGN_HEAD.exec(headLine);
  if (headLine === undefined) {
    unreadable.push(problem('설계서에 머리말 줄(`> 버전 v…`)이 없다'));
  } else if (!head) {
    unreadable.push(
      problem('설계서 머리말 줄의 형식이 틀리다(`> 버전 v<버전> · … 최종 갱신: <YYYY-MM-DD>`)'),
    );
  }

  const items: { line: number; version: string; date: string }[] = [];
  const start = lines.findIndex((l) => l.startsWith('- **변경 이력**'));
  if (start < 0) {
    unreadable.push(problem('설계서에 변경 이력 목록(`- **변경 이력**`)이 없다'));
  } else {
    let count = 0;
    for (let i = start + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() === '') continue; // 빈 줄은 목록을 끝내지 않는다
      if (!l.startsWith('  ')) break; // 다음 최상위 항목이나 본문
      if (!l.startsWith('  - ')) continue; // 더 깊이 들여쓴 줄은 앞 항목에 딸린 줄이다
      count++;
      const m = DESIGN_ITEM.exec(l);
      if (m) items.push({ line: i + 1, version: m[1], date: m[2] });
      else {
        unreadable.push(
          problem(
            `설계서 ${i + 1}번째 줄의 변경 이력 항목 형식이 틀리다(\`- v<버전> (<YYYY-MM-DD>): 내용\`)`,
          ),
        );
      }
    }
    if (count === 0) unreadable.push(problem('설계서의 변경 이력에 항목이 없다'));
  }
  if (unreadable.length || !head) return unreadable;

  const out: Problem[] = [];
  const last = items[items.length - 1];
  if (compareVersions(head[1], last.version) !== 0) {
    out.push(
      problem(
        `설계서 머리말의 버전 v${head[1]}가 변경 이력의 마지막 항목 v${last.version}와 다르다`,
      ),
    );
  }
  if (head[2] !== last.date) {
    out.push(
      problem(
        `설계서 머리말의 최종 갱신 ${head[2]}이 변경 이력의 마지막 항목 날짜 ${last.date}와 다르다`,
      ),
    );
  }
  for (let i = 1; i < items.length; i++) {
    if (compareVersions(items[i].version, items[i - 1].version) > 0) continue;
    out.push(
      problem(
        `설계서 ${items[i].line}번째 줄의 v${items[i].version}가 바로 앞 항목 v${items[i - 1].version}보다 크지 않다`,
      ),
    );
  }
  return out;
}

/**
 * 문서 검사. `git` 읽기(문서 목록, 커밋 시각)가 실패하면 빈 결과로 넘기지 않고 `DocLintReadError`를 던진다.
 * 게이트(`check`, `doc-lint` 명령)는 `docLintGate`를 쓴다
 */
export function docLint(root: string, cfg: HarnessConfig, o: DocLintOptions = {}): DocLintResult {
  const history = o.noHistory !== true;
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const exclude = cfg.docLint.exclude ?? [];
  const files = listMarkdown(root).filter((f) => !matchesAny(f, exclude));

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
      history &&
      fm.review_cycle === 'on-change' &&
      Array.isArray(fm.related_code) &&
      fm.related_code.length
    ) {
      const codeT = lastCommitTime(root, fm.related_code);
      const docT = lastCommitTime(root, [f]);
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

  // 5) 설계서 머리말의 버전·최종 갱신과 변경 이력(설계서가 문서 목록에 있을 때만)
  if (files.includes(DESIGN_DOC)) {
    // 문제가 아주 많을 수 있어 인자로 펼치지 않는다
    for (const p of designVersionProblems(readFileSync(path.join(root, DESIGN_DOC), 'utf8'))) {
      errors.push(p);
    }
  }
  return { errors, warnings };
}

/**
 * HEAD가 브랜치를 가리키고 그 브랜치의 ref가 아예 없는가(`git init` 직후, `checkout --orphan` 직후).
 * ref 파일이 있는데 읽을 수 없는 것(손상)은 여기에 들지 않는다. 판별 명령이 실패해도 거짓이다:
 * 그 리포는 보통의 경로로 가서 `git ls-files`나 `git log`의 실패로 드러난다
 */
function hasNoCommits(root: string): boolean {
  const head = gitTry(['symbolic-ref', '-q', 'HEAD'], root);
  const ref = head.stdout.trim();
  if (!head.ok || !ref.startsWith('refs/heads/')) return false;
  if (gitTry(['show-ref', '--verify', '-q', ref], root).code !== 1) return false;
  const file = gitTry(['rev-parse', '--git-path', ref], root);
  return file.ok && !existsSync(path.resolve(root, file.stdout.trim()));
}

/**
 * HEAD가 커밋을 가리키는지 확인한다. 커밋 시각이 필요한 문서가 없으면 문서 검사에서 git log가 불리지 않고,
 * ref가 커밋이 아닌 객체를 가리키면 git log가 출력 없이 성공한다. 손상된 ref가 그대로 지나가지 않게 따로 본다.
 * - show-ref --verify는 정확한 이름만 읽는다: rev-parse HEAD는 브랜치 ref가 손상되면 refs/tags/HEAD 같은 ref로 대신 풀린다
 * - show-ref는 객체가 있는지만 본다: 커밋인지는 그 해시로 cat-file이 본다
 */
function assertHeadCommit(root: string): void {
  const head = gitTry(['show-ref', '--verify', '--hash', 'HEAD'], root);
  const sha = head.stdout.trim();
  if (!head.ok || !/^([0-9a-f]{40}|[0-9a-f]{64})$/.test(sha))
    throw new DocLintReadError('HEAD를 읽지 못했다(git show-ref 실패)');
  if (!gitTry(['cat-file', '-e', `${sha}^{commit}`], root).ok)
    throw new DocLintReadError('HEAD가 커밋을 가리키지 않는다(git cat-file 실패)');
}

/**
 * 게이트(`check`의 doc-lint 단계, `doc-lint` 명령)가 쓰는 문서 검사. `git` 읽기 실패를 통과로 넘기지 않고
 * 오류 한 건으로 돌려준다. 커밋이 없는 리포는 커밋 시각 검사만 건너뛴다
 */
export function docLintGate(root: string, cfg: HarnessConfig): DocLintResult {
  try {
    const unborn = hasNoCommits(root);
    const r = docLint(root, cfg, unborn ? { noHistory: true } : {});
    if (!unborn) assertHeadCommit(root);
    return r;
  } catch (e) {
    if (!(e instanceof DocLintReadError)) throw e;
    return {
      errors: [
        {
          rule: 'R8 문서 읽기 실패',
          what: e.message,
          how: '이 폴더에서 `git status`가 도는지 확인하고(색인·ref 손상, 리포가 아닌 폴더) 고친 뒤 다시 실행하라',
          doc: DOC,
        },
      ],
      warnings: [],
    };
  }
}

export function printDocLint(r: DocLintResult): void {
  for (const w of r.warnings) process.stderr.write('경고 ' + formatProblem(w) + '\n');
  for (const e of r.errors) process.stderr.write(formatProblem(e) + '\n');
}

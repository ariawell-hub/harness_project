// 변경 조각(TD-39, Issue #222). 보호 경로를 바꾼 PR은 CHANGELOG 끝과 설계서 머리말·변경 이력 끝에 줄을 더하지 않고
// PR(브랜치)마다 파일 하나(`docs/harness/changes/<브랜치 이름의 / 뒤>.md`)에 적는다. PR마다 새 파일이라 PR끼리 충돌하지 않는다.
// 버전 번호를 매겨 CHANGELOG와 설계서로 옮기는 일은 모으기 PR이 한다(`collectFragments`, 명령 `changes-collect`).
import { designVersionProblems, readDesignVersion } from './design-version.ts';

/** 변경 조각을 두는 폴더(리포 루트 기준, `/` 구분) */
export const CHANGES_DIR = 'docs/harness/changes';
/** 조각 파일 이름: 계획 id 꼴(step 브랜치면 끝에 `-s<N>`) + `.md` */
const NAME_RE = /^(\d{8}-[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
const SECTIONS = ['CHANGELOG', '설계서 변경 이력'] as const;
type Section = (typeof SECTIONS)[number];
/** 항목 글이 버전으로 시작하면 안 된다(버전은 모으기가 매긴다) */
const VERSIONED = /^v\d+(?:\.\d+)+/;

export interface Fragment {
  /** 파일 이름에서 `.md`를 뺀 것(PR 브랜치 이름의 `/` 뒤) */
  name: string;
  /** CHANGELOG로 옮길 항목(앞의 `- `를 빼고 앞뒤 공백을 지운 글). 하나 이상 */
  changelog: string[];
  /** 설계서 변경 이력으로 옮길 항목(같은 꼴). 없어도 된다 */
  design: string[];
}

export type FragmentParse = { ok: true; value: Fragment } | { ok: false; problems: string[] };

/** 리포 루트 기준 경로가 조각 파일 자리인가 */
export function isFragmentPath(rel: string): boolean {
  const slash = rel.lastIndexOf('/');
  return rel.slice(0, slash) === CHANGES_DIR && NAME_RE.test(rel.slice(slash + 1));
}

/** PR 브랜치의 조각 경로: `CHANGES_DIR/<브랜치 이름의 마지막 / 뒤>.md`. 그 이름이 조각 자리가 아니면 null */
export function fragmentPathFor(branch: string): string | null {
  const rel = `${CHANGES_DIR}/${branch.slice(branch.lastIndexOf('/') + 1)}.md`;
  return isFragmentPath(rel) ? rel : null;
}

/**
 * 조각 파일을 읽는다. 문제를 모두 모아 돌려준다. 형식:
 *
 * ```markdown
 * # 변경 조각: <이름>
 *
 * ## CHANGELOG
 *
 * - <한 줄>
 *
 * ## 설계서 변경 이력
 *
 * - <한 줄>
 * ```
 *
 * - 첫 줄의 이름은 파일 이름에서 `.md`를 뺀 것이다. 섹션은 이 둘뿐이고 이 차례로 한 번씩 둔다. `설계서 변경 이력`은 없어도 된다.
 * - 섹션 안에는 빈 줄과 `- `로 시작하는 한 줄 항목만 둔다(이어지는 줄을 받지 않는다). CHANGELOG 항목은 하나 이상이다.
 * - 항목은 버전(`v0.7.1`)으로 시작하지 않고(버전과 날짜는 모으기가 붙인다) Markdown 링크를 넣지 않는다(모으면 자리가 바뀌어 깨진다)
 */
export function parseFragment(rel: string, text: string): FragmentParse {
  const m = NAME_RE.exec(rel.slice(rel.lastIndexOf('/') + 1));
  if (!isFragmentPath(rel) || !m)
    return {
      ok: false,
      problems: [`조각 파일의 자리·이름이 틀리다(${CHANGES_DIR}/<브랜치 이름의 / 뒤>.md): ${rel}`],
    };
  const name = m[1];
  const problems: string[] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  if (lines[0] !== `# 변경 조각: ${name}`)
    problems.push(`1번째 줄: 첫 줄은 \`# 변경 조각: ${name}\`이어야 한다`);
  const items: Record<Section, string[]> = { CHANGELOG: [], '설계서 변경 이력': [] };
  let section: Section | null = null;
  const seen: Section[] = [];
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i];
    const at = `${i + 1}번째 줄`;
    if (l.trim() === '') continue;
    const h = /^## (.+)$/.exec(l);
    if (h) {
      const s = SECTIONS.find((x) => x === h[1]);
      if (!s) {
        problems.push(`${at}: 받지 않는 섹션이다(${SECTIONS.join(', ')}만 둔다)`);
        section = null;
      } else if (seen.includes(s) || seen.length > SECTIONS.indexOf(s)) {
        problems.push(`${at}: 섹션은 ${SECTIONS.join(', ')} 차례로 한 번씩 둔다`);
        section = null;
      } else {
        seen.push(s);
        section = s;
      }
      continue;
    }
    const item = /^- (.*)$/.exec(l);
    if (!item || section === null) {
      problems.push(`${at}: 섹션 안의 \`- \` 한 줄 항목과 빈 줄만 둔다`);
      continue;
    }
    const body = item[1].trim();
    if (body === '') problems.push(`${at}: 항목이 비었다`);
    else if (VERSIONED.test(body))
      problems.push(`${at}: 항목을 버전으로 시작하지 마라(버전과 날짜는 모으기가 붙인다)`);
    else if (body.includes(']('))
      problems.push(`${at}: 항목에 Markdown 링크를 넣지 마라(모으면 자리가 바뀌어 깨진다)`);
    else items[section].push(body);
  }
  if (items.CHANGELOG.length === 0)
    problems.push('`## CHANGELOG` 섹션에 항목이 하나 이상 있어야 한다');
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: { name, changelog: items.CHANGELOG, design: items['설계서 변경 이력'] },
  };
}

export interface CollectInput {
  /** `docs/harness/design.md`의 글 */
  design: string;
  /** `docs/harness/CHANGELOG.md`의 글 */
  changelog: string;
  /** 조각 폴더의 파일(리포 루트 기준 경로와 글). 차례는 함수가 정한다 */
  fragments: { rel: string; text: string }[];
  /** 모으는 날 `YYYY-MM-DD` */
  date: string;
}

export type CollectResult =
  | { ok: true; design: string; changelog: string; versions: string[]; items: number }
  | { ok: false; problems: string[] };

/** CHANGELOG에서 조각의 CHANGELOG 항목이 들어갈 절의 제목 줄 */
export const CHANGELOG_NEXT = '## 다음 버전 (미배포)';
const THREE_PART = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * 모으기 계산(순수 함수, 모으기 PR의 `changes-collect`가 쓴다). 조각을 경로의 글자 차례로 읽어
 * CHANGELOG 항목은 "다음 버전 (미배포)" 절 끝에, 설계서 변경 이력 항목은 패치 번호를 하나씩 올린 버전과 `date`로
 * 변경 이력 끝에 넣고 머리말을 맞춘다. 조각 하나라도 형식이 틀리거나 설계서·CHANGELOG를 읽지 못하면 문제를 모두 모아
 * `ok: false`다(일부만 옮기지 않는다). 조각이 없으면 두 글을 그대로 돌려준다
 */
export function collectFragments(i: CollectInput): CollectResult {
  if (i.fragments.length === 0)
    return { ok: true, design: i.design, changelog: i.changelog, versions: [], items: 0 };
  const problems: string[] = [];
  const sorted = [...i.fragments].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  const frags: Fragment[] = [];
  for (const f of sorted) {
    const r = parseFragment(f.rel, f.text);
    if (r.ok) frags.push(r.value);
    else for (const p of r.problems) problems.push(`${f.rel}: ${p}`);
  }

  // 설계서: 머리말·변경 이력이 맞아야 하고, 마지막 버전이 세 마디여야 패치 번호를 올릴 수 있다
  const designNl = i.design.includes('\r\n') ? '\r' : '';
  const designLines = i.design.split('\n');
  let insertAt = -1;
  let headLine = -1;
  let next: number[] | null = null;
  const versionProblems = designVersionProblems(i.design);
  for (const p of versionProblems) problems.push(p.what);
  const dv = readDesignVersion(i.design);
  if (versionProblems.length === 0 && dv.ok) {
    const last = dv.value.items[dv.value.items.length - 1].version;
    const m = THREE_PART.exec(last);
    if (!m)
      problems.push(
        `설계서 변경 이력의 마지막 버전 v${last}가 <정수>.<정수>.<정수>가 아니라 패치 번호를 올릴 수 없다`,
      );
    else next = [Number(m[1]), Number(m[2]), Number(m[3])];
    insertAt = dv.value.end;
    headLine = dv.value.head.line;
  }

  // CHANGELOG: "다음 버전 (미배포)" 절이 정확히 하나여야 한다
  const logNl = i.changelog.includes('\r\n') ? '\r' : '';
  const logLines = i.changelog.split('\n');
  const strip = (l: string) => (l.endsWith('\r') ? l.slice(0, -1) : l);
  const titles = logLines.flatMap((l, n) => (strip(l) === CHANGELOG_NEXT ? [n] : []));
  if (titles.length !== 1)
    problems.push(
      `CHANGELOG에 \`${CHANGELOG_NEXT}\` 줄이 ${titles.length === 0 ? '없다' : `${titles.length}개다(하나여야 한다)`}`,
    );
  if (problems.length > 0 || !next) return { ok: false, problems };

  // 설계서 변경 이력 항목
  const versions: string[] = [];
  const added: string[] = [];
  for (const text of frags.flatMap((f) => f.design)) {
    next[2]++;
    const v = `v${next.join('.')}`;
    versions.push(v);
    added.push(`  - ${v} (${i.date}): ${text}${designNl}`);
  }
  let design = i.design;
  if (added.length > 0) {
    const lines = [...designLines];
    lines.splice(insertAt, 0, ...added);
    lines[headLine] = lines[headLine]
      .replace(/^> 버전 v\S+/, `> 버전 ${versions[versions.length - 1]}`)
      .replace(/최종 갱신: \d{4}-\d{2}-\d{2}/, `최종 갱신: ${i.date}`);
    design = lines.join('\n');
    const after = designVersionProblems(design);
    if (after.length > 0) return { ok: false, problems: after.map((p) => p.what) };
  }

  // CHANGELOG 항목: 절(다음 `## ` 제목이나 파일 끝까지)의 마지막 비지 않은 줄 바로 뒤
  const items = frags.flatMap((f) => f.changelog).map((t) => `- ${t}${logNl}`);
  const title = titles[0];
  let sectionEnd = logLines.findIndex((l, n) => n > title && strip(l).startsWith('## '));
  if (sectionEnd < 0) sectionEnd = logLines.length;
  let lastText = title;
  for (let n = title + 1; n < sectionEnd; n++) if (strip(logLines[n]).trim() !== '') lastText = n;
  const lines = [...logLines];
  // 절에 항목이 없으면 제목과 항목 사이에 빈 줄을 둔다
  lines.splice(lastText + 1, 0, ...(lastText === title ? [logNl, ...items] : items));
  return { ok: true, design, changelog: lines.join('\n'), versions, items: items.length };
}

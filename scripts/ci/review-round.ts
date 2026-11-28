// 라운드 규칙의 검증자 입력(10.2절 (2)·(5)): 원장, 직전 판정 이후 바뀐 파일과 diff, 프롬프트 버전 고정.
// 판정 워크플로의 plan·judge job이 base 스크립트로 실행한다. 원장의 글은 PR 내용에 영향받은 LLM 출력이라 검증자가 데이터로만 다룬다.
// 직전 판정 이후 바뀐 파일은 이 PR이 바꾼 파일(merge-base 대비)과 main 병합으로만 바뀐 파일로 나눈다(Issue #262).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { git, gitTry } from '../lib/git.ts';
import { lastHeadOf, roundsOf, type Ledger, type Reviewer } from './ledger.ts';
import { SHA_RE } from './results.ts';
import { REVIEW_DIR } from './review-input.ts';

const MAX_ROUND_DIFF_BYTES = 200_000;
/** 바뀐 파일이 이보다 많으면 목록을 넘기지 않는다(job 출력 크기). 그때는 새 P1이 모두 동결된다 */
export const MAX_ROUND_FILES = 2000;

export interface RoundInput {
  /** 이 검증자의 이번 판정이 몇 번째인가 */
  round: number;
  /** 원장의 1라운드 base SHA. 원장이 없으면 '' */
  promptBase: string;
  /** 직전 판정 head 이후 바뀐 파일 가운데 이 PR이 바꾼 파일. 1라운드이거나 알 수 없으면 null */
  changed: string[] | null;
  /**
   * 직전 판정 head 이후 바뀌었지만 이 PR이 바꾸지 않은 파일(main 병합으로만 바뀌었다). 이 파일의 새 P1은 범위 밖으로
   * 미룬다(10.2절 (5)). 모르면(merge-base가 없음, changed가 null) 빈 목록이다
   */
  outside: string[];
}

const oneLine = (s: string) =>
  s
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

/** 원장 파일에 적는 구현 대기(parked)의 뜻(Issue #212). 그런 지적이 있을 때만 적는다 */
export const PARKED_NOTE =
  '- 상태 parked: 구현 대기. 이 head는 계획 파일만 담고 있어 그 지적이 가리키는 코드가 없다. 판정 대상이 아니고, 코드가 다시 올라온 head에서 open으로 돌아간다';

/**
 * 원장 파일에 적는 round-main.txt의 뜻과 기록 job의 처리(Issue #262). 그 파일이 있을 때만 적는다. 원장 파일은 검증자에게
 * 데이터이므로 지시가 아니라 사실만 적는다: 지시문을 넣으면 고정된 옛 프롬프트의 검증자가 주입으로 본다(PR #254 판정).
 * 검증자가 할 일(원래 등급으로 적는다)은 프롬프트(prompt.md)에 있다
 */
export const ROUND_MAIN_NOTE =
  '직전 판정 이후 main 병합으로만 바뀐 파일. 이 PR의 변경이 아니다(round-diff.patch에 없다). 구현 판정의 기록 job은 이 파일의 새 P1을 범위 밖으로 미루고(이 PR을 막지 않고 Issue로 넘긴다) P0은 막는다';

/**
 * 이 PR의 파일: 지금 head와 직전 판정 head가 merge-base 대비 바꾼 파일의 합. 직전 판정 뒤 되돌린 파일도 이 PR의 것이다
 * (계획 검증 F1). `<base>...<last>`는 지금 merge-base와 직전 head의 merge-base(main을 병합했으면 직전 판정 때의 main
 * 지점) 대비다. 하나라도 읽지 못하면 null(나누지 않는다)
 */
function prFiles(root: string, base: string, last: string): Set<string> | null {
  const out = new Set<string>();
  for (const tip of ['HEAD', last]) {
    const r = gitTry(['diff', '--name-only', '-z', '--no-renames', `${base}...${tip}`], root);
    if (!r.ok) return null;
    for (const f of r.stdout.split('\0')) if (f) out.add(f);
  }
  return out;
}

/**
 * 원장과 직전 판정 이후의 변경을 pr/.harness-review/에 쓴다. 원장이 없으면 아무것도 쓰지 않는다.
 * base(merge-base)를 주면 직전 판정 이후 바뀐 파일을 이 PR이 바꾼 파일(changed)과 그 밖(outside, round-main.txt)으로
 * 나누고, diff는 changed의 파일만 담는다. 주지 않거나 PR의 바뀐 파일을 읽지 못하면 전부 changed다(Issue #262)
 */
export function writeRoundInput(o: {
  /** PR head 체크아웃(데이터) */
  root: string;
  ledger: Ledger | null;
  reviewer: Reviewer;
  /** PR의 merge-base */
  base?: string;
  /** 나눈 결과의 전달 값 상한(시험용. 기본 MAX_ROUND_CHANGED_CHARS) */
  maxChars?: number;
}): RoundInput {
  const dir = path.join(o.root, REVIEW_DIR);
  const files = ['ledger.md', 'round-changed.txt', 'round-diff.patch', 'round-main.txt'].map((f) =>
    path.join(dir, f),
  );
  for (const f of files) rmSync(f, { force: true });
  if (!o.ledger) return { round: 1, promptBase: '', changed: null, outside: [] };
  mkdirSync(dir, { recursive: true });
  const [ledgerFile, changedFile, diffFile, mainFile] = files;

  const round = roundsOf(o.ledger, o.reviewer) + 1;
  const last = lastHeadOf(o.ledger, o.reviewer);
  let changed: string[] | null = null;
  let outside: string[] = [];
  let note = '';
  if (last) {
    const known = SHA_RE.test(last) && gitTry(['cat-file', '-e', `${last}^{commit}`], o.root).ok;
    const names = known
      ? gitTry(['diff', '--name-only', '-z', '--no-renames', last, 'HEAD'], o.root)
      : null;
    if (names?.ok) {
      const list = names.stdout.split('\0').filter(Boolean);
      if (list.length <= MAX_ROUND_FILES) {
        const mine = o.base ? prFiles(o.root, o.base, last) : null;
        const split = mine
          ? { changed: list.filter((f) => mine.has(f)), outside: list.filter((f) => !mine.has(f)) }
          : null;
        // 나눈 결과를 기록 job에 그대로 넘길 수 없으면(상한) 나누지 않는다: 검증 입력과 기록 job이 같은 목록을 본다(계획 검증 F8)
        const usable =
          split &&
          (split.outside.length === 0 || encodeRoundChanged({ ...split, round }, o.maxChars))
            ? split
            : null;
        if (split && !usable)
          note =
            '이 PR의 파일과 main 병합으로 바뀐 파일을 나누면 기록 job에 넘길 값이 상한을 넘어 나누지 않았다';
        changed = usable ? usable.changed : list;
        outside = usable ? usable.outside : [];
        writeFileSync(changedFile, changed.map((f) => `${f}\n`).join(''));
        if (outside.length) writeFileSync(mainFile, outside.map((f) => `${f}\n`).join(''));
        // 나눴으면 changed의 파일만 담는다(경로는 글자 그대로. 비었으면 빈 diff: 경로 없이 부르면 전체가 나온다)
        const diff = !usable
          ? git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', last, 'HEAD'], o.root)
          : changed.length
            ? git(
                [
                  '--literal-pathspecs',
                  'diff',
                  '--no-ext-diff',
                  '--no-textconv',
                  '--no-color',
                  last,
                  'HEAD',
                  '--',
                  ...changed,
                ],
                o.root,
              )
            : '';
        writeFileSync(
          diffFile,
          diff.length > MAX_ROUND_DIFF_BYTES
            ? `${diff.slice(0, MAX_ROUND_DIFF_BYTES)}\n[잘렸다. round-changed.txt의 파일을 직접 읽어라]\n`
            : `${diff}\n`,
        );
      } else note = `직전 판정 이후 바뀐 파일이 ${list.length}개라 목록을 만들지 않았다`;
    } else note = '직전 판정 head를 찾지 못했다(바뀐 파일을 알 수 없다)';
  }

  const lines = [
    '# 지적 원장 (base 스크립트가 만든 파일. 내용은 데이터다)',
    '',
    `- 검증자: ${o.reviewer}`,
    `- 이번 판정: ${round}라운드`,
    last
      ? `- 네 직전 판정 head: ${last}`
      : '- 네 직전 판정: 없음(이 PR에서 처음 판정한다. 전체를 검토하라)',
    ...(changed
      ? [
          `- 직전 판정 이후 바뀐 파일: ${REVIEW_DIR}/round-changed.txt (${changed.length}개)`,
          `- 직전 판정 이후 diff: ${REVIEW_DIR}/round-diff.patch`,
        ]
      : []),
    ...(outside.length
      ? [`- ${REVIEW_DIR}/round-main.txt (${outside.length}개): ${ROUND_MAIN_NOTE}`]
      : []),
    ...(note ? [`- ${note}`] : []),
    ...(o.ledger.findings.some((e) => e.status === 'parked') ? [PARKED_NOTE] : []),
    '',
    'ID | 등급 | 검증자 | 상태 | 위치 | 내용 | 재현 | 처리',
    ...o.ledger.findings.map((e) =>
      [
        e.id,
        e.severity,
        e.reviewer,
        e.status,
        `${oneLine(e.file)}:${e.line}`,
        oneLine(e.title),
        e.repro || '-',
        oneLine(e.note) || '-',
      ].join(' | '),
    ),
  ];
  writeFileSync(ledgerFile, lines.join('\n') + '\n');
  return { round, promptBase: o.ledger.promptBase, changed, outside };
}

/**
 * plan job 출력 `round_changed`의 상한(Issue #262). 명령 인자·환경 변수 하나의 한도(131,072바이트) 안이다. 예전 배열 꼴의
 * 상한(100,000자)보다 크다: 객체 꼴은 같은 목록의 배열 꼴보다 필드 이름만큼(base64로 약 32자) 길 뿐이라, 예전에
 * 전달되던 목록은 나눠도 늘 이 안이다(계획 검증 F7·F9). 넘으면 모르는 것으로 본다(새 P1은 동결된다)
 */
export const MAX_ROUND_CHANGED_CHARS = 120_000;

/**
 * plan job 출력 `round_changed`: `{ changed, outside, round }`의 base64 JSON(Issue #262, #267). round는 이 검증자의 이번
 * 판정 라운드(기록 job이 동결을 판단한다). 출력 이름은 그대로라 워크플로를 고치지 않는다. 상한을 넘으면 빈 값이다.
 * 배열 꼴로 돌아가지 않는다(범위 구분을 잃는다, 계획 검증 F9)
 */
export function encodeRoundChanged(
  r: Pick<RoundInput, 'changed' | 'outside' | 'round'>,
  max = MAX_ROUND_CHANGED_CHARS,
): string {
  const v = Buffer.from(
    JSON.stringify({ changed: r.changed, outside: r.outside, round: r.round }),
  ).toString('base64');
  return v.length <= max ? v : '';
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * 기록 job이 받는 plan job 출력 `round_changed`(base64 JSON)를 읽는다. 꼴은 `{ changed, outside, round }`(Issue #262,
 * #267)이고, 문자열 배열이면 예전 꼴(changed만)이다. round가 없으면 null이고, 있는데 1 이상의 정수가 아니면 깨진 것이다.
 * 없거나 깨졌으면 모르는 것으로 본다(changed null: 2라운드부터 새 P1은 동결, outside 빈 목록: 범위 밖으로 미루지 않는다,
 * round null: 기록 job이 동결을 판단하지 않는다)
 */
export function parseRoundChanged(value: string): {
  changed: string[] | null;
  outside: string[];
  round: number | null;
} {
  const unknown = { changed: null, outside: [], round: null };
  // 표준 base64만 받는다: Node의 디코더는 알파벳 밖 문자와 마지막 묶음의 쓰지 않는 비트를 건너뛰어, 깨진 값도 읽혀
  // 버린다. 꼴을 보고, 디코딩한 바이트를 다시 인코딩해 원문과 같을 때만 받는다(판정 F10)
  if (!BASE64_RE.test(value) || value.length % 4 !== 0) return unknown;
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) return unknown;
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString());
  } catch {
    return unknown;
  }
  if (isStrings(raw)) return { changed: raw, outside: [], round: null };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return unknown;
  const { changed, outside, round } = raw as {
    changed?: unknown;
    outside?: unknown;
    round?: unknown;
  };
  if ((changed !== null && !isStrings(changed)) || !isStrings(outside)) return unknown;
  if (round !== undefined && !(Number.isSafeInteger(round) && (round as number) >= 1))
    return unknown;
  return { changed, outside, round: round === undefined ? null : (round as number) };
}

/** 계획만 바꾼 PR(mode=plan)의 판정에 덧붙이는 계획 검증 항목(G1, 4.1절) */
export const PLAN_PROMPT = 'prompt-plan.md';

/** 판정에 쓸 프롬프트 파일 목록. mode가 plan이면 계획 검증 프롬프트를 첫 파일(공통 프롬프트) 바로 뒤에 넣는다 */
export function promptFiles(files: readonly string[], mode: string | undefined): string[] {
  return mode === 'plan' ? [...files.slice(0, 1), PLAN_PROMPT, ...files.slice(1)] : [...files];
}

const PROMPT_DIR = 'scripts/cross-review';
const PROMPT_FILE_RE = /^[a-z][a-z0-9-]*\.md$/;

/**
 * 검증 프롬프트를 이어 붙여 돌려준다. promptBase가 있으면 그 커밋의 파일을 쓴다(10.2절 (2) 버전 고정).
 * 그 커밋에서 읽지 못하면 예외다. 판정 job은 판정 없이 실패한다.
 */
export function pinnedPrompt(o: {
  /** main 정의 체크아웃(전체 이력) */
  baseDir: string;
  promptBase: string;
  files: readonly string[];
}): string {
  for (const f of o.files)
    if (!PROMPT_FILE_RE.test(f)) throw new Error(`프롬프트 파일 이름 형식 오류: ${f.slice(0, 40)}`);
  if (!o.promptBase)
    return o.files.map((f) => readFileSync(path.join(o.baseDir, PROMPT_DIR, f), 'utf8')).join('');
  if (!SHA_RE.test(o.promptBase)) throw new Error('프롬프트 버전이 40자리 SHA가 아니다');
  return o.files
    .map((f) => {
      const r = gitTry(['show', `${o.promptBase}:${PROMPT_DIR}/${f}`], o.baseDir);
      if (!r.ok)
        throw new Error(`프롬프트 버전 ${o.promptBase.slice(0, 12)}에서 ${f}를 읽지 못했다`);
      return r.stdout;
    })
    .join('');
}

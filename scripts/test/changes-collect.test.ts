// 변경 조각 모으기(TD-39, Issue #222): 모으기 계산(collectFragments)과 명령(changes-collect).
// 조각을 이름 차례로 읽어 CHANGELOG "다음 버전 (미배포)" 끝과 설계서 변경 이력 끝으로 옮기고 조각 파일을 지운다.
// 문제가 하나라도 있으면 아무 파일도 쓰지 않는다. 계획 20261123-change-fragments step1.
import assert from 'node:assert/strict';
import {
  existsSync,
  ftruncateSync,
  openSync,
  writeSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { docLint } from '../gates/doc-lint.ts';
import { loadConfig } from '../lib/config.ts';
import { designVersionProblems } from '../lib/design-version.ts';
import { runSync } from '../lib/exec.ts';
import { today } from '../lib/util.ts';
import { HARNESS_ROOT, commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

// 새 함수와 새 모듈은 동적으로 가져온다: 이 변경 전의 코드에는 없어서, 정적으로 가져오면 파일 전체가 단언 전에 죽는다
const lib: Partial<typeof import('../lib/changes.ts')> = await import('../lib/changes.ts').catch(
  () => ({}),
);
const cmd: Partial<typeof import('../commands/changes.ts')> =
  await import('../commands/changes.ts').catch(() => ({}));

const FRONT = '---\nstatus: active\nrelated_code: []\nreview_cycle: on-change\n---\n';
const DESIGN_PATH = 'docs/harness/design.md';
const CHANGELOG_PATH = 'docs/harness/CHANGELOG.md';
const DIR = 'docs/harness/changes';
const RESTORE = 'git restore --source=HEAD';

const head = (version: string, date: string) =>
  `> 버전 v${version} · 상태: 초안 · 최종 갱신: ${date}`;
/** 짧은 설계서: 머리말 줄과 변경 이력 목록(마지막 항목 v0.7.81). history는 목록의 줄들 */
const designText = (
  headLine = head('0.7.81', '2026-11-23'),
  history = ['  - v0.7.80 (2026-11-22): 앞 항목', '  - v0.7.81 (2026-11-23): 마지막 항목'],
) =>
  [
    '# 설계서',
    '',
    headLine,
    '',
    '- **문서 성격**: 설명',
    '- **변경 이력**',
    ...history,
    '- **다른 항목**: 설명',
    '',
    '본문',
    '',
  ].join('\n');
/** 짧은 CHANGELOG: 머리, "다음 버전" 절과 항목 하나, 빈 줄, 앞 버전 절. next는 "다음 버전" 절의 항목 */
const changelogText = (next = ['있던 항목'], nextTitle = '## 다음 버전 (미배포)') =>
  [
    '# 하네스 변경 이력',
    '',
    '머리 문장.',
    '',
    nextTitle,
    '',
    ...next.map((x) => `- ${x}`),
    '',
    '## 0.1.0 — 2026-11-11 (로드맵 1단계 최소 구성)',
    '',
    '- 첫 버전',
    '',
  ].join('\n');
const frag = (name: string, changelog: string[], design: string[] = []) =>
  [
    `# 변경 조각: ${name}`,
    '',
    '## CHANGELOG',
    '',
    ...changelog.map((x) => `- ${x}`),
    ...(design.length ? ['', '## 설계서 변경 이력', '', ...design.map((x) => `- ${x}`)] : []),
    '',
  ].join('\n');
const A = { rel: `${DIR}/20261124-a.md`, text: frag('20261124-a', ['a 하나', 'a 둘']) };
const B = {
  rel: `${DIR}/20261124-b-s0.md`,
  text: frag('20261124-b-s0', ['b 하나'], ['b 설계 첫째', 'b 설계 둘째']),
};

/** A·B를 모은 뒤의 설계서와 CHANGELOG(모은 날 date) */
const collectedDesign = (date: string) =>
  designText(head('0.7.83', date), [
    '  - v0.7.80 (2026-11-22): 앞 항목',
    '  - v0.7.81 (2026-11-23): 마지막 항목',
    `  - v0.7.82 (${date}): b 설계 첫째`,
    `  - v0.7.83 (${date}): b 설계 둘째`,
  ]);
const collectedChangelog = () => changelogText(['있던 항목', 'a 하나', 'a 둘', 'b 하나']);

/** collectFragments를 부른다. 함수가 없으면 고정 글(단언이 실패한다) */
function collect(i: {
  design?: string;
  changelog?: string;
  fragments: { rel: string; text: string }[];
  date?: string;
}): unknown {
  const f = lib.collectFragments;
  if (typeof f !== 'function') return 'collectFragments 없음';
  return f({
    design: i.design ?? designText(),
    changelog: i.changelog ?? changelogText(),
    fragments: i.fragments,
    date: i.date ?? '2026-11-24',
  });
}
/** 통과한 결과(아니면 단언 실패) */
function okOf(r: unknown): {
  design: string;
  changelog: string;
  versions: string[];
  items: number;
} {
  assert.equal((r as { ok?: unknown })?.ok, true, JSON.stringify(r));
  return r as { design: string; changelog: string; versions: string[]; items: number };
}
/** 실패한 결과의 문제 글(아니면 단언 실패) */
function problemsOf(r: unknown): string {
  assert.equal((r as { ok?: unknown })?.ok, false, JSON.stringify(r));
  const p = (r as { problems?: unknown }).problems;
  assert.ok(Array.isArray(p) && p.length > 0, JSON.stringify(r));
  return (p as string[]).join('\n');
}

/** doc-lint가 설계서·CHANGELOG를 문서 목록에서 읽는 임시 리포. 조각을 두고 커밋한다 */
function repo(fragments: { rel: string; text: string }[] = [A, B]): string {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ docLint: { agentsMdMaxLines: 10, exclude: [] } })),
  );
  write(root, 'AGENTS.md', '# 지도\n\n- [목차](docs/index.md)\n');
  write(
    root,
    'docs/index.md',
    `${FRONT}# 목차\n\n- [설계서](harness/design.md)\n- [변경 이력](harness/CHANGELOG.md)\n`,
  );
  // 이 리포와 같은 줄 끝 정책(판정 F7): `core.autocrlf=true`인 환경에서도 꺼낸 파일이 LF다
  write(root, '.gitattributes', '* text=auto eol=lf\n');
  write(root, DESIGN_PATH, FRONT + designText());
  write(root, CHANGELOG_PATH, FRONT + changelogText());
  for (const f of fragments) write(root, f.rel, f.text);
  commitAll(root, 'base');
  return root;
}
/** 출력에서 되돌리는 명령 줄을 찾아 git 인자로 */
const restoreArgs = (out: string) => {
  const line = out.split('\n').find((l) => l.includes(RESTORE)) ?? '';
  return line.slice(line.indexOf(RESTORE)).trim().replace(/`/g, '').split(/\s+/).slice(1);
};
const read = (root: string, rel: string) => readFileSync(path.join(root, rel), 'utf8');
/** 설계서·CHANGELOG·조각 폴더 안의 모든 파일과 extra(절대 경로)의 바이트(링크는 따라가 읽는다) */
function snapshot(root: string, extra: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (abs: string) => {
    out[abs] = existsSync(abs) ? readFileSync(abs).toString('base64') : '<없음>';
  };
  add(path.join(root, DESIGN_PATH));
  add(path.join(root, CHANGELOG_PATH));
  const dir = path.join(root, DIR);
  if (existsSync(dir)) for (const n of readdirSync(dir)) add(path.join(dir, n));
  for (const e of extra) add(e);
  return out;
}
/** 명령을 실제로 실행한다(cwd는 임시 리포) */
const cli = (root: string) =>
  runSync(process.execPath, [path.join(HARNESS_ROOT, 'scripts/harness.ts'), 'changes-collect'], {
    cwd: root,
  });
/** runChangesCollect를 직접 부르고 출력을 모은다. 함수가 없으면 종료 코드 -1 */
function direct(
  root: string,
  o: Parameters<NonNullable<typeof cmd.runChangesCollect>>[1] = {},
): { code: number; out: string } {
  const run = cmd.runChangesCollect;
  if (typeof run !== 'function') return { code: -1, out: 'runChangesCollect 없음' };
  let out = '';
  const w = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  const grab = (chunk: unknown) => ((out += String(chunk)), true);
  process.stdout.write = grab as typeof process.stdout.write;
  process.stderr.write = grab as typeof process.stderr.write;
  try {
    return { code: run(root, o), out };
  } finally {
    process.stdout.write = w;
    process.stderr.write = e;
  }
}
/** 쓰기 주입 콜백이 새 파일의 핸들에 끝까지 쓴다(Issue #257: 주입은 경로가 아니라 핸들에 쓴다) */
function writeAll(fd: number, text: string): void {
  const b = Buffer.from(text, 'utf8');
  for (let at = 0; at < b.length;) at += writeSync(fd, b, at, b.length - at, at);
}
/** 링크를 만든다. 권한이 없는 환경(Windows)이면 false */
function tryLink(make: () => void): boolean {
  try {
    make();
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw err;
  }
}

test('collectFragments: 조각을 이름 차례로 CHANGELOG "다음 버전" 끝과 설계서 변경 이력 끝으로 옮기고 머리말을 맞춘다', () => {
  // 넘긴 차례(b, a)와 상관없이 경로의 글자 차례(a, b)로 옮긴다
  const r = okOf(collect({ fragments: [B, A], date: '2026-11-24' }));
  assert.equal(r.design, collectedDesign('2026-11-24'));
  assert.equal(r.changelog, collectedChangelog());
  assert.deepEqual(r.versions, ['v0.7.82', 'v0.7.83']);
  assert.equal(r.items, 3);
  assert.deepEqual(designVersionProblems(r.design), []);
});

test('collectFragments: 설계서 항목이 없으면 설계서는 그대로, 조각이 없으면 둘 다 그대로다', () => {
  const only = okOf(collect({ fragments: [A] }));
  assert.equal(only.design, designText());
  assert.equal(only.changelog, changelogText(['있던 항목', 'a 하나', 'a 둘']));
  assert.deepEqual([only.versions, only.items], [[], 2]);
  const none = okOf(collect({ fragments: [] }));
  assert.deepEqual(
    [none.design, none.changelog, none.versions, none.items],
    [designText(), changelogText(), [], 0],
  );
});

test('collectFragments: 마지막 변경 이력 항목에 딸린 줄이 있으면 새 항목은 그 줄 뒤에 들어간다', () => {
  const nested = [
    '  - v0.7.80 (2026-11-22): 앞 항목',
    '  - v0.7.81 (2026-11-23): 마지막 항목',
    '    - 딸린 줄',
  ];
  const r = okOf(
    collect({ design: designText(undefined, nested), fragments: [B], date: '2026-11-24' }),
  );
  assert.equal(
    r.design,
    designText(head('0.7.83', '2026-11-24'), [
      ...nested,
      '  - v0.7.82 (2026-11-24): b 설계 첫째',
      '  - v0.7.83 (2026-11-24): b 설계 둘째',
    ]),
  );
  assert.deepEqual(designVersionProblems(r.design), []);
  // 판정 F3: 머리말의 설명 안에 앞선 "최종 갱신:" 글이 있어도 줄 끝의 최종 갱신만 바꾸고 설명은 그대로 둔다
  const noted = (version: string, date: string) =>
    `> 버전 v${version} · 참고: 최종 갱신: 2026-01-01 · 최종 갱신: ${date}`;
  const withNote = okOf(
    collect({
      design: designText(noted('0.7.81', '2026-11-23')),
      fragments: [B],
      date: '2026-11-24',
    }),
  );
  assert.equal(
    withNote.design,
    collectedDesign('2026-11-24').replace(
      head('0.7.83', '2026-11-24'),
      noted('0.7.83', '2026-11-24'),
    ),
  );
  assert.deepEqual(designVersionProblems(withNote.design), []);
  // 판정 F4: 패치 번호가 안전 정수(2^53 - 1)를 넘어도 정확히 하나씩 올린다
  const big = '9007199254740992';
  const huge = okOf(
    collect({
      design: designText(head(`0.7.${big}`, '2026-11-23'), [
        '  - v0.7.80 (2026-11-22): 앞 항목',
        `  - v0.7.${big} (2026-11-23): 마지막 항목`,
      ]),
      fragments: [B],
      date: '2026-11-24',
    }),
  );
  assert.deepEqual(huge.versions, ['v0.7.9007199254740993', 'v0.7.9007199254740994']);
  assert.match(
    huge.design,
    /^> 버전 v0\.7\.9007199254740994 · 상태: 초안 · 최종 갱신: 2026-11-24$/m,
  );
  assert.deepEqual(designVersionProblems(huge.design), []);
});

test('collectFragments: 형식이 틀린 조각, 자리 밖 경로, 어긋난 머리말, 세 마디가 아닌 버전, "다음 버전" 절이 없는 CHANGELOG는 실패다', () => {
  const bad = { rel: `${DIR}/20261124-c.md`, text: '# 변경 조각: 20261124-c\n\n그냥 글\n' };
  assert.match(problemsOf(collect({ fragments: [A, bad] })), /20261124-c\.md/);
  assert.match(
    problemsOf(collect({ fragments: [{ rel: `${DIR}/sub/20261124-a.md`, text: A.text }] })),
    /sub\/20261124-a\.md/,
  );
  assert.match(
    problemsOf(collect({ design: designText(head('0.7.80', '2026-11-23')), fragments: [B] })),
    /v0\.7\.80/,
  );
  const twoPart = designText(head('0.8', '2026-11-23'), [
    '  - v0.7.81 (2026-11-22): 앞 항목',
    '  - v0.8 (2026-11-23): 마지막 항목',
  ]);
  assert.match(problemsOf(collect({ design: twoPart, fragments: [B] })), /0\.8/);
  assert.match(
    problemsOf(collect({ changelog: changelogText(['x'], '## 다음 버전'), fragments: [A] })),
    /다음 버전 \(미배포\)/,
  );
});

test('changes-collect: 조각을 모아 지우고 doc-lint를 통과한다. 다시 실행하면 모을 조각이 없다', () => {
  const root = repo();
  const r = cli(root);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /changes-collect: 조각 2개/);
  assert.equal(existsSync(path.join(root, A.rel)), false);
  assert.equal(existsSync(path.join(root, B.rel)), false);
  assert.equal(read(root, DESIGN_PATH), FRONT + collectedDesign(today()));
  assert.equal(read(root, CHANGELOG_PATH), FRONT + collectedChangelog());
  const errors = docLint(root, loadConfig(root), { noHistory: true }).errors;
  assert.deepEqual(
    errors.map((x) => `${x.rule} ${x.what}`),
    [],
  );
  const before = snapshot(root);
  const again = cli(root);
  assert.equal(again.code, 0, again.stdout + again.stderr);
  assert.match(again.stdout, /모을 조각 없음/);
  assert.deepEqual(snapshot(root), before);
});

test('changes-collect: 조각 폴더가 없거나 비었으면 아무것도 바꾸지 않고 0이다', () => {
  for (const make of [false, true]) {
    const root = repo([]);
    if (make) mkdirSync(path.join(root, DIR), { recursive: true });
    const before = snapshot(root);
    const r = cli(root);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /모을 조각 없음/);
    assert.deepEqual(snapshot(root), before);
  }
});

test('changes-collect: 형식이 틀린 조각, 조각이 아닌 파일, 커밋하지 않은 변경, 무시된 조각이 있으면 아무것도 바꾸지 않고 1이다', () => {
  const bad = { rel: `${DIR}/20261124-c.md`, text: '# 변경 조각: 20261124-c\n\n그냥 글\n' };
  const cases: [string, () => string, RegExp][] = [
    ['(a) 형식', () => repo([A, bad]), /20261124-c\.md/],
    [
      '(b) 조각이 아닌 파일',
      () => repo([A, { rel: `${DIR}/notes.txt`, text: '메모\n' }]),
      /notes\.txt/,
    ],
    [
      '(c) 커밋하지 않은 변경',
      () => {
        const root = repo([A]);
        writeFileSync(path.join(root, CHANGELOG_PATH), read(root, CHANGELOG_PATH) + '\n- 덧붙임\n');
        return root;
      },
      new RegExp(RESTORE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    ],
    [
      '(d) 무시된 조각',
      () => {
        const root = repo([A]);
        writeFileSync(
          path.join(root, '.git/info/exclude'),
          'docs/harness/changes/20261124-b-s0.md\n',
        );
        write(root, B.rel, B.text);
        return root;
      },
      /20261124-b-s0\.md/,
    ],
    // 판정 F1(P0): 색인 표시로 git status에서 숨긴 커밋하지 않은 수정. 수정본은 그대로 남아야 한다
    [
      '(e) assume-unchanged로 숨긴 조각 수정',
      () => {
        const root = repo([A, B]);
        write(root, A.rel, frag('20261124-a', ['a 하나', 'a 둘', 'a 셋(커밋하지 않음)']));
        sh('git', ['update-index', '--assume-unchanged', A.rel], root);
        return root;
      },
      /20261124-a\.md: HEAD에 커밋된 내용과 다르다/,
    ],
    [
      '(f) skip-worktree로 숨긴 CHANGELOG 수정',
      () => {
        const root = repo([A]);
        writeFileSync(
          path.join(root, CHANGELOG_PATH),
          read(root, CHANGELOG_PATH) + '\n- 숨긴 줄\n',
        );
        sh('git', ['update-index', '--skip-worktree', CHANGELOG_PATH], root);
        return root;
      },
      /CHANGELOG\.md: HEAD에 커밋된 내용과 다르다/,
    ],
    // 판정 F1(P0) 2회차: 줄 끝만 CRLF로 바꾼 숨긴 수정도 커밋하지 않은 바이트다(이 리포는 LF를 강제한다)
    [
      '(g) 줄 끝만 CRLF로 바꾸고 숨긴 조각 수정',
      () => {
        const root = repo([A, B]);
        write(root, A.rel, A.text.replace(/\n/g, '\r\n'));
        sh('git', ['update-index', '--assume-unchanged', A.rel], root);
        return root;
      },
      /20261124-a\.md: HEAD에 커밋된 내용과 다르다/,
    ],
  ];
  for (const [name, make, why] of cases) {
    const root = make();
    const before = snapshot(root);
    const r = cli(root);
    assert.equal(r.code, 1, `${name}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, why, name);
    assert.deepEqual(snapshot(root), before, name);
  }
});

test('changes-collect: 심볼릭 링크(조각 폴더, 조각, 기록 파일)와 하드 링크로 이어진 기록 파일이 있으면 1이고 아무것도 바꾸지 않는다', () => {
  const outside = tmp();
  const outDir = path.join(outside, 'changes');
  mkdirSync(outDir);
  writeFileSync(path.join(outDir, '20261124-a.md'), A.text);
  const outFile = path.join(outside, 'CHANGELOG.md');
  const emptyDir = path.join(outside, 'empty');
  mkdirSync(emptyDir);
  const cases: [string, (root: string) => void][] = [
    ['(a) 조각 폴더가 링크', (root) => symlinkSync(outDir, path.join(root, DIR), 'dir')],
    [
      '(b) 조각이 링크',
      (root) => {
        mkdirSync(path.join(root, DIR), { recursive: true });
        symlinkSync(path.join(outDir, '20261124-a.md'), path.join(root, A.rel));
      },
    ],
    [
      '(c) CHANGELOG가 링크',
      (root) => {
        write(root, A.rel, A.text);
        writeFileSync(outFile, read(root, CHANGELOG_PATH));
        unlinkSync(path.join(root, CHANGELOG_PATH));
        symlinkSync(outFile, path.join(root, CHANGELOG_PATH));
      },
    ],
    ['(d) 빈 폴더로 가는 링크', (root) => symlinkSync(emptyDir, path.join(root, DIR), 'dir')],
  ];
  for (const [name, make] of cases) {
    const root = repo([]);
    if (!tryLink(() => make(root))) continue;
    // 링크와 조각을 커밋해 두어도 같다(경계가 커밋 확인보다 먼저다)
    commitAll(root, 'links');
    const extra = [path.join(outDir, '20261124-a.md'), outFile];
    const before = snapshot(root, extra);
    const r = direct(root);
    assert.equal(r.code, 1, `${name}: ${r.out}`);
    assert.doesNotMatch(r.out, /모을 조각 없음/, name);
    assert.deepEqual(snapshot(root, extra), before, name);
    assert.ok(lstatSync(path.join(outDir, '20261124-a.md')).isFile(), name);
  }
  // (e) 커밋한 CHANGELOG를 리포 밖 파일과 하드 링크로 잇는다(내용은 HEAD와 같다)
  const root = repo([A]);
  const twin = path.join(outside, 'twin.md');
  if (tryLink(() => linkSync(path.join(root, CHANGELOG_PATH), twin))) {
    const before = snapshot(root, [twin]);
    const r = direct(root);
    assert.equal(r.code, 1, `(e) 하드 링크: ${r.out}`);
    assert.deepEqual(snapshot(root, [twin]), before);
  }
  // (f) 판정 F2: `docs`가 링크면 그 자리에서 멈추고 링크 너머의 `docs/harness`를 보지 않는다
  // (링크 너머의 harness는 파일이라, 계속 봤다면 그 문제도 출력에 나온다)
  const elsewhere = path.join(outside, 'docs-elsewhere');
  mkdirSync(elsewhere);
  writeFileSync(path.join(elsewhere, 'harness'), '파일\n');
  const linked = repo([]);
  sh('git', ['rm', '-r', '-q', '--cached', 'docs'], linked);
  const real = path.join(linked, 'docs');
  // 같은 임시 폴더 안에서 옮긴다(외부 실행 파일 `mv`에 기대지 않는다. 판정 F5: Windows 네이티브)
  renameSync(real, path.join(path.dirname(linked), 'docs-moved'));
  if (tryLink(() => symlinkSync(elsewhere, real, 'dir'))) {
    const r = direct(linked);
    assert.equal(r.code, 1, `(f) docs 링크: ${r.out}`);
    assert.match(r.out, /changes-collect: docs: /);
    assert.doesNotMatch(r.out, /docs\/harness: /);
    assert.equal(readFileSync(path.join(elsewhere, 'harness'), 'utf8'), '파일\n');
  }
});

test('changes-collect: 지우다 실패하면 1과 되돌리는 명령을 내고, 되돌리기 전에 다시 실행하면 막히며, 되돌린 뒤에는 한 번씩만 모은다', () => {
  const root = repo([A, B]);
  // 판정 F7: Windows Git의 기본값처럼 줄 끝을 CRLF로 꺼내는 설정에서도 되돌린 뒤 다시 모을 수 있다
  sh('git', ['config', 'core.autocrlf', 'true'], root);
  const first = direct(root, {
    fs: {
      unlink: (f: string) => {
        if (f.endsWith('20261124-b-s0.md')) throw new Error('지우기 막힘');
        unlinkSync(f);
      },
    },
  });
  assert.equal(first.code, 1, first.out);
  assert.match(first.out, /20261124-b-s0\.md/);
  assert.ok(first.out.includes(RESTORE), first.out);
  const after = snapshot(root);
  // 되돌리기 전에 다시 실행하면 커밋하지 않은 변경으로 막힌다(항목이 두 번 들어가지 않는다)
  const blocked = direct(root);
  assert.equal(blocked.code, 1, blocked.out);
  assert.deepEqual(snapshot(root), after);
  // 출력의 되돌리는 명령으로 되돌린 뒤 다시 실행한다
  sh('git', restoreArgs(first.out), root);
  const done = direct(root, { date: '2026-11-25' });
  assert.equal(done.code, 0, done.out);
  const changelog = read(root, CHANGELOG_PATH);
  for (const item of ['- a 하나', '- a 둘', '- b 하나'])
    assert.equal(changelog.split('\n').filter((l) => l === item).length, 1, item);
  assert.equal(read(root, DESIGN_PATH), FRONT + collectedDesign('2026-11-25'));
  assert.equal(existsSync(path.join(root, DIR)) ? readdirSync(path.join(root, DIR)).length : 0, 0);
  rmdirSync(path.join(root, DIR));

  // 판정 F6(P0): 검사 뒤에 다른 프로세스가 조각을 저장하면 그 조각을 지우지 않고 멈춘다.
  // 되돌리는 명령은 이 명령이 바꾸거나 지운 파일만 담아, 되돌려도 나중에 저장된 내용이 남는다
  const racedFrag = repo([A, B]);
  const newer = frag('20261124-b-s0', ['b 하나', 'b 둘(나중에 저장)'], ['b 설계 첫째']);
  let saved = false;
  const r1 = direct(racedFrag, {
    fs: {
      writeFile: (rel: string, t: string, fd: number) => {
        writeAll(fd, t);
        if (!saved && rel.endsWith('CHANGELOG.md')) {
          saved = true;
          writeFileSync(path.join(racedFrag, B.rel), newer);
        }
      },
    },
  });
  assert.equal(r1.code, 1, r1.out);
  assert.match(r1.out, /20261124-b-s0\.md: 읽은 뒤 바뀌었다/);
  assert.equal(read(racedFrag, B.rel), newer, '나중에 저장된 조각은 지우지 않는다');
  assert.doesNotMatch(restoreArgs(r1.out).join(' '), /20261124-b-s0/);
  sh('git', restoreArgs(r1.out), racedFrag);
  assert.equal(read(racedFrag, B.rel), newer, '되돌려도 나중에 저장된 내용이 남는다');
  assert.equal(read(racedFrag, A.rel), A.text);
  assert.equal(read(racedFrag, CHANGELOG_PATH), FRONT + changelogText());
  assert.equal(read(racedFrag, DESIGN_PATH), FRONT + designText());

  // 판정 F6(P0): 검사 뒤에 다른 프로세스가 CHANGELOG를 저장하면 덮어쓰지 않고 멈춘다(조각은 그대로)
  const racedLog = repo([A, B]);
  const concurrent = FRONT + changelogText(['있던 항목', '다른 세션이 더한 항목']);
  let once = false;
  const r2 = direct(racedLog, {
    fs: {
      writeFile: (rel: string, t: string, fd: number) => {
        if (!once && rel.endsWith('design.md')) {
          once = true;
          writeFileSync(path.join(racedLog, CHANGELOG_PATH), concurrent);
        }
        writeAll(fd, t);
      },
    },
  });
  assert.equal(r2.code, 1, r2.out);
  assert.match(r2.out, /CHANGELOG\.md: 읽은 뒤 바뀌었다/);
  assert.equal(
    read(racedLog, CHANGELOG_PATH),
    concurrent,
    '나중에 저장된 CHANGELOG를 덮어쓰지 않는다',
  );
  assert.equal(read(racedLog, A.rel), A.text);
  assert.equal(read(racedLog, B.rel), B.text);
  assert.deepEqual(restoreArgs(r2.out).slice(-1), [DESIGN_PATH]);
});

// Issue #257(PR #254 판정 F4, 계획 검증 F2~F7, 구현 판정 F10~F13, 계획 검증 F4·F13~F15): 시작 검사 뒤 쓰기·지우기
// 전에 기록 파일이나 상위 폴더가 링크(또는 하드 링크)로 바뀌거나 다른 세션이 저장하면, 링크 너머와 그 저장을 건드리지
// 않고 멈추며 되돌리는 명령은 이 명령이 남긴 그대로인 파일만 담는다. 경우마다 test 하나다(앞 경우가 실패해도 뒤 경우가
// 돈다). 시험용 고리(afterRead·beforeChange·beforeWrite)와 핸들에 쓰는 주입으로 확인과 변경 사이를 재현한다
/** 정한 파일의 결과를 핸들에 쓴 직후 한 번 swap한다 */
const afterWrite = (which: string, swap: () => void) => {
  let done = false;
  return {
    writeFile: (rel: string, t: string, fd: number) => {
      writeAll(fd, t);
      if (!done && rel.endsWith(which)) {
        done = true;
        swap();
      }
    },
  };
};
/** 되돌리는 명령의 경로들 */
const restorePaths = (out: string) => {
  const a = restoreArgs(out);
  return a.slice(a.indexOf('--') + 1);
};
const restoreLine = (out: string) => out.split('\n').find((l) => l.includes(RESTORE));
/** 고리를 정한 파일에서 한 번만 부른다 */
const once = (which: string, act: () => void) => {
  let done = false;
  return (rel: string) => {
    if (!done && rel === which) {
      done = true;
      act();
    }
  };
};
/** docs/harness 안의 임시 이름(새 파일이면 new-) 가운데 그 이름으로 끝나는 것 */
const tempOf = (root: string, name: string, fresh: boolean) =>
  readdirSync(path.join(root, 'docs/harness')).find(
    (n) => n.startsWith('.collect-') && n.endsWith(name) && n.includes('-new-') === fresh,
  );
/** 심볼릭 링크를 만들 수 있는 환경인가(아니면 링크 경우를 건너뛴다) */
const canLink = (() => {
  const probe = tmp();
  writeFileSync(path.join(probe, 'f'), '');
  return tryLink(() => symlinkSync(path.join(probe, 'f'), path.join(probe, 'l')));
})();

test(
  'changes-collect #257 (가): CHANGELOG를 쓰기 전에 같은 바이트의 리포 밖 파일로 가는 링크로 바꾸면 쓰지 않는다(O_NOFOLLOW를 꺼도)',
  { skip: !canLink },
  () => {
    // (가) 설계서를 쓴 직후 CHANGELOG를 같은 바이트의 리포 밖 파일로 가는 링크로 바꾼다.
    // O_NOFOLLOW를 끈 경우(Windows 경로)도 식별자가 달라 쓰지 않는다
    for (const noFollow of [true, false]) {
      const root = repo([A, B]);
      const cl = path.join(root, CHANGELOG_PATH);
      const same = readFileSync(cl);
      const outFile = path.join(tmp(), 'CHANGELOG.md');
      writeFileSync(outFile, same);
      const fs = afterWrite('design.md', () => {
        unlinkSync(cl);
        symlinkSync(outFile, cl);
      });
      const r = direct(root, noFollow ? { fs } : { fs, noFollow: false });
      const name = `(가) noFollow=${noFollow}`;
      assert.equal(r.code, 1, `${name}: ${r.out}`);
      assert.match(r.out, /CHANGELOG\.md: 처음 검사한 그 파일이 아니다/, name);
      assert.ok(readFileSync(outFile).equals(same), `${name}: 리포 밖 파일은 그대로다`);
      assert.deepEqual(restorePaths(r.out), [DESIGN_PATH], name);
      assert.equal(read(root, A.rel), A.text, name);
      assert.equal(read(root, B.rel), B.text, name);
    }
  },
);

test(
  'changes-collect #257 (나): 쓰는 동안 docs/harness를 리포 밖 사본 폴더로 가는 링크로 바꾸면 사본을 건드리지 않고 자동으로 되돌리지 않는다',
  { skip: !canLink },
  () => {
    // (나) 설계서를 쓰는 동안 docs/harness를 옆으로 옮기고, 같은 바이트의 사본이 든 리포 밖 폴더로 가는 링크를 둔다.
    // 작업 폴더가 확인한 폴더 자체라 리포 밖 사본은 그대로이고, 끝난 뒤 폴더 확인으로 멈춘다. 바꾼 파일은 폴더가 바뀌어
    // 자동으로 되돌리지 않는다(설계서는 쓰는 동안 임시 이름에 있어 사본을 만들지 않는다)
    {
      const root = repo([A, B]);
      const outDir = path.join(tmp(), 'harness');
      const copies: [string, Buffer][] = [];
      const fs = afterWrite('design.md', () => {
        const real = path.join(root, 'docs/harness');
        for (const rel of ['CHANGELOG.md', 'changes/20261124-a.md', 'changes/20261124-b-s0.md']) {
          const to = path.join(outDir, ...rel.split('/'));
          mkdirSync(path.dirname(to), { recursive: true });
          const b = readFileSync(path.join(real, ...rel.split('/')));
          writeFileSync(to, b);
          copies.push([to, b]);
        }
        renameSync(real, path.join(root, 'docs/harness-moved'));
        symlinkSync(outDir, real, 'dir');
      });
      const r = direct(root, { fs });
      assert.equal(r.code, 1, `(나): ${r.out}`);
      assert.match(r.out, /docs\/harness: 처음 검사한 그 폴더가 아니다/);
      assert.match(r.out, /제자리/);
      assert.equal(copies.length, 3);
      for (const [to, b] of copies) assert.ok(readFileSync(to).equals(b), `(나) 리포 밖 ${to}`);
      assert.doesNotMatch(r.out, /되돌리는 명령: /, '(나) 폴더가 바뀌어 자동으로 되돌리지 않는다');
      assert.match(
        r.out,
        /자동으로 되돌리지 않는 파일: docs\/harness\/design\.md, docs\/harness\/CHANGELOG\.md\(/,
      );
    }
  },
);

test('changes-collect #257 (다): 설계서를 쓴 뒤 CHANGELOG에 리포 밖 하드 링크가 생기면 쓰지 않는다', () => {
  // (다) 설계서를 쓴 직후 CHANGELOG에 리포 밖 이름의 하드 링크를 더한다(하드 링크는 Windows에서도 만든다)
  {
    const root = repo([A, B]);
    const cl = path.join(root, CHANGELOG_PATH);
    const same = readFileSync(cl);
    const twin = path.join(tmp(), 'twin.md');
    let made = false;
    let called = false;
    const fs = afterWrite('design.md', () => {
      called = true;
      made = tryLink(() => linkSync(cl, twin));
    });
    const r = direct(root, { fs });
    assert.ok(called, `(다) 고리가 불렸다: ${r.out}`);
    if (made) {
      assert.equal(r.code, 1, `(다): ${r.out}`);
      assert.match(r.out, /CHANGELOG\.md: 처음 검사한 그 파일이 아니다/);
      assert.ok(readFileSync(twin).equals(same), '(다) 리포 밖 이름의 바이트는 그대로다');
      assert.deepEqual(restorePaths(r.out), [DESIGN_PATH]);
    }
  }
});

test(
  'changes-collect #257 (라): CHANGELOG를 쓰는 동안 조각 폴더를 리포 밖 폴더로 가는 링크로 바꾸면 리포 밖 조각을 지우지 않는다',
  { skip: !canLink },
  () => {
    // (라) CHANGELOG를 쓴 직후 조각 폴더를 옆으로 옮기고, 같은 이름·바이트의 조각이 든 리포 밖 폴더로 가는 링크를 둔다
    {
      const root = repo([A, B]);
      const outDir = path.join(tmp(), 'changes');
      const fs = afterWrite('CHANGELOG.md', () => {
        const real = path.join(root, DIR);
        mkdirSync(outDir);
        for (const f of [A, B]) writeFileSync(path.join(outDir, path.basename(f.rel)), f.text);
        renameSync(real, path.join(root, 'docs/harness/changes-moved'));
        symlinkSync(outDir, real, 'dir');
      });
      const r = direct(root, { fs });
      assert.equal(r.code, 1, `(라): ${r.out}`);
      assert.match(r.out, /docs\/harness\/changes: 처음 검사한 그 폴더가 아니다/);
      for (const f of [A, B])
        assert.equal(
          readFileSync(path.join(outDir, path.basename(f.rel)), 'utf8'),
          f.text,
          `(라) 리포 밖 조각 ${f.rel}은 지우지 않는다`,
        );
      assert.deepEqual(restorePaths(r.out), [DESIGN_PATH, CHANGELOG_PATH]);
    }
  },
);

test(
  'changes-collect #257 (마): CHANGELOG를 확인한 뒤 옮기기 직전에 링크로 바꾸면 링크로 돌려놓고 쓰지 않는다',
  { skip: !canLink },
  () => {
    // (마) CHANGELOG를 이름으로 확인한 뒤 옮기기 직전에 그 경로를 같은 바이트의 리포 밖 파일로 가는 링크로 바꾼다.
    // 옮긴 것을 다시 보면 링크라 제자리로 돌려놓고 멈춘다. 리포 밖 파일은 그대로다(경로로 쓰면 리포 밖 파일이 바뀐다)
    {
      const root = repo([A, B]);
      const cl = path.join(root, CHANGELOG_PATH);
      const same = readFileSync(cl);
      const outFile = path.join(tmp(), 'CHANGELOG.md');
      writeFileSync(outFile, same);
      const beforeChange = once(CHANGELOG_PATH, () => {
        unlinkSync(cl);
        symlinkSync(outFile, cl);
      });
      const r = direct(root, { hooks: { beforeChange } });
      assert.equal(r.code, 1, `(마): ${r.out}`);
      assert.match(r.out, /CHANGELOG\.md: 처음 검사한 그 파일이 아니다/);
      assert.ok(readFileSync(outFile).equals(same), '(마) 리포 밖 파일은 그대로다');
      assert.deepEqual(restorePaths(r.out), [DESIGN_PATH]);
      assert.ok(lstatSync(cl).isSymbolicLink(), '(마) CHANGELOG 경로는 링크로 돌려놓아진다');
      assert.equal(read(root, A.rel), A.text);
    }
  },
);

test('changes-collect #257 (바): 읽은 직후 제자리에서 저장한 조각은 지우지 않고, 모으기는 처음 읽은 바이트로 한다', () => {
  // (바) 조각 B를 읽은 직후 제자리에서 다른 내용으로 저장한다. 한 번 읽은 바이트로 HEAD 확인과 모으기를 하므로
  // 지우기 직전에 바뀐 것이 걸려 B를 지우지 않는다(나중에 저장한 내용이 남고, 되돌리기 목록에 B가 없다)
  {
    const root = repo([A, B]);
    const newer = frag('20261124-b-s0', ['b 하나', 'b 둘(읽은 뒤 저장)'], ['b 설계 첫째']);
    const afterRead = once(B.rel, () => writeFileSync(path.join(root, B.rel), newer));
    const r = direct(root, { hooks: { afterRead } });
    assert.equal(r.code, 1, `(바): ${r.out}`);
    assert.match(r.out, /20261124-b-s0\.md: 읽은 뒤 바뀌었다/);
    assert.equal(read(root, B.rel), newer, '(바) 나중에 저장한 조각은 지우지 않는다');
    // 모으기는 처음 읽은 바이트로 했다: CHANGELOG에 B의 처음 항목만 있고 나중 항목은 없다
    const cl = read(root, CHANGELOG_PATH);
    assert.match(cl, /^- b 하나$/m);
    assert.doesNotMatch(cl, /읽은 뒤 저장/);
    assert.deepEqual(restorePaths(r.out), [DESIGN_PATH, CHANGELOG_PATH, A.rel]);
    sh('git', restoreArgs(r.out), root);
    assert.equal(read(root, B.rel), newer, '(바) 되돌려도 나중에 저장한 내용이 남는다');
  }
});

test(
  'changes-collect #257 (사): 조각을 확인한 뒤 조각 폴더를 리포 밖 폴더로 가는 링크로 바꿔도 작업 폴더 안에서 지워 리포 밖 조각이 남는다',
  { skip: !canLink },
  () => {
    // (사) 조각 A를 지우기 직전에 조각 폴더를 옆으로 옮기고 같은 이름·바이트의 조각이 든 리포 밖 폴더로 가는 링크를 둔다.
    // 작업 폴더가 확인한 폴더 자체라 리포 밖 조각은 남고, 끝난 뒤 폴더 확인으로 멈춘다
    {
      const root = repo([A, B]);
      const outDir = path.join(tmp(), 'changes');
      let moved = true;
      const beforeChange = once(A.rel, () => {
        mkdirSync(outDir);
        for (const f of [A, B]) writeFileSync(path.join(outDir, path.basename(f.rel)), f.text);
        try {
          renameSync(path.join(root, DIR), path.join(root, 'docs/harness/changes-moved'));
        } catch (e) {
          // Windows는 작업 폴더인 폴더를 옮기지 못한다(그것으로 이 경쟁도 일어나지 않는다)
          if (process.platform === 'win32') {
            moved = false;
            return;
          }
          throw e;
        }
        symlinkSync(outDir, path.join(root, DIR), 'dir');
      });
      const r = direct(root, { hooks: { beforeChange } });
      if (moved) {
        assert.equal(r.code, 1, `(사): ${r.out}`);
        assert.match(r.out, /docs\/harness\/changes: 처음 검사한 그 폴더가 아니다/);
        for (const f of [A, B])
          assert.equal(
            readFileSync(path.join(outDir, path.basename(f.rel)), 'utf8'),
            f.text,
            `(사) 리포 밖 조각 ${f.rel}은 지우지 않는다`,
          );
        assert.deepEqual(restorePaths(r.out), [DESIGN_PATH, CHANGELOG_PATH]);
        assert.match(r.out, new RegExp(`자동으로 되돌리지 않는 파일: ${A.rel}, ${B.rel}\\(`));
      }
    }
  },
);

test(
  'changes-collect #257 (아): 마지막 읽기 직후 설계서를 링크로 바꾸면 아무것도 바꾸지 않는다',
  { skip: !canLink },
  () => {
    // (아) 마지막 읽기 직후 설계서를 같은 바이트의 리포 밖 파일로 가는 링크로 바꾼다. 아무것도 바꾸지 않고 멈춘다
    {
      const root = repo([A, B]);
      const dp = path.join(root, DESIGN_PATH);
      const same = readFileSync(dp);
      const outFile = path.join(tmp(), 'design.md');
      writeFileSync(outFile, same);
      const afterRead = once(B.rel, () => {
        unlinkSync(dp);
        symlinkSync(outFile, dp);
      });
      const r = direct(root, { hooks: { afterRead } });
      assert.equal(r.code, 1, `(아): ${r.out}`);
      assert.match(r.out, /design\.md: 처음 검사한 그 파일이 아니다/);
      assert.match(r.out, /아무 파일도 바꾸지 않았다/);
      assert.equal(restoreLine(r.out), undefined, '(아) 되돌리는 명령이 없다');
      assert.ok(readFileSync(outFile).equals(same), '(아) 리포 밖 파일은 그대로다');
      assert.equal(read(root, CHANGELOG_PATH), FRONT + changelogText());
    }
  },
);

test('changes-collect #257 (자): CHANGELOG를 새 파일에 쓰다가 실패하면 원래 파일을 돌려놓고 목록에 넣지 않는다', () => {
  // (자) CHANGELOG를 새 파일에 쓰다가 실패한다. 원래 파일을 제자리로 돌려놓아 CHANGELOG는 그대로이고 목록에 없다
  {
    const root = repo([A, B]);
    const r = direct(root, {
      fs: {
        writeFile: (rel: string, t: string, fd: number) => {
          if (rel.endsWith('CHANGELOG.md')) {
            ftruncateSync(fd, 0);
            throw new Error('쓰기 막힘');
          }
          writeAll(fd, t);
        },
      },
    });
    assert.equal(r.code, 1, `(자): ${r.out}`);
    assert.match(r.out, /CHANGELOG\.md 쓰기 실패: 쓰기 막힘/);
    assert.deepEqual(restorePaths(r.out), [DESIGN_PATH]);
    assert.equal(read(root, CHANGELOG_PATH), FRONT + changelogText());
    // 새 파일은 지우지 않고 남긴 임시 파일로 알린다(계획 검증 F19). 원래 파일의 임시 이름은 남지 않는다
    const left = readdirSync(path.join(root, 'docs/harness')).filter((n) =>
      n.startsWith('.collect-'),
    );
    assert.equal(left.length, 1, r.out);
    assert.ok(left[0].includes('-new-'), left[0]);
    assert.ok(r.out.includes(`남긴 임시 파일: docs/harness/${left[0]}`), r.out);
    assert.equal(read(root, A.rel), A.text);
  }
});

test('changes-collect #257 (자2): 새 파일 열기가 실패하면(그 이름을 다른 프로세스가 먼저 만들었다) 그 파일을 지우지 않고 원래 파일을 돌려놓는다', () => {
  const root = repo([A, B]);
  const original = read(root, CHANGELOG_PATH);
  let taken = '';
  const r = direct(root, {
    fs: {
      openNew: (name: string, flags: number, mode: number) => {
        if (!taken && name.endsWith('CHANGELOG.md')) {
          taken = name;
          writeFileSync(name, '다른 프로세스가 먼저 만든 파일\n');
        }
        return openSync(name, flags, mode);
      },
    },
  });
  assert.equal(r.code, 1, `(자2): ${r.out}`);
  assert.match(r.out, /CHANGELOG\.md 쓰기 실패: EEXIST/);
  assert.equal(read(root, CHANGELOG_PATH), original, '(자2) CHANGELOG는 원래 바이트로 돌아온다');
  assert.deepEqual(restorePaths(r.out), [DESIGN_PATH]);
  assert.ok(taken, '(자2) 열기 주입이 불렸다');
  assert.equal(
    read(root, `docs/harness/${taken}`),
    '다른 프로세스가 먼저 만든 파일\n',
    '(자2) 먼저 있던 파일은 지우지 않는다',
  );
});

test('changes-collect #257 (카): 지우기가 실패하고 원래 이름에 새 조각이 저장되면 원래 바이트를 임시 이름에 남기고 목록에서 뺀다', () => {
  // (카)
  const root = repo([A, B]);
  const newer = frag('20261124-a', ['a 하나', 'a 둘', 'a 셋(지우기 실패 사이 저장)']);
  const r = direct(root, {
    fs: {
      unlink: (f: string) => {
        if (f.endsWith('20261124-a.md')) {
          writeFileSync(path.join(root, A.rel), newer);
          throw new Error('지우기 막힘');
        }
        unlinkSync(f);
      },
    },
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /20261124-a\.md: 확인이 어긋나 제자리로 돌려놓으려 했으나 못 해/);
  const left = readdirSync(path.join(root, DIR)).filter((n) => n.startsWith('.collect-'));
  assert.equal(left.length, 1, r.out);
  assert.ok(r.out.includes(`${DIR}/${left[0]}`), '임시 이름의 경로를 알린다');
  assert.equal(read(root, `${DIR}/${left[0]}`), A.text, '원래 바이트는 임시 이름에 남는다');
  const a = restoreArgs(r.out);
  assert.deepEqual(a.slice(a.indexOf('--') + 1), [DESIGN_PATH, CHANGELOG_PATH]);
  sh('git', a, root);
  assert.equal(read(root, A.rel), newer, '되돌려도 새 조각이 남는다');
});

test('changes-collect #257 (타): 255바이트 이름의 조각도 끝까지 모은다', () => {
  // (타) 255바이트 이름의 조각(만들 수 없는 환경이면 건너뛴다)
  const stem = `20261124-${'a'.repeat(255 - '20261124-'.length - '.md'.length)}`;
  const long = { rel: `${DIR}/${stem}.md`, text: frag(stem, ['긴 이름 조각']) };
  let longRoot = '';
  try {
    longRoot = repo([A, long]);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENAMETOOLONG' && code !== 'ENOENT') throw e;
  }
  if (longRoot) {
    const done = direct(longRoot, { date: '2026-11-25' });
    assert.equal(done.code, 0, done.out);
    assert.deepEqual(readdirSync(path.join(longRoot, DIR)), []);
    assert.match(read(longRoot, CHANGELOG_PATH), /- 긴 이름 조각/);
  }
});

test('changes-collect #257 (파): CHANGELOG를 확인한 뒤 옮기기 직전에 리포 밖 하드 링크가 생기면 쓰지 않는다', () => {
  // (파) CHANGELOG를 이름으로 확인한 뒤 옮기기 직전에 리포 밖 이름의 하드 링크를 더한다
  {
    const root = repo([A, B]);
    const cl = path.join(root, CHANGELOG_PATH);
    const same = readFileSync(cl);
    const twin = path.join(tmp(), 'twin.md');
    let made = false;
    let called = false;
    const r = direct(root, {
      hooks: {
        beforeChange: (rel: string) => {
          if (called || rel !== CHANGELOG_PATH) return;
          called = true;
          made = tryLink(() => linkSync(cl, twin));
        },
      },
    });
    assert.ok(called, `(파) 고리가 불렸다: ${r.out}`);
    if (made) {
      assert.equal(r.code, 1, `(파): ${r.out}`);
      assert.match(r.out, /CHANGELOG\.md: 처음 검사한 그 파일이 아니다/);
      assert.ok(readFileSync(twin).equals(same), '(파) 리포 밖 이름의 바이트는 그대로다');
      assert.deepEqual(restorePaths(r.out), [DESIGN_PATH]);
    }
  }
});

test('changes-collect #257 (하): 새 파일에 쓰는 동안 다른 세션이 같은 이름으로 저장하면 게시하지 않고 그 저장을 남긴다', () => {
  // (하) CHANGELOG를 새 파일에 쓰는 동안 다른 세션이 CHANGELOG 이름으로 새 파일을 저장한다
  {
    const root = repo([A, B]);
    const original = read(root, CHANGELOG_PATH);
    const other = FRONT + changelogText(['있던 항목', '다른 세션이 게시 사이에 저장']);
    const r = direct(root, {
      fs: {
        writeFile: (rel: string, t: string, fd: number) => {
          writeAll(fd, t);
          if (rel.endsWith('CHANGELOG.md')) writeFileSync(path.join(root, CHANGELOG_PATH), other);
        },
      },
    });
    assert.equal(r.code, 1, `(하): ${r.out}`);
    assert.match(
      r.out,
      /CHANGELOG\.md: 그 사이 다른 세션이 이 이름으로 새 파일을 저장해 결과를 쓰지 않았다/,
    );
    assert.equal(read(root, CHANGELOG_PATH), other, '(하) 다른 세션의 저장이 남는다');
    const m = /원래 파일은 (docs\/harness\/\.collect-[^ ]+)에 남겼다/.exec(r.out);
    assert.ok(m, r.out);
    assert.equal(read(root, m[1]), original, '(하) 원래 파일은 임시 이름에 남는다');
    const fresh = tempOf(root, 'CHANGELOG.md', true);
    assert.ok(fresh, '(하) 결과를 쓴 새 파일도 임시 이름에 남는다');
    assert.ok(r.out.includes(`남긴 임시 파일: docs/harness/${fresh}`), r.out);
    assert.deepEqual(restorePaths(r.out), [DESIGN_PATH]);
  }
});

test('changes-collect #257 (거): 게시 뒤 다른 세션이 새 파일로 바꿔 저장하면 되돌리는 명령에서 뺀다', () => {
  // (거) CHANGELOG를 게시한 뒤 조각 A를 확인한 직후 다른 세션이 CHANGELOG를 새 파일로 바꿔 저장하고, A의 지우기가 실패한다
  {
    const root = repo([A, B]);
    const other = FRONT + changelogText(['다른 세션이 게시 뒤에 저장']);
    let done = false;
    const r = direct(root, {
      hooks: {
        beforeChange: (rel: string) => {
          if (done || rel !== A.rel) return;
          done = true;
          const saving = path.join(root, 'docs/harness/saving.tmp');
          writeFileSync(saving, other);
          renameSync(saving, path.join(root, CHANGELOG_PATH));
        },
      },
      fs: {
        unlink: (f: string) => {
          if (f.endsWith('20261124-a.md')) throw new Error('지우기 막힘');
          unlinkSync(f);
        },
      },
    });
    assert.equal(r.code, 1, `(거): ${r.out}`);
    assert.match(r.out, /20261124-a\.md 지우기 실패: 지우기 막힘/);
    assert.deepEqual(restorePaths(r.out), [DESIGN_PATH], '(거) 되돌리는 명령에 CHANGELOG가 없다');
    assert.match(r.out, /자동으로 되돌리지 않는 파일: docs\/harness\/CHANGELOG\.md\(/);
    sh('git', restoreArgs(r.out), root);
    assert.equal(read(root, CHANGELOG_PATH), other, '(거) 되돌려도 다른 세션의 저장이 남는다');
    assert.equal(read(root, A.rel), A.text);
  }
});

test('changes-collect #257 (거2): 게시 뒤 다른 세션이 제자리에서 저장하면 되돌리는 명령에서 뺀다', () => {
  // (거2) (거)와 같되 다른 세션이 게시된 CHANGELOG를 제자리에서(같은 inode) 다른 내용으로 저장한다
  {
    const root = repo([A, B]);
    const other = FRONT + changelogText(['다른 세션이 게시 뒤 제자리에 저장']);
    let done = false;
    const r = direct(root, {
      hooks: {
        beforeChange: (rel: string) => {
          if (done || rel !== A.rel) return;
          done = true;
          writeFileSync(path.join(root, CHANGELOG_PATH), other);
        },
      },
      fs: {
        unlink: (f: string) => {
          if (f.endsWith('20261124-a.md')) throw new Error('지우기 막힘');
          unlinkSync(f);
        },
      },
    });
    assert.equal(r.code, 1, `(거2): ${r.out}`);
    assert.deepEqual(restorePaths(r.out), [DESIGN_PATH], '(거2) 되돌리는 명령에 CHANGELOG가 없다');
    assert.match(r.out, /자동으로 되돌리지 않는 파일: docs\/harness\/CHANGELOG\.md\(/);
    sh('git', restoreArgs(r.out), root);
    assert.equal(read(root, CHANGELOG_PATH), other, '(거2) 되돌려도 제자리 저장이 남는다');
  }
});

test(
  'changes-collect #257 (너): 새 파일을 연 뒤 쓰기 전에 그 이름을 리포 밖 링크로 바꿔도 핸들로 써서 리포 밖 파일이 그대로다',
  { skip: !canLink },
  () => {
    // (너) CHANGELOG의 새 파일을 연 뒤 쓰기 직전에 그 이름을 리포 밖 파일로 가는 링크로 바꾼다(기본 쓰기).
    // 핸들로 쓰므로 리포 밖 파일은 그대로이고, 새 파일 이름이 바뀌어 게시하지 않는다(경로로 쓰면 리포 밖 파일이 바뀐다)
    const root = repo([A, B]);
    const original = read(root, CHANGELOG_PATH);
    const outFile = path.join(tmp(), 'outside.md');
    writeFileSync(outFile, '리포 밖\n');
    let done = false;
    const r = direct(root, {
      hooks: {
        beforeWrite: (rel: string) => {
          if (done || rel !== CHANGELOG_PATH) return;
          done = true;
          const fresh = tempOf(root, 'CHANGELOG.md', true);
          assert.ok(fresh, '(너) 새 파일이 있다');
          const at = path.join(root, 'docs/harness', fresh);
          unlinkSync(at);
          symlinkSync(outFile, at);
        },
      },
    });
    assert.equal(r.code, 1, `(너): ${r.out}`);
    assert.match(r.out, /CHANGELOG\.md: 결과를 쓴 새 파일\(.*\)이 그 사이 바뀌어 게시하지 않았다/);
    assert.equal(readFileSync(outFile, 'utf8'), '리포 밖\n', '(너) 리포 밖 파일은 그대로다');
    assert.equal(read(root, CHANGELOG_PATH), original, '(너) CHANGELOG는 그대로다');
    assert.deepEqual(restorePaths(r.out), [DESIGN_PATH]);
  },
);

test('changes-collect #257 (파2): 새 파일에 쓰는 동안 옮겨 둔 원래 파일에 리포 밖 하드 링크가 생겨도 원래 inode에 쓰지 않는다', () => {
  // (파2) CHANGELOG의 새 파일에 쓰는 동안, 임시 이름에 옮겨 둔 원래 파일에 리포 밖 이름의 하드 링크를 더한다.
  // 원래 inode에는 쓰지 않으므로 모으기는 끝나고 리포 밖 이름의 바이트는 원래 그대로다(원래 inode에 쓰면 바뀐다)
  {
    const root = repo([A, B]);
    const original = readFileSync(path.join(root, CHANGELOG_PATH));
    const twin = path.join(tmp(), 'twin2.md');
    let made = false;
    let called = false;
    const r = direct(root, {
      fs: {
        writeFile: (rel: string, t: string, fd: number) => {
          writeAll(fd, t);
          if (called || rel !== CHANGELOG_PATH) return;
          called = true;
          const parked = tempOf(root, 'CHANGELOG.md', false);
          assert.ok(parked, '(파2) 임시 이름의 원래 파일이 있다');
          made = tryLink(() => linkSync(path.join(root, 'docs/harness', parked), twin));
        },
      },
    });
    assert.ok(called, `(파2) 주입한 쓰기가 불렸다: ${r.out}`);
    if (made) {
      assert.equal(r.code, 0, `(파2): ${r.out}`);
      assert.ok(readFileSync(twin).equals(original), '(파2) 리포 밖 이름의 바이트는 원래 그대로다');
      assert.match(read(root, CHANGELOG_PATH), /^- a 하나$/m);
    }
  }
});

// Issue #257 계획 검증 F5: 조각의 확인과 지우기 사이에 다른 세션이 같은 이름으로 저장하면(편집기의 원자적 저장)
// 새 파일을 지우지 않고 제자리에 남긴 채 멈춘다. 되돌리기 목록에 없고, 임시 이름 파일도 남지 않는다
test('changes-collect #257 (차): 조각을 확인한 뒤 같은 이름으로 새 파일이 저장되면 그 파일을 지우지 않고 1이다', () => {
  const root = repo([A, B]);
  const newer = frag('20261124-a', ['a 하나', 'a 둘', 'a 셋(확인 뒤 저장)']);
  let done = false;
  const r = direct(root, {
    hooks: {
      beforeChange: (rel: string) => {
        if (done || rel !== A.rel) return;
        done = true;
        const saving = path.join(root, DIR, 'saving.tmp');
        writeFileSync(saving, newer);
        renameSync(saving, path.join(root, A.rel));
      },
    },
  });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /20261124-a\.md: 처음 검사한 그 파일이 아니다/);
  assert.equal(read(root, A.rel), newer, '확인 뒤 저장한 조각은 지우지 않는다');
  assert.deepEqual(readdirSync(path.join(root, DIR)).sort(), ['20261124-a.md', '20261124-b-s0.md']);
  const a = restoreArgs(r.out);
  assert.deepEqual(a.slice(a.indexOf('--') + 1), [DESIGN_PATH, CHANGELOG_PATH]);
  sh('git', a, root);
  assert.equal(read(root, A.rel), newer, '되돌려도 확인 뒤 저장한 내용이 남는다');
  assert.equal(read(root, B.rel), B.text);
});

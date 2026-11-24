// 변경 조각 모으기(TD-39, Issue #222): 모으기 계산(collectFragments)과 명령(changes-collect).
// 조각을 이름 차례로 읽어 CHANGELOG "다음 버전 (미배포)" 끝과 설계서 변경 이력 끝으로 옮기고 조각 파일을 지운다.
// 문제가 하나라도 있으면 아무 파일도 쓰지 않는다. 계획 20261123-change-fragments step1.
import assert from 'node:assert/strict';
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
  write(root, DESIGN_PATH, FRONT + designText());
  write(root, CHANGELOG_PATH, FRONT + changelogText());
  for (const f of fragments) write(root, f.rel, f.text);
  commitAll(root, 'base');
  return root;
}
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
});

test('changes-collect: 지우다 실패하면 1과 되돌리는 명령을 내고, 되돌리기 전에 다시 실행하면 막히며, 되돌린 뒤에는 한 번씩만 모은다', () => {
  const root = repo([A, B]);
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
  const line = first.out.split('\n').find((l) => l.includes(RESTORE)) ?? '';
  const args = line.slice(line.indexOf(RESTORE)).trim().replace(/`/g, '').split(/\s+/).slice(1);
  sh('git', args, root);
  const done = direct(root, { date: '2026-11-25' });
  assert.equal(done.code, 0, done.out);
  const changelog = read(root, CHANGELOG_PATH);
  for (const item of ['- a 하나', '- a 둘', '- b 하나'])
    assert.equal(changelog.split('\n').filter((l) => l === item).length, 1, item);
  assert.equal(read(root, DESIGN_PATH), FRONT + collectedDesign('2026-11-25'));
  assert.equal(existsSync(path.join(root, DIR)) ? readdirSync(path.join(root, DIR)).length : 0, 0);
  rmdirSync(path.join(root, DIR));
});

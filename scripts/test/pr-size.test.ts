// pr-size(R15, 10.2절 (1))와 경고 판정의 틀을 본다(Issue #186 step0, TD-6).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { gatesOutput, isWarning, runGates, summaryMarkdown } from '../ci/gates.ts';
import {
  fitWarnings,
  GATE_CONTEXTS,
  RECORDED_CONTEXTS,
  RESULTS_MAX_BYTES,
  resultsBytes,
  serializeResults,
  toStatuses,
  validateResults,
  WARN_CONTEXTS,
  WARN_DETAILS_DROPPED,
  type GateResult,
  type GateResults,
} from '../ci/results.ts';
import { changedLines, prSize, prSizeOf } from '../gates/pr-size.ts';
import {
  ConfigError,
  DEFAULT_PR_SIZE,
  loadConfig,
  resolvePrSize,
  type HarnessConfig,
} from '../lib/config.ts';
import {
  capDetails,
  detailBytes,
  DETAIL_LINE_MAX,
  DETAILS_CUT,
  DETAILS_MAX_BYTES,
  WARN_PREFIX,
} from '../lib/util.ts';
import { HARNESS_ROOT, commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

const BRANCH = 'feat/20261122-demo-s0';
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}\n`).join('');

type Files = Record<string, string | Buffer | null>;

/** base 커밋(`baseFiles`)과 PR 브랜치의 커밋(`files`. null은 삭제)을 둔 리포 */
function repo(
  files: Files,
  o: { baseFiles?: Record<string, string>; cfg?: Record<string, unknown> } = {},
): { root: string; base: string; head: string; cfg: HarnessConfig } {
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig(o.cfg ?? {})));
  for (const [f, c] of Object.entries(o.baseFiles ?? {})) write(root, f, c);
  const base = commitAll(root, 'init');
  const cfg = loadConfig(root);
  sh('git', ['checkout', '-q', '-b', BRANCH], root);
  for (const [f, c] of Object.entries(files)) {
    if (c === null) sh('git', ['rm', '-q', f], root);
    else write(root, f, c as string);
  }
  const head = commitAll(root, 'change');
  return { root, base, head, cfg };
}

const byPath = (r: ReturnType<typeof changedLines>) =>
  Object.fromEntries(r.map((f) => [f.path, f]));

test('changedLines: 추가·수정·삭제·바이너리·이름 바꾸기를 파일별 줄 수로 돌려준다', () => {
  const r = repo(
    {
      'new.ts': lines(3),
      'edit.ts': 'a\nB\nc\nd\n',
      'gone.ts': null,
      'img.bin': Buffer.from([0, 1, 2, 0, 255]),
      'old-name.ts': null,
      'new-name.ts': lines(5),
    },
    { baseFiles: { 'edit.ts': 'a\nb\nc\n', 'gone.ts': lines(4), 'old-name.ts': lines(5) } },
  );
  const got = byPath(changedLines(r.root, r.base));
  assert.deepEqual(got['new.ts'], { path: 'new.ts', lines: 3, binary: false });
  // 한 줄을 고치고 한 줄을 더했다: 추가 2 + 삭제 1
  assert.deepEqual(got['edit.ts'], { path: 'edit.ts', lines: 3, binary: false });
  assert.deepEqual(got['gone.ts'], { path: 'gone.ts', lines: 4, binary: false });
  assert.deepEqual(got['img.bin'], { path: 'img.bin', lines: 0, binary: true });
  // 이름 바꾸기는 삭제와 추가 두 건이다
  assert.deepEqual(got['old-name.ts'], { path: 'old-name.ts', lines: 5, binary: false });
  assert.deepEqual(got['new-name.ts'], { path: 'new-name.ts', lines: 5, binary: false });
  assert.equal(Object.keys(got).length, 6);
  assert.throws(() => changedLines(r.root, 'f'.repeat(40)));
});

test('prSize: 상한과 같으면 통과이고, 하나라도 넘으면 경고다(state는 늘 success)', () => {
  const at = repo({ 'src/a.ts': lines(10) }, { cfg: { prSize: { maxLines: 10 } } });
  const same = prSize(at);
  assert.equal(same.state, 'success');
  assert.equal(same.over, false);
  assert.equal(same.lines, 10);
  assert.equal(same.description, '통과 (변경 10줄 / 상한 10줄)');

  const over = prSize(repo({ 'src/a.ts': lines(11) }, { cfg: { prSize: { maxLines: 10 } } }));
  assert.equal(over.state, 'success');
  assert.equal(over.over, true);
  assert.equal(over.lines, 11);
  assert.ok(over.description.startsWith(WARN_PREFIX), over.description);
  assert.ok(over.description.includes('11') && over.description.includes('10'), over.description);
  assert.equal(WARN_PREFIX, '경고: ');
});

test('prSize: 문서·테스트·생성 파일·lockfile·바이너리는 세지 않는다', () => {
  const files: Files = {
    'README.md': lines(100),
    'docs/a.txt': lines(100),
    'src/a.test.ts': lines(100),
    'scripts/test/x.ts': lines(100),
    'src/generated/x.ts': lines(100),
    'pnpm-lock.yaml': lines(100),
    'img.bin': Buffer.from([0, 1, 2, 0, 255]),
    'src/a.ts': lines(7),
    'scripts/gates/x.ts': lines(5),
  };
  const r = prSize(repo(files));
  assert.equal(r.lines, 12);
  assert.equal(r.over, false);
  assert.ok(r.details[0].includes('2') && r.details[0].includes('7'), r.details[0]);

  // exclude를 주면 그 목록이 기본 목록을 대신한다. lockfile은 그래도 세지 않는다
  const own = prSize(repo(files, { cfg: { prSize: { exclude: ['src/**'] } } }));
  // README 100 + docs/a.txt 100 + scripts/test/x.ts 100 + scripts/gates/x.ts 5
  assert.equal(own.lines, 305);
  // 빈 목록이면 lockfile과 바이너리만 뺀다
  const none = prSize(repo(files, { cfg: { prSize: { exclude: [] } } }));
  assert.equal(none.lines, 512);
});

test('prSize: details는 줄 수가 많은 파일부터 적고, 넘었을 때만 고치는 법과 근거를 더한다', () => {
  const files: Files = { 'src/small.ts': lines(2), 'src/big.ts': lines(9), 'src/mid.ts': lines(5) };
  const ok = prSize(repo(files));
  const order = (d: string[]) =>
    ['src/big.ts', 'src/mid.ts', 'src/small.ts'].map((f) => d.findIndex((l) => l.includes(f)));
  const [b, m, s] = order(ok.details);
  assert.ok(b > 0 && b < m && m < s, ok.details.join('\n'));
  assert.ok(!ok.details.some((l) => l.includes('고치는 법')));

  const over = prSize(repo(files, { cfg: { prSize: { maxLines: 3 } } }));
  assert.ok(over.details.some((l) => l.includes('고치는 법') && l.includes('병합을 막지 않는다')));
  assert.ok(over.details.some((l) => l.includes('근거') && l.includes('R15')));

  // 31개면 30개만 적고 나머지는 수로 적는다
  const many: Files = {};
  for (let i = 0; i < 31; i++) many[`src/f${String(i).padStart(2, '0')}.ts`] = lines(1);
  const d = prSize(repo(many)).details;
  assert.equal(d.filter((l) => /src\/f\d\d\.ts/.test(l)).length, 30);
  assert.ok(
    d.some((l) => l.includes('외 1개')),
    d.join('\n'),
  );
});

test('설정 prSize: 키가 없으면 기본값이고, 준 항목만 기본값을 대신한다', () => {
  const root = path.join(tmp(), 'cfg');
  const load = (prSizeCfg?: unknown) => {
    write(
      root,
      'harness.config.json',
      JSON.stringify(fixtureConfig(prSizeCfg === undefined ? {} : { prSize: prSizeCfg })),
    );
    return loadConfig(root).prSize;
  };
  assert.deepEqual(load(), DEFAULT_PR_SIZE);
  assert.equal(DEFAULT_PR_SIZE.maxLines, 400);
  assert.deepEqual(DEFAULT_PR_SIZE.exclude, [
    '**/*.md',
    'docs/**',
    '**/*.test.*',
    '**/*.spec.*',
    '**/test/**',
    '**/tests/**',
    '**/__tests__/**',
    '**/generated/**',
  ]);
  assert.deepEqual(load({ maxLines: 10 }), { maxLines: 10, exclude: DEFAULT_PR_SIZE.exclude });
  assert.deepEqual(load({ exclude: [] }), { maxLines: 400, exclude: [] });
  assert.deepEqual(load({}), DEFAULT_PR_SIZE);

  for (const bad of [
    { maxLines: 0 },
    { maxLines: -1 },
    { maxLines: 1.5 },
    { maxLines: '400' },
    { exclude: ['/abs'] },
    { exclude: ['../x'] },
    { exclude: [1] },
    { exclude: 'docs/**' },
    { limit: 400 },
    [],
    null,
    'x',
  ])
    assert.throws(
      () => resolvePrSize(bad),
      (e: unknown) => e instanceof ConfigError && e.message.includes('prSize'),
      JSON.stringify(bad),
    );

  // 돌려받은 값을 고쳐도 기본값은 그대로다
  const got = resolvePrSize(undefined);
  got.exclude.push('x/**');
  got.maxLines = 1;
  assert.equal(DEFAULT_PR_SIZE.exclude.length, 8);
  assert.equal(DEFAULT_PR_SIZE.maxLines, 400);
  const given = ['a/**'];
  const kept = resolvePrSize({ exclude: given });
  kept.exclude.push('b/**');
  assert.deepEqual(given, ['a/**']);
});

const gates = (r: ReturnType<typeof repo>, cfg: HarnessConfig = r.cfg) =>
  runGates({ root: r.root, cfg, base: r.base, branch: BRANCH, headSha: r.head });
const find = (rs: GateResult[], c: string) => rs.find((x) => x.context === c)!;
const required = (rs: GateResult[]) =>
  GATE_CONTEXTS.map((c) => [c, find(rs, c).state, find(rs, c).description]);

test('runGates: pr-size를 필수 판정 뒤에 내고, 경고여도 다른 판정은 그대로다', async () => {
  assert.ok(!(GATE_CONTEXTS as readonly string[]).includes('pr-size'));
  assert.ok((WARN_CONTEXTS as readonly string[]).includes('pr-size'));
  assert.deepEqual([...RECORDED_CONTEXTS], [...GATE_CONTEXTS, ...WARN_CONTEXTS]);

  const small = repo({ 'src/a.ts': lines(3) }, { cfg: { prSize: { maxLines: 5 } } });
  const big = repo({ 'src/a.ts': lines(9) }, { cfg: { prSize: { maxLines: 5 } } });
  const a = await gates(small);
  const b = await gates(big);
  for (const r of [a, b]) {
    assert.deepEqual(
      r.results.map((x) => x.context),
      [...RECORDED_CONTEXTS],
    );
    assert.equal(validateResults(r, { headSha: r.headSha, contexts: RECORDED_CONTEXTS }).ok, true);
  }
  const sa = find(a.results, 'pr-size');
  const sb = find(b.results, 'pr-size');
  assert.equal(sa.state, 'success');
  assert.equal(isWarning(sa), false);
  assert.equal(sb.state, 'success');
  assert.equal(isWarning(sb), true);
  assert.deepEqual(
    GATE_CONTEXTS.map((c) => find(b.results, c).state),
    GATE_CONTEXTS.map((c) => find(a.results, c).state),
  );

  // 요약의 결과 칸: 경고면 `경고`, 아니면 `통과`
  assert.match(summaryMarkdown(b), /^\| pr-size \| 경고 \| 경고: /m);
  assert.match(summaryMarkdown(a), /^\| pr-size \| 통과 \| 통과 \(/m);
});

test('runGates: pr-size는 넘겨받은 설정만 쓴다(PR 트리의 설정 파일로 상한을 올릴 수 없다)', async () => {
  const r = repo(
    {
      'src/a.ts': lines(9),
      'harness.config.json': JSON.stringify(fixtureConfig({ prSize: { maxLines: 100000 } })),
    },
    { cfg: { prSize: { maxLines: 5 } } },
  );
  assert.equal(loadConfig(r.root).prSize.maxLines, 100000);
  const s = find((await gates(r)).results, 'pr-size');
  assert.equal(isWarning(s), true, s.description);
  assert.ok(s.description.includes('상한 5줄'), s.description);
});

test('runGates: pr-size 안의 예외는 pr-size만 error로 만든다', async () => {
  const r = repo({ 'src/a.ts': lines(3) });
  const good = await gates(r);
  const broken = await gates(r, { ...r.cfg, prSize: undefined } as unknown as HarnessConfig);
  const s = find(broken.results, 'pr-size');
  assert.equal(s.state, 'error');
  assert.equal(isWarning(s), false);
  assert.deepEqual(required(broken.results), required(good.results));
});

test('isWarning: 경고 판정의 success이고 설명이 경고 머리말일 때만 참이다', () => {
  const g = (over: Partial<GateResult>): GateResult => ({
    context: 'pr-size',
    state: 'success',
    description: `${WARN_PREFIX}x`,
    details: [],
    ...over,
  });
  assert.equal(isWarning(g({})), true);
  assert.equal(isWarning(g({ description: '통과 (x)' })), false);
  assert.equal(isWarning(g({ state: 'error' })), false);
  assert.equal(isWarning(g({ context: 'plan-gate' })), false);
});

test('capDetails: 한 줄과 전체의 크기를 묶고, 줄였으면 끝에 표시한다', () => {
  assert.deepEqual(capDetails(['a', 'b']), ['a', 'b']);
  const long = capDetails(['가'.repeat(DETAIL_LINE_MAX + 50), 'x'.repeat(DETAIL_LINE_MAX)]);
  assert.equal(long[0].length, DETAIL_LINE_MAX);
  assert.ok(long[0].endsWith('…'));
  assert.equal(long[1], 'x'.repeat(DETAIL_LINE_MAX));
  // 전체가 상한을 넘으면 넘게 되는 줄부터 버린다
  const many = capDetails(Array.from({ length: 100 }, (_, i) => `${i} ` + '가'.repeat(190)));
  assert.equal(many[many.length - 1], DETAILS_CUT);
  assert.ok(many.length < 100);
  assert.equal(many[0], '0 ' + '가'.repeat(190));
  const bytes = many.slice(0, -1).reduce((n, l) => n + detailBytes(l), 0);
  assert.ok(bytes <= DETAILS_MAX_BYTES, String(bytes));
  // 한 줄을 더 담았다면 넘었을 것이다(상한까지 채운다)
  assert.ok(bytes + detailBytes(many[0]) > DETAILS_MAX_BYTES);
  // 줄의 크기는 JSON으로 적었을 때의 크기다: 제어 문자·따옴표·역슬래시가 가득한 줄도 JSON 배열이 상한 안이다
  for (const ch of ['\u0001', '"', '\\']) {
    const ctl = capDetails(Array.from({ length: 100 }, () => ch.repeat(DETAIL_LINE_MAX)));
    assert.equal(ctl[ctl.length - 1], DETAILS_CUT);
    const json = Buffer.byteLength(JSON.stringify(ctl.slice(0, -1)), 'utf8');
    assert.ok(json <= DETAILS_MAX_BYTES + 2, `${JSON.stringify(ch)}: ${json}`);
  }
});

const HEAD_SHA = 'a'.repeat(40);
/** 필수 판정 다섯(첫 판정의 상세가 pad바이트쯤)과 경고 판정(상세 warnLines줄)을 담은 결과 */
function bigResults(pad: number, warnLines: number): GateResults {
  return {
    version: 1,
    headSha: HEAD_SHA,
    risk: 'normal',
    results: RECORDED_CONTEXTS.map((context, i) => ({
      context,
      state: 'success' as const,
      description: (WARN_CONTEXTS as readonly string[]).includes(context)
        ? `${WARN_PREFIX}크다`
        : '통과',
      details: (WARN_CONTEXTS as readonly string[]).includes(context)
        ? Array.from({ length: warnLines }, (_, k) => `${k} ` + 'w'.repeat(100))
        : i === 0
          ? Array.from({ length: Math.floor(pad / 100) }, () => 'r'.repeat(88))
          : [],
    })),
  };
}
const requiredOnly = (r: GateResults): GateResults => ({
  ...r,
  results: r.results.filter((g) => (GATE_CONTEXTS as readonly string[]).includes(g.context)),
});

test('fitWarnings: 상한 안이면 그대로이고, 넘으면 경고 판정의 상세만 뺀다', () => {
  const small = bigResults(1000, 5);
  assert.equal(fitWarnings(small), small);

  // 필수 판정이 80KiB쯤이고 경고 상세가 더해져 상한을 넘는다
  const big = bigResults(80 * 1024, 100);
  assert.ok(resultsBytes(requiredOnly(big)) < RESULTS_MAX_BYTES);
  assert.ok(resultsBytes(big) > RESULTS_MAX_BYTES);
  const out = fitWarnings(big);
  assert.ok(resultsBytes(out) <= RESULTS_MAX_BYTES, String(resultsBytes(out)));
  assert.deepEqual(
    out.results.map((g) => g.context),
    [...RECORDED_CONTEXTS],
  );
  for (const g of out.results) {
    if ((WARN_CONTEXTS as readonly string[]).includes(g.context)) {
      assert.deepEqual(g.details, [WARN_DETAILS_DROPPED]);
      assert.equal(g.description, `${WARN_PREFIX}크다`);
      assert.equal(isWarning(g), true);
    } else
      assert.deepEqual(
        g,
        big.results.find((x) => x.context === g.context),
      );
  }
  assert.equal(out.risk, 'normal');
  // 받은 결과는 고치지 않는다
  assert.equal(big.results[big.results.length - 1].details.length, 100);
});

test('fitWarnings: 상세를 빼도 넘으면 경고 판정을 빼서, 경고 판정이 없던 때의 결과와 같게 한다', () => {
  // 필수 판정만으로 상한에 닿을락 말락: 경고 판정의 머리(문맥·상태·설명)만 더해도 넘는다
  let pad = 86_000;
  while (resultsBytes(requiredOnly(bigResults(pad + 100, 0))) <= RESULTS_MAX_BYTES) pad += 100;
  const edge = bigResults(pad, 3);
  assert.ok(resultsBytes(requiredOnly(edge)) <= RESULTS_MAX_BYTES);
  assert.ok(resultsBytes(requiredOnly(edge)) > RESULTS_MAX_BYTES - 200);
  const out = fitWarnings(edge);
  assert.equal(JSON.stringify(out, null, 2), JSON.stringify(requiredOnly(edge), null, 2));

  // 필수 판정만으로 이미 넘는 결과: 필수 판정은 줄이지 않고 경고 판정만 뺀다
  const over = bigResults(120_000, 3);
  assert.ok(resultsBytes(requiredOnly(over)) > RESULTS_MAX_BYTES);
  assert.equal(
    JSON.stringify(fitWarnings(over), null, 2),
    JSON.stringify(requiredOnly(over), null, 2),
  );

  // 빠진 경고 판정은 기록 때 그 context만 error가 되고 필수 판정은 결과대로다
  const statuses = toStatuses(out, RECORDED_CONTEXTS, '');
  assert.deepEqual(
    statuses.map((s) => [s.context, s.state]),
    RECORDED_CONTEXTS.map((c) => [
      c,
      (WARN_CONTEXTS as readonly string[]).includes(c) ? 'error' : 'success',
    ]),
  );
});

const CFG = { prSize: resolvePrSize({ maxLines: 5 }), deps: { lockfiles: ['pnpm-lock.yaml'] } };
const sized = (p: string, n: number) => ({ path: p, lines: n, binary: false });

test('prSizeOf: 긴 경로가 많아도 결과의 크기가 묶이고, 고치는 법과 근거는 남는다', () => {
  // 경로 하나가 4,000자인 파일 40개(파일 시스템을 거치지 않는다)
  const files = Array.from({ length: 40 }, (_, i) => sized(`src/${i}/` + '가'.repeat(4000), 10));
  const r = prSizeOf(files, CFG as never);
  assert.equal(r.over, true);
  assert.equal(r.lines, 400);
  const size = Buffer.byteLength(JSON.stringify({ d: r.description, x: r.details }), 'utf8');
  assert.ok(size < 16_000, String(size));
  assert.ok(r.details.every((l) => l.length <= DETAIL_LINE_MAX));
  assert.equal(r.details[r.details.length - 1], DETAILS_CUT);
  // 고정 줄(수, 고치는 법, 근거)은 파일 줄보다 앞이라 잘리지 않는다
  assert.ok(r.details[0].startsWith('센 파일 40개'));
  assert.ok(r.details[1].startsWith('고치는 법'));
  assert.ok(r.details[2].startsWith('근거'));
});

test('prSizeOf: 경로는 글자 그대로 견준다(역슬래시가 든 파일 이름은 폴더 경로가 아니다)', () => {
  // 리포 루트의 파일 이름이 `docs\a.ts`, `src\a.test.ts`인 경우: 문서·테스트 제외에 걸리지 않는다
  const r = prSizeOf([sized('docs\\a.ts', 3), sized('src\\test\\a.ts', 4)], CFG as never);
  assert.equal(r.lines, 7);
  // 진짜 폴더 경로는 제외된다
  assert.equal(prSizeOf([sized('docs/a.ts', 3), sized('src/test/a.ts', 4)], CFG as never).lines, 0);
});

test('gatesOutput: 결과 파일은 크기를 맞춘 결과이고, 요약은 원래 결과라 뺀 경고와 상세가 남는다', () => {
  const small = bigResults(1000, 5);
  assert.equal(gatesOutput(small).file, serializeResults(small));
  assert.equal(gatesOutput(small).summary, summaryMarkdown(small));

  // 상세만 빠지는 크기와 경고 판정이 통째로 빠지는 크기
  let pad = 86_000;
  while (resultsBytes(requiredOnly(bigResults(pad + 100, 0))) <= RESULTS_MAX_BYTES) pad += 100;
  for (const r of [bigResults(80 * 1024, 100), bigResults(pad, 3)]) {
    const o = gatesOutput(r);
    assert.equal(o.file, serializeResults(fitWarnings(r)));
    assert.ok(Buffer.byteLength(o.file, 'utf8') <= RESULTS_MAX_BYTES);
    assert.ok(!o.file.includes('2 ' + 'w'.repeat(100)));
    // 요약에는 경고 행과 그 상세가 그대로다
    assert.equal(o.summary, summaryMarkdown(r));
    for (const c of WARN_CONTEXTS) {
      assert.ok(o.summary.includes(`| ${c} | 경고 |`), c);
      assert.ok(o.summary.includes(`### ${c}`), c);
    }
    assert.ok(o.summary.includes('2 ' + 'w'.repeat(100)));
  }
  // 경고 판정이 통째로 빠진 결과 파일
  const dropped = JSON.parse(gatesOutput(bigResults(pad, 3)).file) as GateResults;
  assert.deepEqual(
    dropped.results.map((g) => g.context),
    [...GATE_CONTEXTS],
  );
});

test('gates 명령: 크기 상한이 발동하면 결과 파일에서는 경고 상세가 빠지고 요약 파일에는 그대로 남는다', async () => {
  // 필수 판정(risk-gate)의 상세를 키운다: 경로 규칙 열 개가 모두 맞는 파일은 근거 줄을 열 개 낸다.
  // 경로는 100자 안쪽이다(Windows의 경로 길이 한도)
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  const riskPaths = Array.from({ length: 10 }, (_, k) => ({
    glob: `pad/${'d'.repeat(k + 1)}*/**`,
    risk: 'normal',
  }));
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig({ riskPaths })));
  const base = commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', BRANCH], root);
  const name = (i: number) => `${'d'.repeat(40)}/${String(i).padStart(4, '0')}${'f'.repeat(40)}`;
  // 세는 파일 40개(800줄): pr-size가 경고를 내고 상세에 파일 줄 30개를 적는다
  for (let i = 0; i < 40; i++) write(root, `src/${name(i)}.ts`, 'x\n'.repeat(20));
  let count = 0;
  const grow = (n: number): string => {
    for (; count < n; count++) write(root, `pad/${name(count)}.md`, 'x\n');
    return commitAll(root, `files ${n}`);
  };
  const gates = (headSha: string) =>
    runGates({ root, cfg: loadConfig(root), base, branch: BRANCH, headSha });
  // 결과가 상한을 처음 넘을 때까지 파일을 하나씩 늘린다. 파일 하나가 늘리는 크기가 pr-size의 상세보다 작아서,
  // 처음 넘는 때는 "경고의 상세만 빼면 상한 안"인 크기다
  let head = grow(50);
  let r = await gates(head);
  while (resultsBytes(r) <= RESULTS_MAX_BYTES) {
    assert.ok(count < 200, String(resultsBytes(r)));
    head = grow(count + 1);
    r = await gates(head);
  }
  const size = find(r.results, 'pr-size');
  assert.equal(isWarning(size), true);
  const sizeLine = size.details.find((l) => l.includes('src/dddd'))!;
  assert.ok(sizeLine, size.details.join('\n'));
  const fit = fitWarnings(r);
  assert.deepEqual(find(fit.results, 'pr-size').details, [WARN_DETAILS_DROPPED]);
  assert.ok(resultsBytes(fit) <= RESULTS_MAX_BYTES);

  const out = path.join(tmp(), 'gates.json');
  const summary = path.join(tmp(), 'summary.md');
  sh(
    process.execPath,
    [
      path.join(HARNESS_ROOT, 'scripts/harness.ts'),
      'gates',
      ...['--repo', root, '--config-root', root, '--base', base, '--head-ref', BRANCH],
      ...['--out', out, '--summary', summary],
    ],
    root,
  );
  // 결과 파일: 크기를 맞춘 결과 그대로다
  const file = readFileSync(out, 'utf8');
  assert.equal(file, serializeResults(fit));
  assert.ok(Buffer.byteLength(file, 'utf8') <= RESULTS_MAX_BYTES);
  assert.ok(!file.includes(sizeLine));
  const written = validateResults(JSON.parse(file), { headSha: head, contexts: RECORDED_CONTEXTS });
  assert.ok(written.ok);
  // 요약 파일: 원래 결과로 만든 것이라 경고 행과 파일 줄이 남는다
  const md = readFileSync(summary, 'utf8');
  assert.equal(md, summaryMarkdown(r));
  assert.ok(md.includes('| pr-size | 경고 |'));
  assert.ok(md.split('\n').includes(sizeLine));
});

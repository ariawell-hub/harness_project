// 원장 댓글 저장소와 기록 job 연결, 검증자 입력(라운드). 계획 20261115-review-ledger step1.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  applyVerdict,
  emptyLedger,
  parseLedger,
  renderLedger,
  type Entry,
  type Ledger,
} from '../ci/ledger.ts';
import {
  loadLedger,
  recordCiFailure,
  recordLedger,
  saveLedger,
  type LedgerApi,
} from '../ci/ledger-store.ts';
import type { StatusPayload } from '../ci/results.ts';
import * as reviewRound from '../ci/review-round.ts';
import { pinnedPrompt, writeRoundInput } from '../ci/review-round.ts';
import type { Finding, Resolution, Verdict } from '../ci/verdict.ts';
import { commitAll, gitInit, sh, tmp, write } from './helpers.ts';

const BOT = 'harness-recorder[bot]';
const BASE = 'a'.repeat(40);
const H1 = '1'.repeat(40);
const H2 = '2'.repeat(40);

const finding = (over: Partial<Finding> = {}): Finding => ({
  severity: 'P1',
  file: 'src/a.ts',
  line: 3,
  title: '만료 토큰을 허용함',
  evidence: '근거',
  suggestion: '제안',
  repro: { path: '', content: '' },
  ...over,
});
const verdict = (findings: Finding[] = [], resolutions: Resolution[] = []): Verdict => ({
  verdict: 'approve',
  risk: 'normal',
  summary: '요약',
  findings,
  resolutions,
});
const ledgerWith = (findings: Finding[], reviewer: 'claude' | 'codex' = 'claude'): Ledger =>
  applyVerdict(emptyLedger(BASE), {
    reviewer,
    verdict: verdict(findings),
    headSha: H1,
    changedSinceLastRound: null,
  });

interface Comment {
  id: number;
  user: { login: string };
  body: string;
}
/** 가짜 댓글 API. 한 쪽에 100개씩 돌려준다 */
function fakeApi(initial: Comment[] = []) {
  const comments = [...initial];
  const calls: string[] = [];
  const api: LedgerApi = {
    get: async (p) => {
      calls.push(`GET ${p}`);
      const m = /^repos\/o\/r\/issues\/7\/comments\?per_page=100&page=(\d+)$/.exec(p);
      if (!m) throw new Error(`모르는 경로: ${p}`);
      const page = Number(m[1]);
      return comments.slice((page - 1) * 100, page * 100);
    },
    send: async (method, p, body) => {
      calls.push(`${method} ${p}`);
      const text = (body as { body: string }).body;
      if (method === 'POST' && p === 'repos/o/r/issues/7/comments') {
        comments.push({ id: 1000 + comments.length, user: { login: BOT }, body: text });
        return {};
      }
      const m = /^repos\/o\/r\/issues\/comments\/(\d+)$/.exec(p);
      const c = m && comments.find((x) => x.id === Number(m[1]));
      if (method !== 'PATCH' || !c) throw new Error(`모르는 요청: ${method} ${p}`);
      c.body = text;
      return {};
    },
  };
  return { api, comments, calls };
}
const where = { repo: 'o/r', number: 7, recorderBot: BOT };

test('loadLedger: 검증 App 봇이 쓴 원장 댓글만 읽는다. 없으면 null', async () => {
  const mine = renderLedger(ledgerWith([finding()]));
  const forged = renderLedger(ledgerWith([]));
  const { api } = fakeApi([
    { id: 1, user: { login: 'someone' }, body: forged },
    { id: 2, user: { login: 'harness-bot' }, body: forged },
    { id: 3, user: { login: BOT }, body: '원장이 아닌 봇 댓글' },
    { id: 4, user: { login: BOT }, body: mine },
  ]);
  const r = await loadLedger({ get: api.get, ...where });
  assert.equal(r.commentId, 4);
  assert.equal(r.ledger?.findings.length, 1);
  const none = await loadLedger({ get: fakeApi([]).api.get, ...where });
  assert.deepEqual(none, { commentId: null, ledger: null });
});

test('loadLedger: 뒤쪽 쪽의 댓글도 찾고, 봇 원장이 여럿이면 가장 오래된 것을 쓴다', async () => {
  const filler = Array.from({ length: 150 }, (_, i) => ({
    id: i + 1,
    user: { login: 'someone' },
    body: `댓글 ${i}`,
  }));
  const first = renderLedger(ledgerWith([finding({ title: '첫 원장' })]));
  const second = renderLedger(ledgerWith([]));
  const { api } = fakeApi([
    ...filler,
    { id: 500, user: { login: BOT }, body: first },
    { id: 501, user: { login: BOT }, body: second },
  ]);
  const r = await loadLedger({ get: api.get, ...where });
  assert.equal(r.commentId, 500);
  assert.equal(r.ledger?.findings[0].title, '첫 원장');
});

test('loadLedger: 봇 설정이 없거나 원장 댓글이 깨졌거나 조회가 실패하면 예외(fail-closed)', async () => {
  const good = renderLedger(ledgerWith([finding()]));
  await assert.rejects(
    loadLedger({ get: fakeApi([]).api.get, ...where, recorderBot: '' }),
    /recorderBot/,
  );
  const broken = good.replace(/harness-ledger-data:[A-Za-z0-9+/=]+/, 'harness-ledger-data:AAAA');
  await assert.rejects(
    loadLedger({
      get: fakeApi([{ id: 1, user: { login: BOT }, body: broken }]).api.get,
      ...where,
    }),
    /깨졌다/,
  );
  await assert.rejects(
    loadLedger({
      get: async () => {
        throw new Error('HTTP 500');
      },
      ...where,
    }),
    /HTTP 500/,
  );
  await assert.rejects(loadLedger({ get: async () => ({ message: 'x' }), ...where }), /배열/);
});

test('saveLedger: 없으면 만들고 있으면 고친다. 댓글 상한을 넘으면 쓰지 않는다', async () => {
  const f = fakeApi([]);
  const l = ledgerWith([finding()]);
  await saveLedger({ send: f.api.send, repo: 'o/r', number: 7, commentId: null, ledger: l });
  assert.equal(f.comments.length, 1);
  assert.deepEqual(parseLedger(f.comments[0].body), l);
  const l2 = applyVerdict(l, {
    reviewer: 'claude',
    verdict: verdict([], [{ id: 'F1', status: 'fixed', note: '고침' }]),
    headSha: H2,
    changedSinceLastRound: [],
  });
  await saveLedger({
    send: f.api.send,
    repo: 'o/r',
    number: 7,
    commentId: f.comments[0].id,
    ledger: l2,
  });
  assert.equal(f.comments.length, 1);
  assert.equal(parseLedger(f.comments[0].body)?.findings[0].status, 'fixed');
  // 차단 지적은 크기와 상관없이 등록되므로 본문이 상한을 넘을 수 있다. 그때는 쓰지 않고 예외
  let big = emptyLedger(BASE);
  for (let i = 0; i < 12; i++)
    big = applyVerdict(big, {
      reviewer: 'claude',
      verdict: verdict(
        Array.from({ length: 30 }, (_, j) =>
          finding({ title: `${'한|<@'.repeat(40)}${i}-${j}`.slice(0, 200) }),
        ),
      ),
      headSha: H1,
      changedSinceLastRound: null,
    });
  const before = f.calls.length;
  await assert.rejects(
    saveLedger({ send: f.api.send, repo: 'o/r', number: 7, commentId: null, ledger: big }),
    /상한/,
  );
  assert.equal(f.calls.length, before);
});

async function record(
  f: ReturnType<typeof fakeApi>,
  over: Partial<Parameters<typeof recordLedger>[0]> = {},
): Promise<StatusPayload> {
  const posted: StatusPayload[] = [];
  const p = await recordLedger({
    reviewer: 'claude',
    verdict: null,
    headSha: H1,
    promptBase: BASE,
    changedSinceLastRound: null,
    planOnly: false,
    api: f.api,
    post: async (s) => void posted.push(s),
    ...where,
    ...over,
  });
  assert.deepEqual(posted, [p]);
  assert.equal(p.context, 'review-ledger');
  return p;
}

test('recordLedger: 원장이 없고 지적도 없으면 댓글을 만들지 않고 success', async () => {
  const f = fakeApi([]);
  const none = await record(f);
  assert.equal(none.state, 'success');
  assert.match(none.description, /원장 없음/);
  const clean = await record(f, { verdict: verdict() });
  assert.equal(clean.state, 'success');
  assert.equal(f.comments.length, 0);
});

test('recordLedger: 판정을 원장에 반영해 댓글을 쓰고 review-ledger를 기록한다', async () => {
  const f = fakeApi([]);
  const r1 = await record(f, { verdict: verdict([finding(), finding({ severity: 'P2' })]) });
  assert.equal(r1.state, 'failure');
  assert.match(r1.description, /1건: F1/);
  assert.equal(f.comments.length, 1);
  assert.equal(f.comments[0].user.login, BOT);
  assert.equal(parseLedger(f.comments[0].body)?.promptBase, BASE);
  // 다른 검증자의 판정 없는 기록(해당 없음·이어받음)도 지금 원장으로 판정한다
  const other = await record(f, { reviewer: 'codex', headSha: H2 });
  assert.equal(other.state, 'failure');
  // 2라운드: 지적한 검증자가 고쳤다고 하면 통과. 댓글은 하나를 고쳐 쓴다
  const r2 = await record(f, {
    verdict: verdict([], [{ id: 'F1', status: 'fixed', note: 'a1b2c3d' }]),
    headSha: H2,
    changedSinceLastRound: ['src/a.ts'],
    promptBase: 'b'.repeat(40),
  });
  assert.equal(r2.state, 'success');
  assert.equal(f.comments.length, 1);
  const l = parseLedger(f.comments[0].body);
  assert.equal(l?.rounds.length, 2);
  // 프롬프트 버전은 1라운드의 것을 유지한다
  assert.equal(l?.promptBase, BASE);
});

test('recordLedger: 읽기·쓰기 실패, 깨진 원장, API 없음은 error(fail-closed)이고 사유를 한 줄로 적는다', async () => {
  const noApi = await record(fakeApi([]), { api: null, verdict: verdict([finding()]) });
  assert.equal(noApi.state, 'error');
  assert.match(noApi.description, /Pull requests/);
  const f = fakeApi([]);
  const failing: LedgerApi = {
    get: f.api.get,
    send: async () => {
      throw new Error('HTTP 403\n상세');
    },
  };
  const w = await record(f, { api: failing, verdict: verdict([finding()]) });
  assert.equal(w.state, 'error');
  assert.match(w.description, /HTTP 403 상세/);
  const broken = fakeApi([
    { id: 1, user: { login: BOT }, body: '<!-- harness-ledger:v1 -->\n자료 없음' },
  ]);
  assert.equal((await record(broken)).state, 'error');
  assert.equal((await record(fakeApi([]), { recorderBot: '' })).state, 'error');
  // PR 번호를 모르면 원장을 찾을 수 없다
  assert.equal((await record(fakeApi([]), { number: 0 })).state, 'error');
});

test('recordCiFailure: check 실패를 원장에 남긴다. 같은 실행은 한 번, 최근 30건만', async () => {
  const f = fakeApi([]);
  const run = (n: number) => `https://github.com/o/r/actions/runs/${n}`;
  await recordCiFailure({ api: f.api, ...where, headSha: H1, run: run(1), promptBase: BASE });
  await recordCiFailure({ api: f.api, ...where, headSha: H1, run: run(1), promptBase: BASE });
  assert.equal(f.comments.length, 1);
  assert.deepEqual(parseLedger(f.comments[0].body)?.ciFailures, [{ head: H1, run: run(1) }]);
  for (let i = 2; i <= 40; i++)
    await recordCiFailure({ api: f.api, ...where, headSha: H2, run: run(i), promptBase: BASE });
  const l = parseLedger(f.comments[0].body);
  assert.equal(l?.ciFailures.length, 30);
  assert.equal(l?.ciFailures.at(-1)?.run, run(40));
  await assert.rejects(
    recordCiFailure({ api: f.api, ...where, headSha: 'zz', run: run(1), promptBase: BASE }),
    /SHA/,
  );
  await assert.rejects(
    recordCiFailure({
      api: f.api,
      ...where,
      headSha: H1,
      run: 'https://evil.invalid/x',
      promptBase: BASE,
    }),
    /URL/,
  );
});

function roundRepo() {
  const root = tmp();
  gitInit(root);
  write(root, 'src/a.ts', 'a1\n');
  write(root, 'src/b.ts', 'b1\n');
  commitAll(root, 'r1');
  const old = sh('git', ['rev-parse', 'HEAD'], root);
  write(root, 'src/a.ts', 'a2\n');
  write(root, 'src/new file.ts', 'n\n');
  commitAll(root, 'r2');
  return { root, old };
}

test('writeRoundInput: 원장이 없으면 1라운드, 파일을 쓰지 않는다', () => {
  const { root } = roundRepo();
  const r = writeRoundInput({ root, ledger: null, reviewer: 'claude' });
  assert.deepEqual(r, { round: 1, promptBase: '', changed: null, outside: [] });
  assert.equal(existsSync(path.join(root, '.harness-review/ledger.md')), false);
});

test('writeRoundInput: 원장과 직전 판정 이후 바뀐 파일·diff를 검증자 입력에 쓴다', () => {
  const { root, old } = roundRepo();
  let l = applyVerdict(emptyLedger(BASE), {
    reviewer: 'claude',
    verdict: verdict([finding({ title: '지적 `하나`\n둘째 줄' }), finding({ severity: 'P2' })]),
    headSha: old,
    changedSinceLastRound: null,
  });
  l = applyVerdict(l, {
    reviewer: 'codex',
    verdict: verdict([finding({ title: 'codex 지적', severity: 'P0' })]),
    headSha: old,
    changedSinceLastRound: null,
  });
  const r = writeRoundInput({ root, ledger: l, reviewer: 'claude' });
  assert.equal(r.round, 2);
  assert.equal(r.promptBase, BASE);
  assert.deepEqual([...(r.changed ?? [])].sort(), ['src/a.ts', 'src/new file.ts']);
  const dir = path.join(root, '.harness-review');
  const md = readFileSync(path.join(dir, 'ledger.md'), 'utf8');
  assert.match(md, /검증자: claude/);
  assert.match(md, /2라운드/);
  assert.match(md, /F1 \| P1 \| claude \| open \| src\/a\.ts:3 \| 지적 `하나` 둘째 줄/);
  assert.match(md, /F3 \| P0 \| codex \| open/);
  // 숨은 자료는 검증자 입력에 넣지 않는다
  assert.doesNotMatch(md, /harness-ledger-data/);
  assert.equal(
    readFileSync(path.join(dir, 'round-changed.txt'), 'utf8'),
    'src/a.ts\nsrc/new file.ts\n',
  );
  assert.match(readFileSync(path.join(dir, 'round-diff.patch'), 'utf8'), /\+a2/);
  // 이 검증자의 첫 판정이면 1라운드이고 바뀐 파일 목록은 없다
  const first = writeRoundInput({
    root,
    ledger: ledgerWith([finding()], 'codex'),
    reviewer: 'claude',
  });
  assert.deepEqual([first.round, first.changed], [1, null]);
  assert.match(readFileSync(path.join(dir, 'ledger.md'), 'utf8'), /1라운드/);
  assert.equal(existsSync(path.join(dir, 'round-changed.txt')), false);
});

/**
 * 직전 판정 뒤 PR 브랜치가 main을 병합한 리포(Issue #262). main은 PR이 바꾸지 않은 `src/main-only.ts`를 바꿨다.
 * again이면 병합 뒤 PR이 `src/a.ts`를 한 번 더 바꾼다. base는 지금 head와 main의 merge-base
 */
function mergedRepo(again: boolean) {
  const root = tmp();
  gitInit(root);
  write(root, 'src/a.ts', 'a1\n');
  write(root, 'src/main-only.ts', 'm1\n');
  commitAll(root, 'base');
  sh('git', ['checkout', '-q', '-b', 'pr'], root);
  write(root, 'src/a.ts', 'a1\npr1\n');
  commitAll(root, 'pr1');
  const last = sh('git', ['rev-parse', 'HEAD'], root);
  sh('git', ['checkout', '-q', 'main'], root);
  write(root, 'src/main-only.ts', 'm2\n');
  commitAll(root, 'main');
  sh('git', ['checkout', '-q', 'pr'], root);
  sh('git', ['merge', '-q', '--no-edit', 'main'], root);
  if (again) {
    write(root, 'src/a.ts', 'a1\npr1\npr2\n');
    commitAll(root, 'pr2');
  }
  const base = sh('git', ['merge-base', 'main', 'HEAD'], root);
  const ledger = applyVerdict(emptyLedger(BASE), {
    reviewer: 'claude',
    verdict: verdict([finding()]),
    headSha: last,
    changedSinceLastRound: null,
  });
  return { root, base, ledger };
}

test('writeRoundInput #262: main 병합으로만 바뀐 파일은 이 PR의 변경(changed·diff)에 넣지 않고 round-main.txt에 따로 적는다', () => {
  const { root, base, ledger } = mergedRepo(true);
  const r = writeRoundInput({ root, ledger, reviewer: 'claude', base });
  assert.equal(r.round, 2);
  assert.deepEqual(r.changed, ['src/a.ts']);
  assert.deepEqual(r.outside, ['src/main-only.ts']);
  const dir = path.join(root, '.harness-review');
  assert.equal(readFileSync(path.join(dir, 'round-changed.txt'), 'utf8'), 'src/a.ts\n');
  assert.equal(readFileSync(path.join(dir, 'round-main.txt'), 'utf8'), 'src/main-only.ts\n');
  const diff = readFileSync(path.join(dir, 'round-diff.patch'), 'utf8');
  assert.match(diff, /\+pr2/);
  assert.doesNotMatch(diff, /main-only/);
  const md = readFileSync(path.join(dir, 'ledger.md'), 'utf8');
  assert.match(md, /round-main\.txt \(1개\)/);
  assert.match(md, /이 PR의 변경이 아니다/);
});

test('writeRoundInput #262: 직전 판정 뒤 main 병합만 더했으면 changed와 diff가 비고 main 쪽 파일은 round-main.txt에만 있다', () => {
  const { root, base, ledger } = mergedRepo(false);
  const r = writeRoundInput({ root, ledger, reviewer: 'claude', base });
  assert.deepEqual(r.changed, []);
  assert.deepEqual(r.outside, ['src/main-only.ts']);
  const dir = path.join(root, '.harness-review');
  assert.equal(readFileSync(path.join(dir, 'round-changed.txt'), 'utf8'), '');
  assert.equal(readFileSync(path.join(dir, 'round-diff.patch'), 'utf8').trim(), '');
  assert.equal(readFileSync(path.join(dir, 'round-main.txt'), 'utf8'), 'src/main-only.ts\n');
});

test('writeRoundInput #262: merge-base를 주지 않으면 지금처럼 직전 판정 이후 바뀐 파일 전부가 changed이고 round-main.txt가 없다', () => {
  const { root, ledger } = mergedRepo(true);
  const r = writeRoundInput({ root, ledger, reviewer: 'claude' });
  assert.deepEqual([...(r.changed ?? [])].sort(), ['src/a.ts', 'src/main-only.ts']);
  assert.deepEqual(r.outside, []);
  const dir = path.join(root, '.harness-review');
  assert.equal(existsSync(path.join(dir, 'round-main.txt')), false);
  assert.match(readFileSync(path.join(dir, 'round-diff.patch'), 'utf8'), /main-only/);
  assert.doesNotMatch(readFileSync(path.join(dir, 'ledger.md'), 'utf8'), /round-main/);
});

test('writeRoundInput #262: 나눈 결과가 전달 상한을 넘으면 나누지 않는다. 검증 입력과 기록 job이 같은 목록을 본다(계획 검증 F8)', () => {
  const { root, base, ledger } = mergedRepo(true);
  const r = writeRoundInput({ root, ledger, reviewer: 'claude', base, maxChars: 10 });
  assert.deepEqual([...(r.changed ?? [])].sort(), ['src/a.ts', 'src/main-only.ts']);
  assert.deepEqual(r.outside, []);
  const dir = path.join(root, '.harness-review');
  assert.equal(existsSync(path.join(dir, 'round-main.txt')), false);
  assert.match(readFileSync(path.join(dir, 'round-diff.patch'), 'utf8'), /main-only/);
  const md = readFileSync(path.join(dir, 'ledger.md'), 'utf8');
  assert.match(md, /나누지 않았다/);
  assert.doesNotMatch(md, /round-main/);
  // 같은 상한으로 만든 전달 값은 빈 값이다: 기록 job도 나누지 않는다(모른다)
  assert.equal(roundFn('encodeRoundChanged')(r, 10), '');
});

test('writeRoundInput #262: 직전 판정 뒤 PR이 merge-base와 같게 되돌린 파일은 이 PR의 변경이다(계획 검증 F1)', () => {
  const root = tmp();
  gitInit(root);
  write(root, 'src/a.ts', 'a1\n');
  write(root, 'src/main-only.ts', 'm1\n');
  commitAll(root, 'base');
  sh('git', ['checkout', '-q', '-b', 'pr'], root);
  write(root, 'src/a.ts', 'a1\ncompat\n');
  commitAll(root, 'pr1');
  const last = sh('git', ['rev-parse', 'HEAD'], root);
  write(root, 'src/a.ts', 'a1\n');
  commitAll(root, 'revert');
  sh('git', ['checkout', '-q', 'main'], root);
  write(root, 'src/main-only.ts', 'm2\n');
  commitAll(root, 'main');
  sh('git', ['checkout', '-q', 'pr'], root);
  sh('git', ['merge', '-q', '--no-edit', 'main'], root);
  const base = sh('git', ['merge-base', 'main', 'HEAD'], root);
  const ledger = applyVerdict(emptyLedger(BASE), {
    reviewer: 'claude',
    verdict: verdict([finding()]),
    headSha: last,
    changedSinceLastRound: null,
  });
  const r = writeRoundInput({ root, ledger, reviewer: 'claude', base });
  assert.deepEqual(r.changed, ['src/a.ts']);
  assert.deepEqual(r.outside, ['src/main-only.ts']);
  assert.match(
    readFileSync(path.join(root, '.harness-review/round-diff.patch'), 'utf8'),
    /^-compat$/m,
  );
  // 그 파일의 새 P1은 지금 규칙대로 받는다(바뀐 파일이라 동결되지 않고, 범위 밖도 아니다)
  const next = applyVerdict(ledger, {
    reviewer: 'claude',
    verdict: verdict([finding({ title: '호환 처리를 되돌려 깨진다' })]),
    headSha: sh('git', ['rev-parse', 'HEAD'], root),
    changedSinceLastRound: r.changed,
    outsideSinceLastRound: r.outside,
  });
  assert.equal(next.findings.at(-1)?.status, 'open');
});

/** 새 함수(Issue #262). 변경 전 코드에는 없어 단언으로 실패하게 한다 */
function roundFn<K extends 'parseRoundChanged' | 'encodeRoundChanged'>(name: K) {
  const f = (reviewRound as Partial<typeof reviewRound>)[name];
  assert.equal(typeof f, 'function', `${name} 없음`);
  return f as (typeof reviewRound)[K];
}
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');

test('parseRoundChanged #262: 배열 꼴과 객체 꼴을 읽고, 그 밖은 모두 모르는 것으로 본다(계획 검증 F3)', () => {
  const parse = roundFn('parseRoundChanged');
  assert.deepEqual(parse(b64(['src/a.ts'])), { changed: ['src/a.ts'], outside: [] });
  assert.deepEqual(parse(b64({ changed: ['src/a.ts'], outside: ['src/b.ts'] })), {
    changed: ['src/a.ts'],
    outside: ['src/b.ts'],
  });
  assert.deepEqual(parse(b64({ changed: null, outside: [] })), { changed: null, outside: [] });
  const unknown = { changed: null, outside: [] };
  const bad: [string, string][] = [
    ['빈 값', ''],
    ['base64가 아님', '%%%'],
    ['JSON이 아님', Buffer.from('{changed').toString('base64')],
    ['숫자', b64(3)],
    ['null', b64(null)],
    ['outside 없음', b64({ changed: ['src/a.ts'] })],
    ['outside가 문자열', b64({ changed: ['src/a.ts'], outside: 'src/b.ts' })],
    ['outside에 숫자', b64({ changed: ['src/a.ts'], outside: ['src/b.ts', 1] })],
    ['changed가 문자열', b64({ changed: 'src/a.ts', outside: [] })],
    ['changed에 숫자', b64({ changed: ['src/a.ts', 2], outside: [] })],
    ['changed 없음', b64({ outside: [] })],
    ['배열에 숫자', b64(['src/a.ts', 1])],
  ];
  for (const [name, value] of bad) assert.deepEqual(parse(value), unknown, name);
});

/** b64 길이가 정확히 n자가 되는 make(len)을 찾는다(base64 4자 = 3바이트). 없으면 null */
function sizedTo<T>(n: number, make: (len: number) => T): T | null {
  const fixed = b64(make(0)).length;
  for (let len = Math.max(0, Math.floor(((n - fixed) * 3) / 4) - 3); ; len++) {
    const v = make(len);
    const k = b64(v).length;
    if (k === n) return v;
    if (k > n) return null;
  }
}

test('encodeRoundChanged #262: 객체 꼴이 상한(120,000자) 안이면 그 값, 넘으면 빈 값이다. 예전 배열 꼴 100,000자 목록은 나눠도 전달된다(계획 검증 F3·F7·F9)', () => {
  const encode = roundFn('encodeRoundChanged');
  const parse = roundFn('parseRoundChanged');
  const long = (len: number) => 'x'.repeat(len);
  // 객체 꼴이 정확히 120,000자: 그대로 내고 되읽으면 같다
  const at = sizedTo(120_000, (len) => ({ changed: [long(len)], outside: [] as string[] }));
  assert.ok(at, '객체 꼴 120,000자');
  assert.equal(encode(at), b64(at));
  assert.deepEqual(parse(encode(at)), at);
  // base64 길이는 4의 배수다: 상한을 처음 넘는 120,004자면 빈 값(모른다)이다
  const over = sizedTo(120_004, (len) => ({ changed: ['src/a.ts'], outside: [long(len)] }));
  assert.ok(over, '객체 꼴 120,004자');
  assert.equal(encode(over), '');
  // 예전 배열 꼴로 정확히 100,000자인 목록(예전에는 전달됐다)을 나눠도 객체 꼴로 전달되고 범위 구분이 남는다
  const list = sizedTo(100_000, (len) => ['src/a.ts', long(len), 'src/main-only.ts']);
  assert.ok(list, '배열 꼴 100,000자');
  const split = { changed: [list[0], list[1]], outside: [list[2]] };
  assert.deepEqual(parse(encode(split)), split);
  assert.deepEqual(parse(encode({ changed: null, outside: [] })), { changed: null, outside: [] });
});

test('writeRoundInput: 직전 판정 head를 찾지 못하면 바뀐 파일을 모른다(null)', () => {
  const { root } = roundRepo();
  const l = ledgerWith([finding()]);
  const r = writeRoundInput({ root, ledger: l, reviewer: 'claude' });
  assert.deepEqual([r.round, r.changed], [2, null]);
  assert.match(readFileSync(path.join(root, '.harness-review/ledger.md'), 'utf8'), /찾지 못했다/);
});

test('pinnedPrompt: 원장의 1라운드 base SHA의 프롬프트를 쓴다. 없으면 지금 것', () => {
  const base = tmp();
  gitInit(base);
  write(base, 'scripts/cross-review/prompt.md', '옛 프롬프트\n');
  write(base, 'scripts/cross-review/prompt-codex.md', '옛 꼬리말\n');
  commitAll(base, 'old');
  const old = sh('git', ['rev-parse', 'HEAD'], base);
  write(base, 'scripts/cross-review/prompt.md', '새 프롬프트\n');
  commitAll(base, 'new');
  const files = ['prompt.md', 'prompt-codex.md'];
  assert.equal(pinnedPrompt({ baseDir: base, promptBase: '', files }), '새 프롬프트\n옛 꼬리말\n');
  assert.equal(pinnedPrompt({ baseDir: base, promptBase: old, files }), '옛 프롬프트\n옛 꼬리말\n');
  // 형식이 다른 값, 없는 커밋, 허용 밖 파일 이름은 예외(판정 없이 실패)
  assert.throws(() => pinnedPrompt({ baseDir: base, promptBase: 'HEAD', files }), /SHA/);
  assert.throws(() => pinnedPrompt({ baseDir: base, promptBase: 'c'.repeat(40), files }));
  assert.throws(
    () => pinnedPrompt({ baseDir: base, promptBase: old, files: ['../../x.md'] }),
    /파일 이름/,
  );
});

// ---------- 구현 대기(parked): 계획만 담은 head에서 판정할 수 없는 코드 지적 (Issue #212) ----------

const PLAN_HASH = 'c'.repeat(64);
const OPENED = '2026-11-22T01:00:00Z';
const PARK_NOTE = '구현 대기: 계획만 담은 head에서는 판정하지 않는다';
const entryOf = (over: Partial<Entry> = {}): Entry => ({
  id: 'F1',
  severity: 'P1',
  reviewer: 'codex',
  file: 'src/a.ts',
  line: 3,
  title: '코드 지적',
  repro: '',
  status: 'open',
  note: '',
  round: 1,
  rejectedBy: [],
  ...over,
});
const storedWith = (...findings: Entry[]) =>
  fakeApi([
    {
      id: 1,
      user: { login: BOT },
      body: renderLedger({
        ...emptyLedger(BASE),
        rounds: [{ reviewer: 'codex', head: H1 }],
        findings,
      }),
    },
  ]);
const storedOf = (f: ReturnType<typeof fakeApi>): Ledger => {
  const l = parseLedger(f.comments[0].body);
  assert.ok(l, '저장된 원장이 없다');
  return l;
};
const planOnly = (approved: boolean | null = true) => ({
  planOnly: true,
  plan: { hash: PLAN_HASH, approved },
});
/** 편집 이력 GraphQL의 가짜. 부른 횟수를 센다 */
function gqlOf(nodes: unknown[]) {
  const g = {
    calls: 0,
    graphql: async () => {
      g.calls++;
      return {
        repository: {
          pullRequest: { comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } },
        },
      };
    },
  };
  return g;
}
/** 고쳐지지 않은 제작자의 승인 댓글(GraphQL 꼴). 지적이 게시된 뒤에 달렸다 */
const acceptNode = (id: string) => ({
  fullDatabaseId: '7000000005',
  author: { login: 'maker' },
  body: `/harness accept ${id}`,
  createdAt: '2026-11-22T02:00:00Z',
  lastEditedAt: null,
  editor: null,
  userContentEdits: { totalCount: 0 },
});

test('recordLedger(계획만 담은 head): 앞선 구현 판정의 열린 코드 지적을 구현 대기로 두고, 그 검증자의 계획 승인과 review-ledger를 막지 않는다', async () => {
  const f = storedWith(entryOf({ openedAt: OPENED }));
  // Codex가 그 지적에 대한 resolutions 없이 승인을 낸다
  const p = await record(f, { reviewer: 'codex', verdict: verdict(), headSha: H2, ...planOnly() });
  const l = storedOf(f);
  assert.deepEqual(
    l.findings.map((e) => [e.id, e.status, e.note, e.openedAt]),
    [['F1', 'parked', PARK_NOTE, OPENED]],
  );
  assert.deepEqual(l.planReview, { hash: PLAN_HASH, head: H2, approvals: ['codex'] });
  assert.equal(p.state, 'success');
  assert.match(p.description, /구현 대기 1/);
  // 같은 head에서 검증자가 구현 대기인 지적을 고쳐졌다고 해도 구현 대기로 남는다
  const again = await record(f, {
    reviewer: 'codex',
    verdict: verdict([], [{ id: 'F1', status: 'fixed', note: 'abc1234' }]),
    headSha: H2,
    ...planOnly(),
  });
  assert.deepEqual(
    storedOf(f).findings.map((e) => [e.status, e.note]),
    [['parked', PARK_NOTE]],
  );
  assert.equal(again.state, 'success');
  // 판정이 없는 기록(해당 없음·이어받음)도 구현 대기로 둔다
  const g = storedWith(entryOf({ openedAt: OPENED }));
  const none = await record(g, { reviewer: 'claude', headSha: H2, ...planOnly(null) });
  assert.equal(storedOf(g).findings[0].status, 'parked');
  assert.equal(none.state, 'success');
});

test('recordLedger(코드가 섞인 head): 구현 대기를 판정 전에 열림으로 되돌린다. 해소되지 않으면 review-ledger가 막는다', async () => {
  const parked = () => storedWith(entryOf({ status: 'parked', note: PARK_NOTE, openedAt: OPENED }));
  // 그 판정이 고쳐졌다고 하면 닫힌다
  const fixed = parked();
  const ok = await record(fixed, {
    reviewer: 'codex',
    verdict: verdict([], [{ id: 'F1', status: 'fixed', note: 'abc1234' }]),
    headSha: H2,
    changedSinceLastRound: ['src/a.ts'],
  });
  assert.deepEqual(
    storedOf(fixed).findings.map((e) => [e.status, e.note]),
    [['fixed', 'abc1234']],
  );
  assert.equal(ok.state, 'success');
  assert.doesNotMatch(ok.description, /구현 대기/);
  // 열려 있다고 하거나 판정을 내지 않으면 열린 채로 막는다
  for (const resolutions of [[{ id: 'F1', status: 'open' as const, note: '' }], []]) {
    const f = parked();
    const p = await record(f, {
      reviewer: 'codex',
      verdict: verdict([], resolutions),
      headSha: H2,
      changedSinceLastRound: ['src/a.ts'],
    });
    assert.equal(storedOf(f).findings[0].status, 'open');
    assert.equal(storedOf(f).findings[0].openedAt, OPENED);
    assert.equal(p.state, 'failure');
    assert.match(p.description, /열린 차단 지적 1건: F1/);
  }
  // 판정이 없어도(해당 없음, 이어받음, error) 되돌려 저장하고 막는다
  const f = parked();
  const p = await record(f, { reviewer: 'claude', headSha: H2 });
  assert.equal(storedOf(f).findings[0].status, 'open');
  assert.equal(p.state, 'failure');
  // 계획 승인을 기록하지 못한 계획 전용 head(--mode가 plan이 아니다)도 코드가 섞인 것으로 본다
  const unknown = parked();
  const q = await record(unknown, { reviewer: 'codex', verdict: verdict(), headSha: H2 });
  assert.equal(storedOf(unknown).findings[0].status, 'open');
  assert.equal(q.state, 'failure');
});

test('recordLedger: 구현 대기뿐인 원장도 코드가 섞인 head의 첫 기록에서 제작자 승인을 조회해 반영한다', async () => {
  const parked = () => storedWith(entryOf({ status: 'parked', note: PARK_NOTE, openedAt: OPENED }));
  const f = parked();
  const g = gqlOf([acceptNode('F1')]);
  const p = await record(f, {
    reviewer: 'claude',
    headSha: H2,
    owner: 'maker',
    api: { ...f.api, graphql: g.graphql },
  });
  assert.equal(g.calls, 1, '저장된 원장에 open·accepted가 없어도 조회한다');
  assert.deepEqual(
    storedOf(f).findings.map((e) => [e.status, e.note]),
    [['accepted', '제작자 승인(댓글 7000000005)']],
  );
  assert.equal(p.state, 'success');
  assert.match(p.description, /제작자 승인 1/);
  // 계획만 담은 head의 기록에서는 구현 대기로 남고 승인되지 않는다
  const h = parked();
  const g2 = gqlOf([acceptNode('F1')]);
  const q = await record(h, {
    reviewer: 'claude',
    headSha: H2,
    owner: 'maker',
    api: { ...h.api, graphql: g2.graphql },
    ...planOnly(null),
  });
  assert.equal(storedOf(h).findings[0].status, 'parked');
  assert.equal(q.state, 'success');
  assert.match(q.description, /구현 대기 1/);
  assert.doesNotMatch(q.description, /제작자 승인/);
});

test('recordLedger(계획만 담은 head): 승인 댓글이 지워진 accepted 코드 지적은 열림이 아니라 구현 대기로 저장된다', async () => {
  const f = storedWith(
    entryOf({ status: 'accepted', note: '제작자 승인(댓글 7000000005)', openedAt: OPENED }),
  );
  const g = gqlOf([]);
  const p = await record(f, {
    reviewer: 'codex',
    verdict: verdict([], [{ id: 'F1', status: 'fixed', note: 'abc1234' }]),
    headSha: H2,
    owner: 'maker',
    api: { ...f.api, graphql: g.graphql },
    ...planOnly(),
  });
  assert.equal(g.calls, 1);
  assert.deepEqual(
    storedOf(f).findings.map((e) => [e.status, e.note, e.openedAt]),
    [['parked', PARK_NOTE, OPENED]],
  );
  assert.equal(p.state, 'success');
  // 승인 댓글이 남아 있으면 accepted 그대로다
  const kept = storedWith(
    entryOf({ status: 'accepted', note: '제작자 승인(댓글 7000000005)', openedAt: OPENED }),
  );
  await record(kept, {
    reviewer: 'codex',
    verdict: verdict(),
    headSha: H2,
    owner: 'maker',
    api: { ...kept.api, graphql: gqlOf([acceptNode('F1')]).graphql },
    ...planOnly(),
  });
  assert.equal(storedOf(kept).findings[0].status, 'accepted');
});

test('recordLedger: 계획 전용 판정에서 등록된 지적은 구현 대기로 두지 않는다. 등록할 때의 규칙(동결)은 그대로다', async () => {
  const f = fakeApi([]);
  // 그 검증자의 1라운드: 위치가 코드 파일인 새 P1도 열림으로 등록되고 planRound가 붙는다
  const r1 = await record(f, {
    reviewer: 'codex',
    verdict: verdict([finding({ title: '계획이 빠뜨린 것' })]),
    ...planOnly(false),
  });
  assert.equal(r1.state, 'failure');
  assert.deepEqual(
    storedOf(f).findings.map((e) => [e.id, e.status, e.planRound]),
    [['F1', 'open', true]],
  );
  // 다음 계획 전용 기록에서도 구현 대기가 되지 않는다(그 검증자가 닫을 때까지)
  const other = await record(f, { reviewer: 'claude', headSha: H2, ...planOnly(null) });
  assert.equal(storedOf(f).findings[0].status, 'open');
  assert.equal(other.state, 'failure');
  // 2라운드부터의 동결: 직전 판정 뒤 바뀌지 않은 파일의 재현되지 않은 새 P1은 deferred로 등록된다
  const r2 = await record(f, {
    reviewer: 'codex',
    verdict: verdict(
      [finding({ file: 'src/old.ts', title: '뒤늦은 P1' })],
      [{ id: 'F1', status: 'fixed', note: 'abc1234' }],
    ),
    headSha: H2,
    changedSinceLastRound: ['docs/exec-plans/active/20261122-demo/step0.md'],
    ...planOnly(true),
  });
  assert.deepEqual(
    storedOf(f).findings.map((e) => [e.id, e.status, e.planRound]),
    [
      ['F1', 'fixed', true],
      ['F2', 'deferred', true],
    ],
  );
  assert.equal(r2.state, 'success');
  assert.doesNotMatch(r2.description, /구현 대기/);
});

test('recordLedger(계획만 담은 head): 그 판정이 다시 연 코드 지적도 같은 기록에서 구현 대기가 된다 (판정 지적 F7)', async () => {
  // 앞선 구현 판정에서 고쳐진 코드 지적. 계획만 남긴 head에는 고친 코드도 없어 검증자가 다시 열 수 있다
  const fixed = () => storedWith(entryOf({ status: 'fixed', note: 'abc1234', openedAt: OPENED }));
  // (가) resolutions로 다시 연다
  const a = fixed();
  const pa = await record(a, {
    reviewer: 'codex',
    verdict: verdict([], [{ id: 'F1', status: 'open', note: '고친 코드가 없다' }]),
    headSha: H2,
    ...planOnly(false),
  });
  assert.deepEqual(
    storedOf(a).findings.map((e) => [e.id, e.status, e.note]),
    [['F1', 'parked', PARK_NOTE]],
  );
  assert.equal(pa.state, 'success');
  assert.match(pa.description, /구현 대기 1/);
  // (나) 같은 지적을 다시 등록한다(회귀로 다시 열린다)
  const b = fixed();
  const pb = await record(b, {
    reviewer: 'codex',
    verdict: verdict([finding({ title: '코드 지적' })]),
    headSha: H2,
    ...planOnly(false),
  });
  assert.deepEqual(
    storedOf(b).findings.map((e) => [e.id, e.status]),
    [['F1', 'parked']],
  );
  assert.equal(pb.state, 'success');
  // 계획 전용 판정에서 등록된 지적은 다시 열려도 구현 대기가 되지 않고 막는다
  const c = storedWith(
    entryOf({ status: 'fixed', note: 'abc1234', planRound: true, openedAt: OPENED }),
  );
  const pc = await record(c, {
    reviewer: 'codex',
    verdict: verdict([], [{ id: 'F1', status: 'open', note: '아직' }]),
    headSha: H2,
    ...planOnly(false),
  });
  assert.equal(storedOf(c).findings[0].status, 'open');
  assert.equal(pc.state, 'failure');
  // 코드가 섞인 head에서 다시 연 지적은 지금처럼 열린 채 막는다
  const d = fixed();
  const pd = await record(d, {
    reviewer: 'codex',
    verdict: verdict([], [{ id: 'F1', status: 'open', note: '아직' }]),
    headSha: H2,
    changedSinceLastRound: ['src/a.ts'],
  });
  assert.equal(storedOf(d).findings[0].status, 'open');
  assert.equal(pd.state, 'failure');
});

const PARKED_LINE =
  '- 상태 parked: 구현 대기. 이 head는 계획 파일만 담고 있어 그 지적이 가리키는 코드가 없다. 판정 대상이 아니고, 코드가 다시 올라온 head에서 open으로 돌아간다';

test('writeRoundInput: 구현 대기인 지적이 있으면 원장 파일에 그 뜻을 한 줄 적는다. 없으면 적지 않는다', () => {
  const { root } = roundRepo();
  const file = path.join(root, '.harness-review/ledger.md');
  const base = ledgerWith([finding(), finding({ title: '다른 지적' })], 'codex');
  writeRoundInput({ root, ledger: base, reviewer: 'claude' });
  assert.ok(
    !readFileSync(file, 'utf8').includes('parked'),
    '구현 대기가 없으면 지금의 출력과 같다',
  );
  const parked: Ledger = {
    ...base,
    findings: base.findings.map((e, i) =>
      i === 0 ? { ...e, status: 'parked' as const, note: PARK_NOTE } : e,
    ),
  };
  writeRoundInput({ root, ledger: parked, reviewer: 'claude' });
  const md = readFileSync(file, 'utf8');
  assert.equal(md.split(PARKED_LINE).length - 1, 1);
  const lines = md.split('\n');
  // 머리 항목들의 끝(표 앞의 빈 줄 바로 앞)에 있다
  const at = lines.indexOf(PARKED_LINE);
  assert.equal(lines[at + 1], '');
  assert.match(lines[at + 2], /^ID \| 등급 \| 검증자 \| 상태 /);
  assert.match(lines[at - 1], /^- /);
  assert.match(md, /^F1 \| P1 \| codex \| parked \| src\/a\.ts:3 \| /m);
  assert.match(md, /^F2 \| P1 \| codex \| open \| /m);
});

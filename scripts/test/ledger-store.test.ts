// 원장 댓글 저장소와 기록 job 연결, 검증자 입력(라운드). 계획 20261115-review-ledger step1.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { applyVerdict, emptyLedger, parseLedger, renderLedger, type Ledger } from '../ci/ledger.ts';
import {
  loadLedger,
  recordCiFailure,
  recordLedger,
  saveLedger,
  type LedgerApi,
} from '../ci/ledger-store.ts';
import type { StatusPayload } from '../ci/results.ts';
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
  assert.deepEqual(r, { round: 1, promptBase: '', changed: null });
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

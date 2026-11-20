// 제작자 승인: 실제 명령(review-plan, record-review)을 가짜 GitHub API 서버로 구동해 호출부의 연결을 확인한다.
// plan job이 판정 job에 넘기는 원장, 기록 job이 저장하는 원장과 review-ledger, 오류 응답의 본문이 밖으로 나가지 않는 것.
// 계획 20261120-p0-maker-approval step1.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';
import {
  emptyLedger,
  parseLedger,
  parseLedgerData,
  renderLedger,
  type Ledger,
} from '../ci/ledger.ts';
import { HARNESS_ROOT, commitAll, gitInit, sh, tmp, write } from './helpers.ts';

const BOT = 'harness-recorder[bot]';
const OWNER = 'maker';
const BASE = 'a'.repeat(40);
const HEAD = '1'.repeat(40);
const HARNESS = path.join(HARNESS_ROOT, 'scripts/harness.ts');
const SECRET = 'SECRET-COMMENT-TEXT';
const T_LEDGER = '2026-11-20T01:00:00Z';
const T_ACCEPT = '2026-11-20T01:05:00Z';

/** codex가 낸 P0 하나(F1)가 열려 있는 원장. 게시 시각은 아직 채워지지 않았다 */
const ledger = (): Ledger => ({
  ...emptyLedger(BASE),
  rounds: [{ reviewer: 'codex', head: HEAD }],
  findings: [
    {
      id: 'F1',
      severity: 'P0',
      reviewer: 'codex',
      file: 'src/a.ts',
      line: 3,
      title: '남은 틈',
      repro: '',
      status: 'open',
      note: '',
      round: 1,
      rejectedBy: [],
    },
  ],
});
/** 실제 댓글 번호는 32비트를 넘고, GraphQL은 fullDatabaseId(문자열)로 준다 */
const CID = '7027568658';
const acceptNode = (over: Record<string, unknown> = {}) => ({
  fullDatabaseId: CID,
  author: { login: OWNER },
  body: '/harness accept F1',
  createdAt: T_ACCEPT,
  lastEditedAt: null,
  editor: null,
  userContentEdits: { totalCount: 0 },
  ...over,
});

const state = {
  ledgerBody: '',
  gql: [] as Record<string, unknown>[],
  /** ok | http500 | errors */
  gqlMode: 'ok',
  gqlCalls: 0,
  patches: [] as string[],
  statuses: [] as { context: string; state: string; description: string }[],
  /** 서버가 받은 모든 요청 본문(GraphQL 요청 제외) */
  received: [] as string[],
};
let server: Server;
let api = '';

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      const json = (code: number, v: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      if (req.method === 'POST' && url === '/graphql') {
        state.gqlCalls++;
        const nodes = state.gql;
        const data = {
          repository: {
            pullRequest: {
              comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes },
            },
          },
        };
        if (state.gqlMode === 'http500') return json(500, { message: SECRET, data });
        if (state.gqlMode === 'errors') return json(200, { errors: [{ message: SECRET }], data });
        return json(200, { data });
      }
      state.received.push(body);
      if (req.method === 'POST' && /^\/repos\/o\/r\/statuses\/[0-9a-f]{40}$/.test(url)) {
        state.statuses.push(JSON.parse(body));
        return json(201, {});
      }
      if (req.method === 'GET' && url === '/repos/o/r/pulls/7')
        return json(200, { user: { login: 'writer-bot' } });
      if (req.method === 'GET' && url.startsWith('/repos/o/r/issues/7/comments'))
        return json(200, [
          { id: 500, user: { login: BOT }, body: state.ledgerBody, updated_at: T_LEDGER },
          // REST 목록에도 승인 댓글이 보인다(판별에는 쓰지 않는다)
          {
            id: Number(CID),
            user: { login: OWNER },
            body: '/harness accept F1',
            updated_at: T_ACCEPT,
          },
        ]);
      if (req.method === 'PATCH' && url === '/repos/o/r/issues/comments/500') {
        state.ledgerBody = JSON.parse(body).body;
        state.patches.push(state.ledgerBody);
        return json(200, {});
      }
      json(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

function reset(gql: Record<string, unknown>[] = [acceptNode()], gqlMode = 'ok') {
  state.ledgerBody = renderLedger(ledger());
  state.gql = gql;
  state.gqlMode = gqlMode;
  state.gqlCalls = 0;
  state.patches = [];
  state.statuses = [];
  state.received = [];
}

/** 하네스 설정에서 제작자 계정만 바꾼 설정 폴더(기록 job의 --config-root) */
function configRoot(owner: string): string {
  const dir = tmp();
  const cfg = JSON.parse(readFileSync(path.join(HARNESS_ROOT, 'harness.config.json'), 'utf8'));
  cfg.github.owner = owner;
  writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify(cfg, null, 2));
  return dir;
}

function run(args: string[], env: Record<string, string>): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HARNESS, ...args], {
      cwd: HARNESS_ROOT,
      env: { ...process.env, GITHUB_API_URL: api, ...env },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

/** plan job의 review-plan. job 출력의 ledger 값을 읽어 돌려준다 */
async function reviewPlan(owner: string) {
  const root = tmp();
  gitInit(root);
  write(root, 'src/a.ts', 'a\n');
  const base = commitAll(root, 'base');
  sh('git', ['checkout', '-q', '-b', 'feat/x'], root);
  write(root, 'src/a.ts', 'b\n');
  commitAll(root, 'change');
  const output = path.join(tmp(), 'out');
  writeFileSync(output, '');
  const r = await run(
    [
      'review-plan',
      '--repo',
      root,
      '--config-root',
      configRoot(owner),
      '--base',
      base,
      '--head-ref',
      'feat/x',
      '--pr-number',
      '7',
      '--reviewer',
      'codex',
    ],
    { GH_TOKEN: 'read-token', GITHUB_OUTPUT: output, GITHUB_REPOSITORY: 'o/r' },
  );
  const outputs = Object.fromEntries(
    readFileSync(output, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  const handed = outputs.ledger ? parseLedgerData(outputs.ledger) : null;
  const md = path.join(root, '.harness-review/ledger.md');
  return { ...r, handed, md: readFileSync(md, 'utf8') };
}

/** 기록 job의 record-review(승인 판정, 지적 없음) */
async function recordReview(owner: string) {
  const file = path.join(tmp(), 'verdict.json');
  writeFileSync(
    file,
    JSON.stringify({ verdict: 'approve', risk: 'normal', summary: '요약', findings: [] }),
  );
  return run(
    [
      'record-review',
      '--context',
      'review/claude',
      '--needed',
      'true',
      '--verdict',
      file,
      '--head-sha',
      HEAD,
      '--repo-slug',
      'o/r',
      '--target-url',
      'https://github.com/o/r/actions/runs/1',
      '--patch',
      'b'.repeat(40),
      '--carried-from',
      '',
      '--config-root',
      configRoot(owner),
      '--pr-number',
      '7',
      '--prompt-base',
      BASE,
    ],
    { GH_TOKEN: 'status-token', LEDGER_TOKEN: 'ledger-token' },
  );
}
const ledgerStatus = () => state.statuses.find((s) => s.context === 'review-ledger');
const noSecret = (text: string, where: string) =>
  assert.equal(text.includes(SECRET), false, `${where}에 오류 응답의 문구가 있다`);

test('review-plan: 제작자의 유효한 승인이 있으면 판정 job에 넘기는 원장에서 그 지적이 accepted다', async () => {
  reset();
  const r = await reviewPlan(OWNER);
  assert.equal(r.code, 0, r.out);
  const e = r.handed?.findings[0];
  assert.deepEqual([e?.id, e?.status, e?.openedAt], ['F1', 'accepted', T_LEDGER]);
  assert.match(r.out, /review-plan: 제작자 승인 1건\(F1\)/);
  // 검증자가 읽는 입력 파일에도 같다
  assert.match(r.md, /F1 \| P0 \| codex \| accepted/);
  // plan job은 원장을 쓰지 않는다
  assert.equal(state.patches.length, 0);
});

test('review-plan: 고쳐진 댓글·다른 제작자 설정이면 open으로 넘긴다', async () => {
  // 편집 이력만 "고쳐짐"이다. REST 목록의 그 댓글은 그대로다
  reset([acceptNode({ lastEditedAt: T_ACCEPT, editor: { login: 'writer-bot' } })]);
  const edited = await reviewPlan(OWNER);
  assert.equal(edited.code, 0, edited.out);
  assert.equal(edited.handed?.findings[0].status, 'open');
  assert.doesNotMatch(edited.out, /제작자 승인 \d+건/);
  assert.match(edited.md, /F1 \| P0 \| codex \| open/);
  // 설정의 제작자 계정이 다르다: 같은 댓글이 반영되지 않는다
  reset();
  const other = await reviewPlan('someone-else');
  assert.equal(other.code, 0, other.out);
  assert.equal(other.handed?.findings[0].status, 'open');
});

test('review-plan: 편집 이력을 읽지 못하면 저장된 원장을 넘기고 알린다. 오류 응답의 본문은 나가지 않는다', async () => {
  for (const mode of ['http500', 'errors']) {
    reset([acceptNode({ body: `/harness accept F1\n${SECRET}` })], mode);
    const r = await reviewPlan(OWNER);
    assert.equal(r.code, 0, `${mode}: ${r.out}`);
    assert.equal(state.gqlCalls, 1, mode);
    assert.equal(r.handed?.findings[0].status, 'open', mode);
    assert.match(
      r.out,
      /review-plan: 제작자 승인을 확인하지 못했다\(저장된 원장을 그대로 쓴다\)/,
      mode,
    );
    noSecret(r.out, `${mode} review-plan 출력`);
    noSecret(r.md, `${mode} ledger.md`);
  }
});

test('record-review: 승인을 원장 댓글에 저장하고 review-ledger가 통과한다', async () => {
  reset();
  const r = await recordReview(OWNER);
  assert.equal(r.code, 0, r.out);
  assert.equal(state.patches.length, 1);
  const e = parseLedger(state.patches[0])?.findings[0];
  assert.deepEqual(
    [e?.status, e?.note, e?.openedAt],
    ['accepted', `제작자 승인(댓글 ${CID})`, T_LEDGER],
  );
  assert.deepEqual(
    state.statuses.map((s) => [s.context, s.state]),
    [
      ['review/claude', 'success'],
      ['review-ledger', 'success'],
    ],
  );
  assert.match(ledgerStatus()?.description ?? '', /제작자 승인 1/);
  assert.match(r.out, /record-review: 제작자 승인 F1\(댓글 7027568658\)/);
  // 로그에 댓글 본문은 없다
  assert.doesNotMatch(r.out, /\/harness accept/);
});

test('record-review: 반영하지 않은 승인과 철회를 로그에 남긴다', async () => {
  // P0이 아닌 지적과 없는 지적을 함께 승인한 댓글
  reset([acceptNode(), acceptNode({ fullDatabaseId: '7027568659', body: '/harness accept F9' })]);
  const r = await recordReview(OWNER);
  assert.match(r.out, /record-review: 제작자 승인 F1\(댓글 7027568658\)/);
  assert.match(r.out, /record-review: 제작자 승인 무시 F9\(댓글 7027568659\): 원장에 없는 지적/);
  // 승인 댓글이 사라졌다: 다시 열리고 review-ledger가 실패한다
  state.gql = [];
  state.statuses = [];
  const gone = await recordReview(OWNER);
  assert.match(gone.out, /record-review: 제작자 승인 철회 F1/);
  assert.equal(parseLedger(state.ledgerBody)?.findings[0].status, 'open');
  assert.equal(ledgerStatus()?.state, 'failure');
});

test('record-review: 고쳐진 댓글·다른 제작자 설정이면 반영하지 않는다', async () => {
  reset([acceptNode({ userContentEdits: { totalCount: 2 } })]);
  const edited = await recordReview(OWNER);
  assert.equal(edited.code, 0, edited.out);
  assert.equal(parseLedger(state.ledgerBody)?.findings[0].status, 'open');
  assert.equal(ledgerStatus()?.state, 'failure');
  reset();
  const other = await recordReview('someone-else');
  assert.equal(other.code, 0, other.out);
  assert.equal(parseLedger(state.ledgerBody)?.findings[0].status, 'open');
  assert.equal(ledgerStatus()?.state, 'failure');
});

test('record-review: 편집 이력을 읽지 못하면 원장을 쓰지 않고 review-ledger가 error다. 오류 응답의 본문은 나가지 않는다', async () => {
  for (const mode of ['http500', 'errors']) {
    reset([acceptNode({ body: `/harness accept F1\n${SECRET}` })], mode);
    const r = await recordReview(OWNER);
    assert.equal(r.code, 0, `${mode}: ${r.out}`);
    assert.equal(state.gqlCalls, 1, mode);
    assert.equal(state.patches.length, 0, mode);
    assert.deepEqual(
      state.statuses.map((s) => [s.context, s.state]),
      [
        ['review/claude', 'success'],
        ['review-ledger', 'error'],
      ],
      mode,
    );
    noSecret(r.out, `${mode} record-review 출력`);
    noSecret(JSON.stringify(state.statuses), `${mode} 상태 설명`);
    noSecret(state.received.join('\n'), `${mode} 서버가 받은 요청`);
  }
});

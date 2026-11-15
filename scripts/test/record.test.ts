// record-review·review-plan 명령과 지적 원장의 연결을 가짜 GitHub API 서버로 확인한다. 계획 20261115-review-ledger step1.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { ledgerData, parseLedger, parseLedgerData } from '../ci/ledger.ts';
import { HARNESS_ROOT, commitAll, gitInit, sh, tmp, write } from './helpers.ts';

const BOT = 'harness-recorder[bot]';
const BASE = 'a'.repeat(40);
const HEAD = '1'.repeat(40);
const HARNESS = path.join(HARNESS_ROOT, 'scripts/harness.ts');

interface Comment {
  id: number;
  user: { login: string };
  body: string;
}
const state = {
  comments: [] as Comment[],
  statuses: [] as { sha: string; context: string; state: string; description: string }[],
  auth: [] as string[],
  failComments: false,
};
let server: Server;
let api = '';

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      state.auth.push(`${req.method} ${url.split('?')[0]} ${req.headers.authorization ?? ''}`);
      const json = (code: number, v: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      const status = /^\/repos\/o\/r\/statuses\/([0-9a-f]{40})$/.exec(url);
      if (req.method === 'POST' && status) {
        state.statuses.push({ sha: status[1], ...JSON.parse(body) });
        return json(201, {});
      }
      if (url.startsWith('/repos/o/r/issues/7/comments')) {
        if (state.failComments) return json(403, { message: 'Resource not accessible' });
        if (req.method === 'GET') return json(200, state.comments);
        if (req.method === 'POST') {
          state.comments.push({
            id: 100 + state.comments.length,
            user: { login: BOT },
            body: JSON.parse(body).body,
          });
          return json(201, {});
        }
      }
      const edit = /^\/repos\/o\/r\/issues\/comments\/(\d+)$/.exec(url);
      const c = edit && state.comments.find((x) => x.id === Number(edit[1]));
      if (req.method === 'PATCH' && c) {
        c.body = JSON.parse(body).body;
        return json(200, {});
      }
      json(404, { message: 'not found' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

function reset() {
  state.comments = [];
  state.statuses = [];
  state.auth = [];
  state.failComments = false;
}

/** 서버가 같은 프로세스에 있어 동기 실행은 쓸 수 없다 */
function run(
  args: string[],
  env: Record<string, string>,
  cwd = HARNESS_ROOT,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [HARNESS, ...args], {
      cwd,
      env: { ...process.env, GITHUB_API_URL: api, ...env },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

const finding = (over: Record<string, unknown> = {}) => ({
  severity: 'P1',
  file: 'src/a.ts',
  line: 3,
  title: '만료 토큰을 허용함',
  evidence: '근거',
  suggestion: '제안',
  ...over,
});
function verdictFile(v: Record<string, unknown>): string {
  const f = path.join(tmp(), 'verdict.json');
  writeFileSync(
    f,
    JSON.stringify({ verdict: 'approve', risk: 'normal', summary: '요약', findings: [], ...v }),
  );
  return f;
}
const recordArgs = (file: string, extra: string[] = []) => [
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
  ...extra,
];
const ledgerArgs = ['--config-root', HARNESS_ROOT, '--pr-number', '7', '--prompt-base', BASE];
const tokens = { GH_TOKEN: 'status-token', LEDGER_TOKEN: 'ledger-token' };

test('record-review: PR 번호가 없으면 원장을 건드리지 않는다(기존 동작)', async () => {
  reset();
  const r = await run(recordArgs(verdictFile({})), tokens);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(
    state.statuses.map((s) => s.context),
    ['review/claude'],
  );
  assert.equal(state.comments.length, 0);
});

test('record-review: 판정을 원장 댓글에 반영하고 review/*와 review-ledger를 head에 기록한다', async () => {
  reset();
  const v = verdictFile({
    verdict: 'request_changes',
    findings: [finding(), finding({ severity: 'P2', title: '이름' })],
  });
  const r = await run(recordArgs(v, ledgerArgs), tokens);
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(
    state.statuses.map((s) => [s.sha, s.context, s.state]),
    [
      [HEAD, 'review/claude', 'failure'],
      [HEAD, 'review-ledger', 'failure'],
    ],
  );
  assert.match(state.statuses[1].description, /1건: F1/);
  const l = parseLedger(state.comments[0].body);
  assert.deepEqual(
    l?.findings.map((e) => [e.id, e.status]),
    [
      ['F1', 'open'],
      ['F2', 'deferred'],
    ],
  );
  assert.equal(l?.promptBase, BASE);
  // 상태는 상태 토큰으로, 댓글은 원장 토큰으로만 쓴다
  for (const a of state.auth)
    assert.match(a, /statuses/.test(a) ? /Bearer status-token$/ : /Bearer ledger-token$/, a);

  // 2라운드: 지적한 검증자가 고쳤다고 하면 review-ledger가 통과한다. 바뀐 파일 목록은 base64 JSON으로 받는다
  const v2 = verdictFile({ resolutions: [{ id: 'F1', status: 'fixed', note: 'a1b2c3d' }] });
  const changed = Buffer.from(JSON.stringify(['src/a.ts'])).toString('base64');
  const r2 = await run(recordArgs(v2, [...ledgerArgs, '--round-changed', changed]), tokens);
  assert.equal(r2.code, 0, r2.out);
  assert.deepEqual(
    state.statuses.slice(2).map((s) => [s.context, s.state]),
    [
      ['review/claude', 'success'],
      ['review-ledger', 'success'],
    ],
  );
  assert.equal(state.comments.length, 1);
  assert.equal(parseLedger(state.comments[0].body)?.findings[0].status, 'fixed');
});

test('record-review: 원장 토큰이 없거나 댓글 API가 막혀도 review/*는 기록하고 review-ledger만 error', async () => {
  reset();
  const v = verdictFile({});
  const noToken = await run(recordArgs(v, ledgerArgs), {
    GH_TOKEN: 'status-token',
    LEDGER_TOKEN: '',
  });
  assert.equal(noToken.code, 0, noToken.out);
  assert.deepEqual(
    state.statuses.map((s) => [s.context, s.state]),
    [
      ['review/claude', 'success'],
      ['review-ledger', 'error'],
    ],
  );
  assert.match(state.statuses[1].description, /Pull requests/);
  reset();
  state.failComments = true;
  const denied = await run(recordArgs(v, ledgerArgs), tokens);
  assert.equal(denied.code, 0, denied.out);
  assert.deepEqual(
    state.statuses.map((s) => [s.context, s.state]),
    [
      ['review/claude', 'success'],
      ['review-ledger', 'error'],
    ],
  );
  assert.match(state.statuses[1].description, /HTTP 403/);
  // 오류 문구에 응답 본문을 옮기지 않는다
  assert.doesNotMatch(state.statuses[1].description, /Resource not accessible/);
});

test('review-plan: plan job은 원장을 읽어 출력으로 넘기고, 판정 job은 토큰 없이 그 값으로 입력을 만든다', async () => {
  reset();
  // 원장 만들기
  const v = verdictFile({ verdict: 'request_changes', findings: [finding()] });
  await run(recordArgs(v, ledgerArgs), tokens);
  const stored = parseLedger(state.comments[0].body);
  assert.ok(stored);
  // 봇이 아닌 계정의 같은 표식 댓글이 앞에 있어도 읽지 않는다
  state.comments.unshift({ id: 1, user: { login: 'someone' }, body: state.comments[0].body });

  const root = tmp();
  gitInit(root);
  write(
    root,
    'harness.config.json',
    readFileSync(path.join(HARNESS_ROOT, 'harness.config.json'), 'utf8'),
  );
  write(root, 'src/a.ts', 'a\n');
  const base = commitAll(root, 'base');
  sh('git', ['checkout', '-q', '-b', 'feat/x'], root);
  write(root, 'src/a.ts', 'b\n');
  commitAll(root, 'change');
  const out1 = path.join(tmp(), 'out1');
  writeFileSync(out1, '');
  const common = [
    'review-plan',
    '--repo',
    root,
    '--config-root',
    HARNESS_ROOT,
    '--base',
    base,
    '--head-ref',
    'feat/x',
  ];
  const plan = await run([...common, '--pr-number', '7', '--reviewer', 'claude'], {
    GH_TOKEN: 'read-token',
    GITHUB_OUTPUT: out1,
    GITHUB_REPOSITORY: 'o/r',
  });
  assert.equal(plan.code, 0, plan.out);
  const outputs = Object.fromEntries(
    readFileSync(out1, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  );
  assert.equal(outputs.round, '2');
  assert.equal(outputs.prompt_base, BASE);
  assert.deepEqual(parseLedgerData(outputs.ledger), stored);
  // 직전 판정 head(HEAD)는 이 저장소에 없다: 바뀐 파일을 모른다
  assert.equal(outputs.round_changed, '');
  const md = path.join(root, '.harness-review/ledger.md');
  assert.match(readFileSync(md, 'utf8'), /F1 \| P1 \| claude \| open/);

  // 판정 job: 토큰·PR 번호 없이 받은 원장으로 같은 입력을 만든다
  const calls = state.auth.length;
  const out2 = path.join(tmp(), 'out2');
  writeFileSync(out2, '');
  const judge = await run([...common, '--ledger', ledgerData(stored), '--reviewer', 'codex'], {
    GH_TOKEN: '',
    GITHUB_OUTPUT: out2,
  });
  assert.equal(judge.code, 0, judge.out);
  assert.equal(state.auth.length, calls, 'judge 경로가 API를 불렀다');
  assert.match(readFileSync(md, 'utf8'), /검증자: codex/);
  assert.match(readFileSync(out2, 'utf8'), /^round=1$/m);
  // 원장이 없으면(빈 값) 원장 입력을 쓰지 않는다. 깨진 값은 실패
  const none = await run([...common, '--ledger', '', '--reviewer', 'codex'], {
    GITHUB_OUTPUT: out2,
  });
  assert.equal(none.code, 0, none.out);
  assert.equal(existsSync(md), false);
  const bad = await run([...common, '--ledger', 'AAAA', '--reviewer', 'codex'], {
    GITHUB_OUTPUT: out2,
  });
  assert.equal(bad.code, 1, bad.out);
});

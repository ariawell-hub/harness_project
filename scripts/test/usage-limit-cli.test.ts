// 사용 한도(Issue #223): 판정 job의 codex-scan → codex-unavailable → 기록 job의 record-review를 실제 명령(자식 프로세스)으로
// 잇고, 가짜 GitHub API가 받은 review/codex 상태를 본다. 자격증명 없이 워크플로의 값 전달을 병합 전에 확인한다(계획 수용 기준 6).
// 워크플로가 job 사이에 넘기는 값(steps.why.outputs.unavailable → needs.judge.outputs.unavailable → UNAVAILABLE)을
// GITHUB_OUTPUT 파일의 줄로 흉내 낸다. 판정 job이 실패하면 verdict 출력이 비므로 record-review의 판정 파일은 없다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { HARNESS_ROOT, tmp } from './helpers.ts';

const HARNESS = path.join(HARNESS_ROOT, 'scripts/harness.ts');
const HEAD = '1'.repeat(40);

const statuses: { url: string; context: string; state: string; description: string }[] = [];
let server: Server;
let api = '';

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = req.url ?? '';
      if (req.method === 'POST' && /^\/repos\/o\/r\/statuses\/[0-9a-f]{40}$/.test(url)) {
        statuses.push({ url, ...JSON.parse(body) });
        res.writeHead(201, { 'content-type': 'application/json' });
        return res.end('{}');
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"message":"not found"}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

/** 명령을 실행한다. 러너의 변수(GITHUB_OUTPUT 등)는 물려주지 않고 env만 넘긴다 */
function run(args: string[], cwd: string, env: Record<string, string> = {}) {
  return new Promise<{ code: number; out: string }>((resolve) => {
    const p = spawn(process.execPath, [HARNESS, ...args], {
      cwd,
      env: { PATH: process.env.PATH ?? '', ...env },
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code: code ?? -1, out }));
  });
}

/** turn.failed 하나로 끝난 Codex 실행 기록으로 세 명령을 잇는다 */
async function chain(message: string) {
  const dir = tmp('usage-limit-cli-');
  const pr = path.join(dir, 'pr');
  mkdirSync(pr, { recursive: true });
  const events = path.join(dir, 'events.jsonl');
  const last = path.join(dir, 'last.txt');
  const verdict = path.join(dir, 'verdict.json');
  const file = path.join(dir, 'codex-unavailable.txt');
  const output = path.join(dir, 'github-output');
  writeFileSync(
    events,
    [
      { type: 'thread.started', thread_id: 't' },
      { type: 'turn.failed', error: { message } },
    ]
      .map((e) => JSON.stringify(e))
      .join('\n') + '\n',
  );
  writeFileSync(last, '');
  writeFileSync(output, '');

  // 판정 job의 scan 단계: 판정 없이 실패하고 한도 값은 파일에만 쓴다
  const scan = await run(
    [
      'codex-scan',
      ...['--events', events, '--last', last, '--pr', pr, '--out', verdict],
      ...['--unavailable-out', file],
    ],
    dir,
    { GITHUB_OUTPUT: output },
  );
  assert.equal(scan.code, 1, scan.out);
  assert.equal(existsSync(verdict), false);
  assert.equal(readFileSync(output, 'utf8'), '', 'scan 단계는 job 출력을 쓰지 않는다');

  // why 단계: 파일을 검사해 job 출력으로 넘긴다
  const why = await run(['codex-unavailable', '--file', file], dir, { GITHUB_OUTPUT: output });
  assert.equal(why.code, 0, why.out);
  const lines = readFileSync(output, 'utf8').split('\n').filter(Boolean);
  const value = lines.find((l) => l.startsWith('unavailable='))?.slice('unavailable='.length) ?? '';

  // 기록 job의 record-review: 워크플로는 값이 없어도 --unavailable "$UNAVAILABLE"(빈 글)을 넘긴다
  statuses.length = 0;
  const rec = await run(
    [
      'record-review',
      ...['--context', 'review/codex', '--needed', 'true', '--verdict', verdict],
      ...['--head-sha', HEAD, '--repo-slug', 'o/r'],
      ...['--target-url', 'https://github.com/o/r/actions/runs/1', '--unavailable', value],
    ],
    dir,
    { GH_TOKEN: 'status-token', GITHUB_API_URL: api },
  );
  assert.equal(statuses.length, 1, rec.out);
  return { file: existsSync(file), lines, rec, status: statuses[0] };
}

test('사용 한도와 풀리는 시각: 세 명령을 거쳐 review/codex가 error이고 설명에 한도와 시각이 있다', async () => {
  const r = await chain(
    "You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again at Nov 21st, 2026 8:36 AM.",
  );
  assert.equal(r.file, true);
  assert.deepEqual(r.lines, ['unavailable=usage-limit@2026-11-21T08:36Z']);
  assert.equal(r.status.url, `/repos/o/r/statuses/${HEAD}`);
  assert.equal(r.status.context, 'review/codex');
  assert.equal(r.status.state, 'error');
  assert.equal(
    r.status.description,
    '판정 없음: 검증자 사용 한도(풀림 2026-11-21 08:36 UTC). 풀린 뒤 판정 워크플로를 다시 실행한다',
  );
  assert.notEqual(r.rec.code, 0, 'error를 쓴 기록은 지금처럼 실패로 끝난다');
});

test('시각을 모르는 사용 한도: 설명에 "풀리는 시각 모름"을 적는다', async () => {
  const r = await chain('You have hit your usage limit. Try again later');
  assert.deepEqual(r.lines, ['unavailable=usage-limit']);
  assert.equal(r.status.state, 'error');
  assert.equal(
    r.status.description,
    '판정 없음: 검증자 사용 한도(풀리는 시각 모름). 풀린 뒤 판정 워크플로를 다시 실행한다',
  );
});

test('한도가 아닌 실패: 값 파일과 unavailable 줄이 없고 설명은 지금 그대로다', async () => {
  const r = await chain('stream disconnected before completion');
  assert.equal(r.file, false);
  assert.deepEqual(r.lines, []);
  assert.equal(r.status.state, 'error');
  assert.equal(r.status.description, '판정 없음(판정 job 실패 또는 유출 검사 불통과)');
});

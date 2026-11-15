// Codex 판정 job의 유출 검사(scripts/ci/codex-scan.ts, 10.4절). 가짜 값과 합성 이벤트로 시험한다.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { authTokenValues, codexOutputSchema, scanCodexRun } from '../ci/codex-scan.ts';
import { HARNESS_ROOT } from './helpers.ts';

const fake = (name: string) => [name, 'FAKEFAKE', 'fakefake', '0123456789'].join('-');
const ACCESS = fake('acc');
const REFRESHED = fake('new');
const PR = '/home/runner/work/repo/repo/pr';
const b64 = (s: string) => Buffer.from(s).toString('base64');

const okVerdict = { verdict: 'approve', risk: 'low', summary: '문제 없음', findings: [] };
const started = { type: 'thread.started', thread_id: 't' };
const cmd = (command: string, exit = 0, output = '') => ({
  type: 'item.completed',
  item: { type: 'command_execution', command, exit_code: exit, aggregated_output: output },
});
const msg = (text: string) => ({ type: 'item.completed', item: { type: 'agent_message', text } });
const done = { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } };

function scan(events: unknown[], o: { last?: string; logs?: string[] } = {}) {
  return scanCodexRun({
    events: events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    last: o.last ?? JSON.stringify(okVerdict),
    logs: o.logs ?? [],
    prDir: PR,
    secrets: [ACCESS, REFRESHED],
  });
}
const reason = (r: ReturnType<typeof scan>) => (r.ok ? '' : r.reason);

test('깨끗한 실행: 판정을 낸다', () => {
  const r = scan([started, cmd("/bin/bash -lc 'cat src/a.js'"), msg('{}'), done]);
  assert.ok(r.ok, reason(r));
  // 검사기가 없는 resolutions를 빈 배열로 채운다
  assert.deepEqual(r.ok && r.verdict, { ...okVerdict, resolutions: [] });
  assert.ok(r.report.some((l) => /outside_attempts=0/.test(l)));
});

test('마지막 메시지 파일이 비면 마지막 agent_message를 판정으로 읽는다', () => {
  const r = scan([started, msg('생각'), msg(JSON.stringify(okVerdict)), done], { last: ' \n' });
  assert.ok(r.ok, reason(r));
});

test('비밀: 이벤트·stderr·판정의 원문, base64, 조각을 찾고 값을 돌려주지 않는다', () => {
  const cases = [
    scan([started, cmd('cat x', 0, `token ${ACCESS}`), done]),
    scan([started, done], { logs: [`warn ${b64(REFRESHED)}`] }),
    scan([started, done], {
      last: JSON.stringify({ ...okVerdict, summary: ACCESS.slice(4, 24) }),
    }),
  ];
  for (const r of cases) {
    assert.equal(r.ok, false);
    assert.match(reason(r), /비밀/);
    const text = JSON.stringify(r);
    assert.ok(!text.includes(ACCESS.slice(0, 16)) && !text.includes(b64(REFRESHED)));
  }
});

test('turn.failed: 판정 없이 실패, 오류 문구는 비밀을 가려 돌려준다', () => {
  const failed = (message: string) => scan([started, { type: 'turn.failed', error: { message } }]);
  const limit = failed('You have hit your usage limit.\nTry again later');
  assert.equal(limit.ok, false);
  assert.equal(!limit.ok && limit.errorText, 'You have hit your usage limit. Try again later');
  const secret = failed(`bad ${ACCESS}`);
  assert.equal(!secret.ok && secret.errorText, '<redacted>');
});

test('허용 밖 항목 종류(MCP 호출, 웹 검색, 파일 변경)가 있으면 실패', () => {
  for (const type of ['mcp_tool_call', 'web_search', 'file_change']) {
    const r = scan([started, { type: 'item.completed', item: { type } }, done]);
    assert.equal(r.ok, false, type);
    assert.match(reason(r), /허용 밖/);
  }
  const fine = scan([
    started,
    { type: 'item.completed', item: { type: 'reasoning', text: 'x' } },
    { type: 'item.completed', item: { type: 'todo_list', items: [] } },
    done,
  ]);
  assert.ok(fine.ok, reason(fine));
});

test('pr/ 밖을 가리킨 명령은 세어 보고한다(막는 것은 샌드박스와 사전 측정이다)', () => {
  const r = scan([
    started,
    cmd(`/bin/bash -lc 'cat ${PR}/src/a.js'`),
    cmd("/bin/bash -lc 'cat /proc/self/environ'", 1, 'Permission denied'),
    cmd("/bin/bash -lc 'cat ../base/x'", 1, 'No such file'),
    cmd("/bin/bash -lc 'env'", 0, 'PATH=/usr/bin'),
    cmd("/bin/bash -lc 'ls ~/.codex'", 0, 'x'),
    done,
  ]);
  assert.ok(r.ok, reason(r));
  assert.ok(
    r.report.some((l) => /outside_attempts=4 outside_ok=2/.test(l)),
    r.report.join('\n'),
  );
});

test('판정 없음·형식 오류·빈 기록은 실패', () => {
  assert.equal(scan([started, done], { last: '' }).ok, false);
  assert.equal(scan([started, done], { last: 'not json' }).ok, false);
  const bad = scan([started, done], { last: JSON.stringify({ ...okVerdict, risk: 'none' }) });
  assert.match(reason(bad), /형식/);
  assert.equal(scan([]).ok, false);
});

test('authTokenValues: tokens의 문자열과 API 키 중 16자 이상만', () => {
  const v = authTokenValues(
    JSON.stringify({
      OPENAI_API_KEY: fake('key'),
      tokens: { access_token: ACCESS, account_id: 'short' },
    }),
  );
  assert.deepEqual(v.sort(), [ACCESS, fake('key')].sort());
  assert.deepEqual(authTokenValues('not json'), []);
});

test('codexOutputSchema: 공통 스키마에서 길이·개수 제약만 뺀다', () => {
  const base = JSON.parse(
    readFileSync(path.join(HARNESS_ROOT, 'scripts/cross-review/verdict.schema.json'), 'utf8'),
  );
  const s = codexOutputSchema(base) as typeof base;
  const text = JSON.stringify(s);
  assert.doesNotMatch(text, /maxLength|maxItems|minimum|pattern/);
  assert.deepEqual(
    s.properties.resolutions.items.required,
    base.properties.resolutions.items.required,
  );
  assert.deepEqual(s.required, base.required);
  assert.equal(s.additionalProperties, false);
  assert.deepEqual(s.properties.findings.items.required, base.properties.findings.items.required);
  assert.deepEqual(s.properties.verdict.enum, base.properties.verdict.enum);
  assert.match(JSON.stringify(base), /maxLength/);
});

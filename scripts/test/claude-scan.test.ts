// Claude 판정 job의 유출 검사(scripts/ci/claude-scan.ts, 10.4절). 가짜 값과 합성 stream-json으로 시험한다.
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { scanClaudeRun } from '../ci/claude-scan.ts';
import { tmp } from './helpers.ts';

// 실제 토큰 형식의 리터럴은 시크릿 스캔에 걸리므로 조각을 런타임에 이어 붙인다
const TOKEN = ['tok', 'test', 'FAKEFAKEFAKEFAKE', 'fakefakefake', '0123456789'].join('-');
const b64 = (s: string) => Buffer.from(s).toString('base64');

const okVerdict = { verdict: 'approve', risk: 'low', summary: '문제 없음', findings: [] };
const init = {
  type: 'system',
  subtype: 'init',
  model: 'test-model',
  tools: ['Glob', 'Grep', 'Read', 'StructuredOutput'],
  mcp_servers: [],
};
const result = (extra: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 2,
  structured_output: okVerdict,
  permission_denials: [],
  ...extra,
});
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name, input }] },
});
const toolResult = (id: string, isError: boolean, content: string) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] },
});

function prDir(): string {
  const pr = path.join(tmp('claude-scan-'), 'pr');
  mkdirSync(path.join(pr, 'src'), { recursive: true });
  writeFileSync(path.join(pr, 'src/a.js'), 'x\n');
  return pr;
}
function scan(events: unknown[], pr = prDir()) {
  const log = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  return scanClaudeRun({ log, prDir: pr, secrets: [TOKEN] });
}
const reason = (r: ReturnType<typeof scan>) => (r.ok ? '' : r.reason);

test('깨끗한 실행: 판정을 낸다', () => {
  const r = scan([
    init,
    toolUse('t1', 'Read', { file_path: 'src/a.js' }),
    toolResult('t1', false, 'code'),
    toolUse('t2', 'StructuredOutput', okVerdict),
    toolResult('t2', false, 'ok'),
    result(),
  ]);
  assert.ok(r.ok, reason(r));
  // 검사기가 없는 resolutions를 빈 배열로 채운다
  assert.deepEqual(r.ok && r.verdict, { ...okVerdict, resolutions: [] });
});

test('pr/ 안의 절대 경로는 안쪽이다', () => {
  const pr = prDir();
  const r = scan(
    [
      init,
      toolUse('t1', 'Read', { file_path: path.join(pr, 'src/a.js') }),
      toolResult('t1', false, 'code'),
      result(),
    ],
    pr,
  );
  assert.ok(r.ok, reason(r));
});

test('pr/ 밖 읽기: 거부됐으면 통과, 성공했거나 결과를 모르면 실패', () => {
  const refused = scan([
    init,
    toolUse('t1', 'Read', { file_path: '/proc/self/environ' }),
    toolResult('t1', true, 'outside working directory'),
    toolUse('t2', 'Grep', { pattern: 'x', path: '../base' }),
    toolResult('t2', true, 'denied'),
    result(),
  ]);
  assert.ok(refused.ok, reason(refused));
  assert.ok(refused.report.some((l) => /outside_attempts=2 outside_ok=0/.test(l)));

  const ok = scan([
    init,
    toolUse('t1', 'Read', { file_path: '/home/runner/.claude.json' }),
    toolResult('t1', false, '{}'),
    result(),
  ]);
  assert.equal(ok.ok, false);
  assert.match(reason(ok), /pr\/ 밖/);

  const unknown = scan([init, toolUse('t1', 'Read', { file_path: '~/.claude.json' }), result()]);
  assert.equal(unknown.ok, false);
});

test('`..`로 벗어나는 경로와 Glob 패턴을 밖으로 본다', () => {
  for (const u of [
    toolUse('t1', 'Read', { file_path: 'src/../../base/scripts/harness.ts' }),
    toolUse('t1', 'Glob', { pattern: '../**/*.json' }),
    toolUse('t1', 'Glob', { pattern: '/etc/*' }),
    toolUse('t1', 'Grep', { pattern: 'x', glob: '../../*' }),
  ]) {
    const r = scan([init, u, toolResult('t1', false, 'data'), result()]);
    assert.equal(r.ok, false, JSON.stringify(u));
  }
});

test('문자열은 pr/ 안이어도 실제 경로가 밖이면(심볼릭 링크) 밖으로 본다', () => {
  const pr = prDir();
  const outside = path.join(path.dirname(pr), 'secret');
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'auth.json'), '{}');
  symlinkSync(outside, path.join(pr, 'link'));
  const r = scan(
    [
      init,
      toolUse('t1', 'Read', { file_path: 'link/auth.json' }),
      toolResult('t1', false, '{}'),
      result(),
    ],
    pr,
  );
  assert.equal(r.ok, false);
  assert.match(reason(r), /pr\/ 밖/);
});

test('허용 밖 도구: 호출했거나 세션에 실려 있으면 실패', () => {
  const used = scan([
    init,
    toolUse('t1', 'Bash', { command: 'env' }),
    toolResult('t1', true, 'denied'),
    result(),
  ]);
  assert.equal(used.ok, false);
  assert.match(reason(used), /허용 밖 도구/);
  const loaded = scan([{ ...init, tools: ['Read', 'Bash'] }, result()]);
  assert.equal(loaded.ok, false);
  const mcp = scan([{ ...init, mcp_servers: [{ name: 'x', status: 'connected' }] }, result()]);
  assert.equal(mcp.ok, false);
  assert.match(reason(mcp), /MCP/);
});

test('비밀: 판정의 base64, 16자 조각, 도구 결과의 원문을 찾고 값을 돌려주지 않는다', () => {
  const cases = [
    [init, result({ structured_output: { ...okVerdict, summary: `t=${b64(TOKEN)}` } })],
    [init, result({ structured_output: { ...okVerdict, summary: TOKEN.slice(8, 28) } })],
    [
      init,
      toolUse('t1', 'Read', { file_path: 'env.txt' }),
      toolResult('t1', false, `TOKEN=${TOKEN}`),
      result(),
    ],
  ];
  for (const c of cases) {
    const r = scan(c);
    assert.equal(r.ok, false);
    assert.match(reason(r), /비밀/);
    const text = JSON.stringify(r);
    assert.ok(!text.includes(TOKEN.slice(0, 16)) && !text.includes(b64(TOKEN)));
  }
});

test('실행 오류(is_error): 판정 없이 실패, 오류 문구는 비밀을 가려 돌려준다', () => {
  const failed = (msg: string) =>
    scan([init, result({ is_error: true, structured_output: undefined, result: msg })]);
  const plain = failed('Invalid API key\n· Please run /login');
  assert.equal(plain.ok, false);
  assert.equal(!plain.ok && plain.errorText, 'Invalid API key · Please run /login');
  const secret = failed(`bad token ${TOKEN}`);
  assert.equal(!secret.ok && secret.errorText, '<redacted>');
  // 오류인데 판정이 실려 있어도 내지 않는다
  const both = scan([init, result({ is_error: true })]);
  assert.equal(both.ok, false);
});

test('판정 없음·형식 오류·빈 기록은 실패', () => {
  assert.equal(scan([init]).ok, false);
  assert.equal(scan([init, result({ structured_output: undefined, result: 'text' })]).ok, false);
  const bad = scan([init, result({ structured_output: { ...okVerdict, verdict: 'merge' } })]);
  assert.equal(bad.ok, false);
  assert.match(reason(bad), /형식/);
  assert.equal(scanClaudeRun({ log: '', prDir: prDir(), secrets: [] }).ok, false);
  // init 이벤트가 없으면 세션에 실린 도구를 확인할 수 없다
  assert.equal(scan([result()]).ok, false);
});

test('구조화 출력이 없으면 result 문자열을 JSON으로 읽는다', () => {
  const r = scan([
    init,
    result({ structured_output: undefined, result: JSON.stringify(okVerdict) }),
  ]);
  assert.ok(r.ok, reason(r));
});

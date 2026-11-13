// 시험 리포 Codex 판정 job의 인증 도구(lab/q20/repo/judge/codex-auth.mjs). 가짜 auth.json으로 시험한다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tmp } from '../../../scripts/test/helpers.ts';

const TOOL = fileURLToPath(new URL('../repo/judge/codex-auth.mjs', import.meta.url));
const ACCESS = 'eyJhbGciOiJSUzI1NiJ9.FAKEACCESSFAKEACCESSFAKEACCESS.sigsigsigsigsig';
const REFRESH = 'rt_FAKEREFRESHFAKEREFRESHFAKEREFRESH0123';
const ID = 'eyJhbGciOiJSUzI1NiJ9.FAKEIDTOKENFAKEIDTOKENFAKEID.sigsigsigsigsig';
const auth = {
  OPENAI_API_KEY: null,
  auth_mode: 'chatgpt',
  tokens: { id_token: ID, access_token: ACCESS, refresh_token: REFRESH, account_id: 'acct-0001' },
  last_refresh: '2026-11-13T00:00:00Z',
};
const VALUES = [ACCESS, REFRESH, ID, 'acct-0001', 'chatgpt', '2026-11-13T00:00:00Z'];

function run(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [TOOL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: r.stdout + r.stderr, stdout: r.stdout };
}
const noValues = (out: string) => VALUES.every((v) => !out.includes(v));

test('restore: 시크릿을 0600 파일로 쓰고 sha8과 필드 이름만 출력한다', () => {
  const home = path.join(tmp('q20-cx-'), 'codex-home');
  const r = run(['restore', home], { CODEX_AUTH_JSON: JSON.stringify(auth, null, 2) });
  assert.equal(r.code, 0, r.out);
  const f = path.join(home, 'auth.json');
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), auth);
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.match(r.out, /Q20 codex auth restore sha8=[0-9a-f]{8} /);
  assert.match(
    r.out,
    /fields=OPENAI_API_KEY,auth_mode,last_refresh,tokens\.access_token,tokens\.account_id,tokens\.id_token,tokens\.refresh_token/,
  );
  assert.match(r.out, /api_key=false/);
  assert.ok(noValues(r.out), r.out);
});

test('restore: JSON이 아니거나 tokens가 없으면 값 없이 실패한다', () => {
  const home = path.join(tmp('q20-cx-'), 'h');
  const bad = run(['restore', home], { CODEX_AUTH_JSON: `not json ${REFRESH}` });
  assert.notEqual(bad.code, 0);
  assert.ok(!bad.out.includes(REFRESH), bad.out);
  const noTokens = run(['restore', home], { CODEX_AUTH_JSON: JSON.stringify({ a: 1 }) });
  assert.notEqual(noTokens.code, 0);
  assert.match(noTokens.out, /tokens/);
});

test('sha8은 공백과 무관하게 같은 JSON이면 같다(저장본과 다음 복원 비교용)', () => {
  const d = tmp('q20-cx-');
  const a = run(['restore', path.join(d, 'a')], { CODEX_AUTH_JSON: JSON.stringify(auth) });
  const b = run(['restore', path.join(d, 'b')], {
    CODEX_AUTH_JSON: JSON.stringify(auth, null, 4),
  });
  const sha = (o: string) => /sha8=([0-9a-f]{8})/.exec(o)?.[1];
  assert.ok(sha(a.out));
  assert.equal(sha(a.out), sha(b.out));
});

test('age: last_refresh만 N일 전으로 바꾼다', () => {
  const d = tmp('q20-cx-');
  const f = path.join(d, 'auth.json');
  writeFileSync(f, JSON.stringify(auth));
  const before = Date.now();
  const r = run(['age', f, '9']);
  assert.equal(r.code, 0, r.out);
  const after = JSON.parse(readFileSync(f, 'utf8'));
  const age = (before - Date.parse(after.last_refresh)) / 86400e3;
  assert.ok(age > 8.99 && age < 9.01, String(age));
  assert.deepEqual({ ...after, last_refresh: auth.last_refresh }, auth);
  assert.match(r.out, /Q20 codex auth age days=9 sha8=[0-9a-f]{8}/);
  assert.ok(noValues(r.out), r.out);
});

test('snapshot + diff: 바뀐 필드 이름만 출력한다', () => {
  const d = tmp('q20-cx-');
  const f = path.join(d, 'auth.json');
  const snap = path.join(d, 'snap.json');
  writeFileSync(f, JSON.stringify(auth));
  assert.equal(run(['snapshot', f, snap]).code, 0);
  assert.ok(noValues(readFileSync(snap, 'utf8')));

  const same = run(['diff', snap, f]);
  assert.equal(same.code, 0, same.out);
  assert.match(same.out, /Q20 codex auth after sha8=[0-9a-f]{8} changed=false fields_changed=-/);

  const next = {
    ...auth,
    tokens: { ...auth.tokens, access_token: ACCESS + 'x', refresh_token: REFRESH + 'y' },
    last_refresh: '2026-11-14T00:00:00Z',
  };
  writeFileSync(f, JSON.stringify(next, null, 2));
  const changed = run(['diff', snap, f]);
  assert.match(
    changed.out,
    /changed=true fields_changed=last_refresh,tokens\.access_token,tokens\.refresh_token/,
  );
  assert.ok(noValues(changed.out) && !changed.out.includes(REFRESH + 'y'), changed.out);
});

test('config: pr/ 읽기, 거부 경로, 신뢰하지 않는 프로젝트, 도구 끄기를 담는다', () => {
  const d = tmp('q20-cx-');
  const home = path.join(d, 'codex-home');
  mkdirSync(home);
  const r = run(['config', home, '/w/repo/repo/pr', '/home/runner', '/tmp/x']);
  assert.equal(r.code, 0, r.out);
  const toml = readFileSync(path.join(home, 'config.toml'), 'utf8');
  for (const line of [
    'approval_policy = "never"',
    'default_permissions = "q20judge"',
    'web_search = "disabled"',
    'cli_auth_credentials_store = "file"',
    'project_doc_max_bytes = 0',
    '[permissions.q20judge.filesystem]',
    '":minimal" = "read"',
    '"/w/repo/repo/pr" = "read"',
    '"/home/runner" = "deny"',
    '"/tmp/x" = "deny"',
    '[projects."/w/repo/repo/pr"]',
    'trust_level = "untrusted"',
    'inherit = "core"',
    'ignore_default_excludes = false',
    'view_image = false',
    'apps = false',
    'hooks = false',
    'multi_agent = false',
    // 셸 환경 스냅숏(내보낸 변수 포함)을 CODEX_HOME에 두고 명령마다 읽는 기능
    'shell_snapshot = false',
  ])
    assert.ok(toml.includes(line), `${line}\n---\n${toml}`);
  assert.ok(!/sandbox_mode/.test(toml), '권한 프로필과 sandbox_mode를 함께 쓰지 않는다');
});

test('config: 거부 폴더가 pr/의 조상이거나 pr/ 자신이면 값 없이 실패한다', () => {
  const d = tmp('q20-cx-');
  const home = path.join(d, 'codex-home');
  mkdirSync(home);
  // /home/runner는 pr/(/home/runner/work/.../pr)의 조상이다. 거부하면 pr/ 읽기까지 막힌다(Linux 발견 사항).
  const ancestor = run(['config', home, '/home/runner/work/r/r/pr', '/home/runner']);
  assert.notEqual(ancestor.code, 0);
  assert.match(ancestor.out, /조상|ancestor/);
  const self = run(['config', home, '/home/runner/work/r/r/pr', '/home/runner/work/r/r/pr']);
  assert.notEqual(self.code, 0);
  // pr/ 안의 하위 폴더를 거부하는 것은 허용한다(읽기 범위를 좁힐 수 있다)
  const child = run(['config', home, '/home/runner/work/r/r/pr', '/home/runner/work/r/r/pr/sub']);
  assert.equal(child.code, 0, child.out);
});

test('seal: 한 줄 JSON을 공개키로 봉인해 sealed=<base64>만 출력한다', () => {
  const d = tmp('q20-cx-');
  const f = path.join(d, 'auth.json');
  writeFileSync(f, JSON.stringify(auth, null, 2));
  // libsodium-wrappers 대역: 받은 평문과 키를 기록하고 고정된 바이트를 돌려준다
  const tools = path.join(d, 'tools');
  const mod = path.join(tools, 'node_modules', 'libsodium-wrappers');
  mkdirSync(mod, { recursive: true });
  const record = path.join(d, 'record.json');
  writeFileSync(
    path.join(mod, 'index.js'),
    `const fs = require('fs');
module.exports = {
  ready: Promise.resolve(),
  base64_variants: { ORIGINAL: 1 },
  from_base64: (s, v) => Buffer.from(s, 'base64'),
  to_base64: (b, v) => Buffer.from(b).toString('base64'),
  crypto_box_seal: (msg, key) => {
    fs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ msg: Buffer.from(msg).toString('utf8'), key: Buffer.from(key).toString('hex') }));
    return Uint8Array.from([1, 2, 3]);
  },
};`,
  );
  const key = Buffer.alloc(32, 7).toString('base64');
  const r = run(['seal', f, key], { Q20_SODIUM_DIR: tools });
  assert.equal(r.code, 0, r.out);
  assert.equal(r.stdout, 'sealed=AQID\n');
  const rec = JSON.parse(readFileSync(record, 'utf8'));
  assert.equal(rec.msg, JSON.stringify(auth));
  assert.equal(rec.key, Buffer.alloc(32, 7).toString('hex'));
});

test('seal: 공개키가 32바이트가 아니면 실패한다', () => {
  const d = tmp('q20-cx-');
  const f = path.join(d, 'auth.json');
  writeFileSync(f, JSON.stringify(auth));
  const r = run(['seal', f, Buffer.alloc(5).toString('base64')], { Q20_SODIUM_DIR: d });
  assert.notEqual(r.code, 0);
  assert.ok(noValues(r.out), r.out);
});

// Codex 판정 job의 인증 도구(scripts/ci/codex-auth.ts, 13.3절). 가짜 값만 쓴다.
import assert from 'node:assert/strict';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  JUDGE_PROFILE,
  diffAuth,
  restoreAuth,
  sealAuth,
  snapshotAuth,
  writeCodexConfig,
} from '../ci/codex-auth.ts';
import { tmp } from './helpers.ts';

// 실제 토큰 형식의 리터럴은 시크릿 스캔에 걸리므로 조각을 런타임에 이어 붙인다
const fake = (name: string) => [name, 'FAKEFAKE', 'fakefake', '0123456789'].join('-');
const AUTH = {
  OPENAI_API_KEY: null,
  auth_mode: 'chatgpt',
  last_refresh: '2026-11-01T00:00:00Z',
  tokens: { access_token: fake('acc'), refresh_token: fake('ref'), account_id: 'acct-1' },
};
const raw = (o: unknown = AUTH) => JSON.stringify(o, null, 2);

test('restoreAuth: auth.json을 0600으로, 폴더를 0700으로 쓰고 값 없이 필드 이름과 해시 앞 8자만 돌려준다', () => {
  const home = path.join(tmp('codex-auth-'), 'codex-home');
  const r = restoreAuth(raw(), home);
  const f = path.join(home, 'auth.json');
  assert.equal(statSync(f).mode & 0o777, 0o600);
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), AUTH);
  assert.match(r.sha8, /^[0-9a-f]{8}$/);
  assert.deepEqual(r.fields, [
    'OPENAI_API_KEY',
    'auth_mode',
    'last_refresh',
    'tokens.access_token',
    'tokens.account_id',
    'tokens.refresh_token',
  ]);
  assert.equal(r.apiKey, false);
  assert.ok(!JSON.stringify(r).includes('FAKEFAKE'));
});

test('restoreAuth: JSON이 아니거나 tokens가 없으면 거부하고 오류에 값을 넣지 않는다', () => {
  const home = tmp('codex-auth-');
  assert.throws(() => restoreAuth('', home), /JSON이 아니다/);
  assert.throws(
    () => restoreAuth(`{"k":"${fake('x')}"`, home),
    (e: Error) => {
      assert.ok(!e.message.includes('FAKEFAKE'));
      return /JSON이 아니다/.test(e.message);
    },
  );
  assert.throws(() => restoreAuth('{"OPENAI_API_KEY":"x"}', home), /tokens가 없다/);
});

test('snapshotAuth·diffAuth: 바뀐 필드 이름만 알려 준다', () => {
  const home = tmp('codex-auth-');
  restoreAuth(raw(), home);
  const f = path.join(home, 'auth.json');
  const snap = snapshotAuth(f);
  assert.ok(!JSON.stringify(snap).includes('FAKEFAKE'));
  assert.deepEqual(diffAuth(snap, f).fieldsChanged, []);
  assert.equal(diffAuth(snap, f).changed, false);
  const next = {
    ...AUTH,
    last_refresh: '2026-11-15T00:00:00Z',
    tokens: { ...AUTH.tokens, access_token: fake('new') },
  };
  writeFileSync(f, JSON.stringify(next));
  const d = diffAuth(snap, f);
  assert.equal(d.changed, true);
  assert.deepEqual(d.fieldsChanged, ['last_refresh', 'tokens.access_token']);
  assert.ok(!JSON.stringify(d).includes('FAKEFAKE'));
});

test('writeCodexConfig: 권한 프로필(읽기 거부 목록), 기능 끄기, 프로젝트 불신, 최소 셸 환경', () => {
  const root = tmp('codex-auth-');
  const home = path.join(root, 'temp/codex-home');
  restoreAuth(raw(), home);
  const prDir = path.join(root, 'work/pr');
  const deny = [
    path.join(root, 'temp'),
    path.join(root, 'work/base'),
    path.join(root, 'home/.codex'),
  ];
  writeCodexConfig({ home, prDir, denyDirs: deny });
  const t = readFileSync(path.join(home, 'config.toml'), 'utf8');
  assert.match(t, /^approval_policy = "never"$/m);
  assert.match(t, new RegExp(`^default_permissions = "${JUDGE_PROFILE}"$`, 'm'));
  assert.match(t, /^web_search = "disabled"$/m);
  assert.match(t, /^project_doc_max_bytes = 0$/m);
  assert.match(t, /^cli_auth_credentials_store = "file"$/m);
  for (const f of ['hooks', 'plugins', 'multi_agent', 'shell_snapshot', 'apps', 'memories'])
    assert.match(t, new RegExp(`^${f} = false$`, 'm'), f);
  assert.match(t, /\[skills\.bundled\]\nenabled = false/);
  assert.match(
    t,
    /\[shell_environment_policy\]\ninherit = "core"\nignore_default_excludes = false/,
  );
  assert.ok(
    t.includes(
      `[permissions.${JUDGE_PROFILE}.filesystem]\n":minimal" = "read"\n${JSON.stringify(prDir)} = "read"`,
    ),
  );
  for (const d of deny) assert.ok(t.includes(`${JSON.stringify(d)} = "deny"`), d);
  assert.ok(t.includes(`[projects.${JSON.stringify(prDir)}]\ntrust_level = "untrusted"`));
  // 내장 read-only 샌드박스는 쓰지 않는다
  assert.doesNotMatch(t, /sandbox_mode|read-only|danger/);
});

test('writeCodexConfig: 거부 폴더가 pr/의 조상이거나 pr/ 자신이면 거절한다. pr/ 아래는 된다', () => {
  const root = tmp('codex-auth-');
  const home = path.join(root, 'temp/codex-home');
  restoreAuth(raw(), home);
  const prDir = path.join(root, 'work/pr');
  for (const bad of [root, path.join(root, 'work'), prDir, `${prDir}/`, path.join(prDir, '..')])
    assert.throws(() => writeCodexConfig({ home, prDir, denyDirs: [bad] }), /조상이거나/, bad);
  assert.throws(() => writeCodexConfig({ home, prDir, denyDirs: [] }), /거부 폴더/);
  // 인증 파일이 있는 폴더가 거부 목록에 덮이지 않으면 거절한다
  assert.throws(
    () => writeCodexConfig({ home, prDir, denyDirs: [path.join(root, 'work/base')] }),
    /인증 폴더/,
  );
  writeCodexConfig({ home, prDir, denyDirs: [path.join(root, 'temp'), path.join(prDir, 'sub')] });
});

test('sealAuth: 공개키 형식과 모듈 폴더를 확인한다(봉인 자체는 CI에서 확인)', async () => {
  const home = tmp('codex-auth-');
  restoreAuth(raw(), home);
  const f = path.join(home, 'auth.json');
  await assert.rejects(sealAuth(f, 'not-a-key', home), /32바이트/);
  await assert.rejects(sealAuth(f, Buffer.alloc(31).toString('base64'), home), /32바이트/);
  await assert.rejects(sealAuth(f, Buffer.alloc(32).toString('base64'), ''), /모듈 폴더/);
  await assert.rejects(
    sealAuth(f, Buffer.alloc(32).toString('base64'), path.join(home, 'none')),
    /libsodium/,
  );
});
